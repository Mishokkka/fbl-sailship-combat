import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { StorageService } from "../scripts/services/storage-service.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "../scripts/services/document-state-store.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { CURRENT_SCHEMA_VERSION } from "../scripts/utils/constants.js";

async function prepareBattle({ revision = 1 } = {}) {
  const battle = createDefaultBattle();
  battle.revision = revision;
  await DocumentStateStore.ensureBattleDocuments(battle);
  StorageService.resetMutationQueueForTests();
  game.sailshipsCombat = { storage: StorageService, app: null };
  return battle;
}

test.beforeEach(() => {
  installTestEnvironment();
  DocumentStateStore.invalidateCache();
  StorageService.initialized = false;
  StorageService.resetMutationQueueForTests();
});

test("revision conflict cancels a random mutation without running it again", async () => {
  await prepareBattle({ revision: 5 });
  const originalRevisionReader = DocumentStateStore.getAuthoritativeRevision;
  let mutatorCalls = 0;
  DocumentStateStore.getAuthoritativeRevision = () => 6;
  try {
    await assert.rejects(
      () => StorageService.updateBattle(battle => {
        mutatorCalls += 1;
        battle.wind.direction = (battle.wind.direction + 1) % 6;
      }, { reason: "test-conflict" }),
      error => error?.name === "BattleRevisionConflictError"
    );
  } finally {
    DocumentStateStore.getAuthoritativeRevision = originalRevisionReader;
  }
  assert.equal(mutatorCalls, 1);
  assert.equal(DocumentStateStore.readAuthoritativeBattle().revision, 5);
});

test("unknown snapshot id never falls back to the latest saved battle", async () => {
  const battle = await prepareBattle({ revision: 2 });
  const snapshotBattle = structuredClone(battle);
  snapshotBattle.name = "Snapshot battle";
  await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    battles: [{
      id: "known-snapshot",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: "Known snapshot",
      saved: "2026-07-17T00:00:00.000Z",
      battle: snapshotBattle
    }]
  });

  const result = await StorageService.loadSnapshot("missing-snapshot");
  assert.equal(result, null);
  assert.equal(DocumentStateStore.readAuthoritativeBattle().revision, 2);
  assert.notEqual(DocumentStateStore.readAuthoritativeBattle().name, "Snapshot battle");
});

test("startup migration moves legacy world settings into permissioned documents", async () => {
  StorageService.registerSettings();
  const {
    MODULE_ID,
    SETTING_BATTLE,
    SETTING_SAVED_BATTLES,
    SETTING_SHIP_LIBRARY,
    SETTING_CREATURE_LIBRARY,
    SETTING_BATTLE_SCENARIOS
  } = await import("../scripts/utils/constants.js");

  const legacyBattle = createDefaultBattle();
  legacyBattle.name = "Legacy world battle";
  legacyBattle.schemaVersion = 3;
  legacyBattle.revision = 9;
  for (const unit of legacyBattle.ships) unit.schemaVersion = 3;
  await game.settings.set(MODULE_ID, SETTING_BATTLE, legacyBattle);
  await game.settings.set(MODULE_ID, SETTING_SAVED_BATTLES, { battles: [] });
  await game.settings.set(MODULE_ID, SETTING_SHIP_LIBRARY, { ships: [] });
  await game.settings.set(MODULE_ID, SETTING_CREATURE_LIBRARY, { creatures: [] });
  await game.settings.set(MODULE_ID, SETTING_BATTLE_SCENARIOS, { scenarios: [] });

  await StorageService.initialize();

  const stored = DocumentStateStore.readAuthoritativeBattle();
  assert.equal(stored.name, "Legacy world battle");
  assert.equal(stored.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(stored.ships.every(unit => unit.schemaVersion === CURRENT_SCHEMA_VERSION));
  for (const role of [
    DOCUMENT_STORAGE_ROLES.SNAPSHOTS,
    DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY,
    DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY,
    DOCUMENT_STORAGE_ROLES.SCENARIOS
  ]) assert.equal(DocumentStateStore.readCollection(role, {}).schemaVersion, CURRENT_SCHEMA_VERSION);

  const redacted = game.settings.get(MODULE_ID, SETTING_BATTLE);
  assert.equal(redacted.storageBackend, "permissioned-journal");
  assert.equal(redacted.storageRole, DOCUMENT_STORAGE_ROLES.BATTLE_CORE);
  assert.equal(redacted.name, undefined);
});

test("direct saves and queued player mutations cannot interleave document writes", async () => {
  const battle = await prepareBattle({ revision: 1 });
  battle.name = "Loaded scenario";
  const originalWrite = DocumentStateStore.writeAuthoritativeBattle;
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const firstWrite = new Promise(resolve => { entered = resolve; });
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let calls = 0;
  DocumentStateStore.writeAuthoritativeBattle = async function (value) {
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    calls += 1;
    try {
      if (calls === 1) { entered(); await gate; }
      return await originalWrite.call(this, value);
    } finally {
      activeWrites -= 1;
    }
  };
  let save;
  let update;
  try {
    save = StorageService.saveBattle(battle);
    await firstWrite;
    update = StorageService.updateBattle(current => { current.name += " + order"; });
    await Promise.resolve();
    release();
    await Promise.all([save, update]);
    assert.equal(maxActiveWrites, 1);
    const stored = DocumentStateStore.readAuthoritativeBattle();
    assert.equal(stored.name, "Loaded scenario + order");
    assert.equal(stored.revision, 3);
  } finally {
    release();
    await Promise.allSettled([save, update]);
    DocumentStateStore.writeAuthoritativeBattle = originalWrite;
  }
});
