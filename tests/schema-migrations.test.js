import "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_SCHEMA_VERSION } from "../scripts/utils/constants.js";
import { SchemaMigrations, UnsupportedSchemaVersionError } from "../scripts/migrations/schema-migrations.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { createShip } from "../scripts/data/ship-factory.js";

function minimalBattle(version) {
  const battle = {
    id: `battle-v${version}`,
    name: "Fixture",
    round: 1,
    phase: "orders",
    board: { width: 12, height: 10, cellSize: 48, terrain: { "2,2": "smoke" } },
    ships: [{
      id: "legacy-ship",
      name: "Legacy",
      template: "brigantine",
      side: "blue",
      x: 2,
      y: 3,
      heading: 120,
      speed: 1,
      maxSpeed: 4,
      sections: { stern: { hp: { value: 20, max: 20 }, systems: [] } },
      weapons: [{ id: "port", arc: "port", label: "Левый борт", reload: 1, ammo: "chainShot", fireMode: "partial" }]
    }]
  };
  if (version > 0) {
    battle.schemaVersion = version;
    battle.ships[0].schemaVersion = version;
  }
  return battle;
}

test("migration plan is continuous through every supported schema", () => {
  const plan = SchemaMigrations.getMigrationPlan(0);
  assert.equal(plan.length, CURRENT_SCHEMA_VERSION);
  for (let index = 0; index < plan.length; index += 1) {
    assert.equal(plan[index].from, index);
    assert.equal(plan[index].to, index + 1);
    assert.ok(plan[index].label.length > 3);
  }
});

for (let version = 0; version <= CURRENT_SCHEMA_VERSION; version += 1) {
  test(`battle schema v${version} migrates to v${CURRENT_SCHEMA_VERSION}`, () => {
    const battle = minimalBattle(version);
    const migrated = SchemaMigrations.migrateBattle(battle);
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(migrated.ships[0].schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(migrated.ships[0].unitType, "ship");
    if (version < 8) {
      assert.ok(migrated.playerVisibility && typeof migrated.playerVisibility === "object");
    }
  });
}

test("legacy terrain values become layer arrays", () => {
  const battle = minimalBattle(0);
  battle.board.terrain = { "1,1": "reef", "2,2": ["smoke", "smoke", null] };
  SchemaMigrations.migrateBattle(battle);
  assert.deepEqual(battle.board.terrain["1,1"], ["reef"]);
  assert.deepEqual(battle.board.terrain["2,2"], ["smoke"]);
});

test("historical armament migration preserves tactical state", () => {
  const ship = minimalBattle(0).ships[0];
  SchemaMigrations.migrateShip(ship);
  const port = ship.weapons.find(weapon => weapon.arc === "port");
  assert.ok(ship.weapons.length >= 4);
  assert.equal(port.ammo, "chainShot");
  assert.equal(port.fireMode, "partial");
  assert.equal(port.reload, 1);
  assert.ok(port.guns != null || port.caliber != null || port.armamentRevision != null);
});

test("custom current armament is never replaced", () => {
  const ship = createShip({ id: "custom", name: "Custom", side: "blue", x: 0, y: 0, heading: 0, template: "brigantine" });
  ship.weapons = [{ id: "custom-gun", arc: "bow", label: "Авторская пушка", type: "longGun", range: 7, damage: 99, reload: 0, reloadMax: 2 }];
  SchemaMigrations.migrateShip(ship);
  assert.equal(ship.weapons.length, 1);
  assert.equal(ship.weapons[0].damage, 99);
});

test("migration is idempotent", () => {
  const battle = minimalBattle(0);
  SchemaMigrations.migrateBattle(battle);
  const once = structuredClone(battle);
  SchemaMigrations.migrateBattle(battle);
  assert.deepEqual(battle, once);
});

test("future battle schema is rejected instead of silently downgraded", () => {
  const battle = minimalBattle(CURRENT_SCHEMA_VERSION);
  battle.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
  assert.throws(() => SchemaMigrations.migrateBattle(battle), UnsupportedSchemaVersionError);
});

test("future combatant schema is rejected", () => {
  const ship = minimalBattle(CURRENT_SCHEMA_VERSION).ships[0];
  ship.schemaVersion = CURRENT_SCHEMA_VERSION + 5;
  assert.throws(() => SchemaMigrations.migrateShip(ship), UnsupportedSchemaVersionError);
});

test("normalization completes independent durability and range revisions", () => {
  const battle = minimalBattle(5);
  const ship = battle.ships[0];
  ship.durabilityRevision = 1;
  ship.sections.stern.hp = { value: 10, max: 20 };
  ship.weapons = [{ id: "old", arc: "bow", label: "Old", type: "chaser", range: 2, rangeRevision: 1, damage: 5, reload: 0, reloadMax: 1 }];
  const normalized = BattleNormalizer.normalize(battle);
  const migratedShip = normalized.ships[0];
  assert.equal(migratedShip.durabilityRevision, 2);
  assert.equal(migratedShip.sections.stern.hp.max, 10);
  assert.equal(migratedShip.sections.stern.hp.value, 5);
  assert.equal(migratedShip.weapons[0].rangeRevision, 3);
  assert.equal(migratedShip.weapons[0].range, 10);
});
