import "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { ShipNormalizer } from "../scripts/normalizers/ship-normalizer.js";
import { CreatureNormalizer } from "../scripts/normalizers/creature-normalizer.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { CURRENT_SCHEMA_VERSION } from "../scripts/utils/constants.js";

test("battle normalization is stable on a second pass", () => {
  const battle = createDefaultBattle();
  const once = BattleNormalizer.normalize(structuredClone(battle));
  const twice = BattleNormalizer.normalize(structuredClone(once));
  assert.deepEqual(twice, once);
});

test("battle normalization repairs duplicate unit ids", () => {
  const battle = createDefaultBattle();
  battle.ships[1].id = battle.ships[0].id;
  const normalized = BattleNormalizer.normalize(battle);
  assert.equal(new Set(normalized.ships.map(unit => unit.id)).size, normalized.ships.length);
});

test("invalid terrain and out-of-board terrain are removed", () => {
  const battle = createDefaultBattle();
  battle.board.terrain = {
    "1,1": ["smoke", "invalid", "smoke"],
    "999,999": ["rockHigh"],
    "bad": ["reef"]
  };
  const normalized = BattleNormalizer.normalize(battle);
  assert.deepEqual(normalized.board.terrain, { "1,1": ["smoke"] });
});

test("ship normalizer converts legacy grapple flag", () => {
  const ship = { id: "a", flags: { grappled: "b" }, sections: { stern: { hp: { value: 1, max: 1 }, systems: [] } } };
  const normalized = ShipNormalizer.normalize(ship);
  assert.equal(normalized.flags.grappledWith, "b");
  assert.equal("grappled" in normalized.flags, false);
});

test("creature normalizer infers flight failure for destroyed wings", () => {
  const creature = createCreature({ id: "creature", template: "skyRay" });
  const flightSections = Object.values(creature.sections).filter(section => section.tags.some(tag => ["flight", "wing", "levitation"].includes(tag)));
  assert.ok(flightSections.length > 0);
  for (const section of flightSections) {
    section.hp.value = 0;
    section.status = "destroyed";
  }
  creature.flags.falling = true;
  creature.flags.fallReason = null;
  const normalized = CreatureNormalizer.normalize(creature);
  assert.equal(normalized.flags.fallReason, "flightFailure");
});

test("all normalized combatants use the current schema", () => {
  const battle = createDefaultBattle();
  battle.ships.push(createCreature({ id: "beast", side: "red", x: 10, y: 10 }));
  const normalized = BattleNormalizer.normalize(battle);
  assert.equal(normalized.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(normalized.ships.every(unit => unit.schemaVersion === CURRENT_SCHEMA_VERSION));
});
