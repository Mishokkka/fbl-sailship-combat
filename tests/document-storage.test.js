import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "../scripts/services/document-state-store.js";
import { StorageMigrations } from "../scripts/migrations/storage-migrations.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createShip } from "../scripts/data/ship-factory.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { CURRENT_SCHEMA_VERSION, MODULE_ID } from "../scripts/utils/constants.js";

function reset() {
  const env = installTestEnvironment();
  DocumentStateStore.invalidateCache();
  return env;
}

test.beforeEach(reset);

test("authoritative battle is reconstructed from split documents", async () => {
  const battle = createDefaultBattle();
  battle.revision = 4;
  battle.lastMovement = { id: "move", shipId: battle.ships[0].id };
  await DocumentStateStore.ensureBattleDocuments(battle);
  const read = DocumentStateStore.readAuthoritativeBattle();
  assert.equal(read.revision, 4);
  assert.deepEqual(read.log, battle.log);
  assert.deepEqual(read.lastMovement, battle.lastMovement);
  assert.equal(read.id, battle.id);
});

test("partial split write falls back to components matching the committed core revision", async () => {
  const initial = createDefaultBattle();
  initial.revision = 1;
  initial.log = [{ id: "old", round: 1, phase: "orders", text: "old", ts: "old" }];
  initial.lastMovement = { id: "old-move", shipId: initial.ships[0].id };
  await DocumentStateStore.ensureBattleDocuments(initial);

  const next = structuredClone(initial);
  next.revision = 2;
  next.log = [{ id: "new", round: 1, phase: "orders", text: "new", ts: "new" }];
  next.lastMovement = { id: "new-move", shipId: initial.ships[1].id };

  const originalUpdate = DocumentStateStore.updateEntry;
  let updateCount = 0;
  DocumentStateStore.updateEntry = async function patched(entry, state, options) {
    updateCount += 1;
    if (updateCount === 3) throw new Error("simulated core write failure");
    return originalUpdate.call(this, entry, state, options);
  };
  await assert.rejects(() => DocumentStateStore.writeAuthoritativeBattle(next), /simulated core write failure/);
  DocumentStateStore.updateEntry = originalUpdate;

  const recovered = DocumentStateStore.readAuthoritativeBattle();
  assert.equal(recovered.revision, 1);
  assert.equal(recovered.log[0].text, "old");
  assert.equal(recovered.lastMovement.id, "old-move");
});

test("successful write commits core, log and runtime at one revision", async () => {
  const initial = createDefaultBattle();
  initial.revision = 1;
  await DocumentStateStore.ensureBattleDocuments(initial);
  const next = structuredClone(initial);
  next.revision = 2;
  next.log.push({ id: "second", round: 1, phase: "orders", text: "second", ts: "now" });
  next.lastCollision = { id: "collision" };
  await DocumentStateStore.writeAuthoritativeBattle(next);
  const read = DocumentStateStore.readAuthoritativeBattle();
  assert.equal(read.revision, 2);
  assert.equal(read.log.at(-1).text, "second");
  assert.equal(read.lastCollision.id, "collision");
});

test("player projections have isolated ownership and persistent authentication keys", async () => {
  const battle = createDefaultBattle();
  battle.revision = 3;
  const projector = (source, user) => ({ id: source.id, revision: source.revision, viewer: user.id, ships: [] });
  await DocumentStateStore.syncPlayerProjections(battle, projector);
  const firstAuth = DocumentStateStore.readProjectionAuth("player-a");
  const projection = DocumentStateStore.readProjection("player-a");
  const entry = DocumentStateStore.findEntry(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, "player-a");
  assert.equal(projection.viewer, "player-a");
  assert.ok(firstAuth.secret.length > 20);
  assert.equal(entry.ownership.default, 0);
  assert.equal(entry.ownership["player-a"], 2);

  battle.revision = 4;
  await DocumentStateStore.syncPlayerProjections(battle, projector);
  const secondAuth = DocumentStateStore.readProjectionAuth("player-a");
  assert.equal(secondAuth.secret, firstAuth.secret);
  assert.equal(secondAuth.keyVersion, firstAuth.keyVersion);
  assert.equal(secondAuth.revision, 4);
});

test("storage migrations normalize all collections and preserve creatures in scenarios", async () => {
  const ship = createShip({ id: "ship", name: "Ship", side: "blue", x: 2, y: 2, heading: 0, template: "brigantine" });
  ship.schemaVersion = 3;
  const creature = createCreature({ id: "creature", side: "red", x: 4, y: 4, template: "skyRay" });
  creature.schemaVersion = 10;
  const scenarioBattle = createDefaultBattle();
  scenarioBattle.schemaVersion = 10;
  scenarioBattle.ships = [ship, creature];

  await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, {
    battles: [{ id: "snap", name: "Snap", saved: "old", battle: scenarioBattle }]
  });
  await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, {
    ships: [{ id: "ship-template", name: "Ship", saved: "old", ship }]
  });
  await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, {
    creatures: [{ id: "creature-template", name: "Creature", saved: "old", creature }]
  });
  await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SCENARIOS, {
    scenarios: [{ id: "scenario", name: "Mixed", saved: "old", scenario: scenarioBattle }]
  });

  const report = await StorageMigrations.migrateAll({ log: false });
  assert.equal(report.length, 4);
  for (const role of [DOCUMENT_STORAGE_ROLES.SNAPSHOTS, DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, DOCUMENT_STORAGE_ROLES.SCENARIOS]) {
    assert.equal(DocumentStateStore.readCollection(role, {}).schemaVersion, CURRENT_SCHEMA_VERSION);
  }
  const scenarios = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.SCENARIOS, {}).scenarios;
  assert.deepEqual(scenarios[0].scenario.ships.map(unit => unit.unitType).sort(), ["creature", "ship"]);
  assert.equal(scenarios[0].scenario.ships.find(unit => unit.unitType === "creature").creatureType, creature.creatureType);
  assert.deepEqual(await StorageMigrations.migrateAll({ log: false }), []);
});

test("storage entries are marked with module roles", async () => {
  await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, { schemaVersion: CURRENT_SCHEMA_VERSION, battles: [] });
  const entry = DocumentStateStore.findEntry(DOCUMENT_STORAGE_ROLES.SNAPSHOTS);
  assert.equal(entry.getFlag(MODULE_ID, "storageRole"), DOCUMENT_STORAGE_ROLES.SNAPSHOTS);
  assert.equal(DocumentStateStore.isStorageEntry(entry), true);
});
