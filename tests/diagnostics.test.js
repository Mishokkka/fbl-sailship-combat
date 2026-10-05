import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DiagnosticsService } from "../scripts/services/diagnostics-service.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "../scripts/services/document-state-store.js";
import { SocketService } from "../scripts/services/socket-service.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import {
  CURRENT_SCHEMA_VERSION,
  SETTING_BATTLE,
  SETTING_SAVED_BATTLES,
  SETTING_SHIP_LIBRARY,
  SETTING_CREATURE_LIBRARY,
  SETTING_BATTLE_SCENARIOS
} from "../scripts/utils/constants.js";

const COLLECTIONS = [
  [DOCUMENT_STORAGE_ROLES.SNAPSHOTS, { schemaVersion: CURRENT_SCHEMA_VERSION, battles: [] }],
  [DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, { schemaVersion: CURRENT_SCHEMA_VERSION, ships: [] }],
  [DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, { schemaVersion: CURRENT_SCHEMA_VERSION, creatures: [] }],
  [DOCUMENT_STORAGE_ROLES.SCENARIOS, { schemaVersion: CURRENT_SCHEMA_VERSION, scenarios: [] }]
];

async function createHealthyStorage() {
  const battle = createDefaultBattle();
  battle.revision = 7;
  await DocumentStateStore.ensureBattleDocuments(battle);
  for (const [role, value] of COLLECTIONS) await DocumentStateStore.ensureCollection(role, value);
  await DocumentStateStore.syncPlayerProjections(battle, source => ({
    id: source.id,
    schemaVersion: source.schemaVersion,
    revision: source.revision,
    ships: []
  }));
  for (const [key, role] of [
    [SETTING_BATTLE, DOCUMENT_STORAGE_ROLES.BATTLE_CORE],
    [SETTING_SAVED_BATTLES, DOCUMENT_STORAGE_ROLES.SNAPSHOTS],
    [SETTING_SHIP_LIBRARY, DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY],
    [SETTING_CREATURE_LIBRARY, DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY],
    [SETTING_BATTLE_SCENARIOS, DOCUMENT_STORAGE_ROLES.SCENARIOS]
  ]) await DocumentStateStore.redactLegacySetting(key, role);
  return battle;
}

test.beforeEach(() => {
  installTestEnvironment();
  DocumentStateStore.invalidateCache();
});

test("healthy permissioned storage passes runtime diagnostics", async () => {
  await createHealthyStorage();
  const report = DiagnosticsService.run({ log: false });
  assert.equal(report.ok, true);
  assert.equal(report.counts.error, 0);
  assert.equal(report.counts.warning, 0);
  assert.ok(report.checks.length >= 18);
  assert.equal(report.checks.find(item => item.id === "authority")?.status, "ok");
  assert.equal(report.checks.find(item => item.id === "projection:player-a")?.status, "ok");
});

test("diagnostics detects stale projection and exposed service document", async () => {
  const battle = await createHealthyStorage();
  const projectionEntry = DocumentStateStore.findEntry(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, "player-a");
  const projectionState = DocumentStateStore.readState(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, { userId: "player-a" });
  projectionState.revision = battle.revision - 1;
  projectionState.battle.revision = battle.revision - 1;
  await DocumentStateStore.updateEntry(projectionEntry, projectionState);

  const collectionEntry = DocumentStateStore.findEntry(DOCUMENT_STORAGE_ROLES.SNAPSHOTS);
  await collectionEntry.update({ ownership: { default: 2 } });

  const report = DiagnosticsService.run({ log: false });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(item => item.id === "projection:player-a")?.status, "error");
  assert.equal(report.checks.find(item => item.id === `document:${DOCUMENT_STORAGE_ROLES.SNAPSHOTS}`)?.status, "error");
});

test("non-GM receives a limited diagnostics report", async () => {
  installTestEnvironment({ currentUserId: "player-a" });
  DocumentStateStore.invalidateCache();
  const report = DiagnosticsService.run({ log: false });
  assert.equal(report.ok, false);
  assert.equal(report.counts.error, 1);
  assert.deepEqual(report.checks.map(item => item.id), ["gm-access"]);
});

test("authoritative GM selection remains deterministic", () => {
  installTestEnvironment({
    users: [
      { id: "gm-z", name: "GM Z", isGM: true, active: true },
      { id: "gm-a", name: "GM A", isGM: true, active: true },
      { id: "player-a", name: "Player A", isGM: false, active: true }
    ],
    currentUserId: "gm-z"
  });
  assert.equal(SocketService.getAuthoritativeGmId(), "gm-a");
  assert.equal(SocketService.isAuthoritativeGm(), false);
});
