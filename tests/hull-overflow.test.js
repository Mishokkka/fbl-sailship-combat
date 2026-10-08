import "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createShip } from "../scripts/data/ship-factory.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { DamageEngine } from "../scripts/engine/damage-engine.js";
import { GunneryEngine } from "../scripts/engine/gunnery-engine.js";
import { BattleReportService } from "../scripts/services/battle-report-service.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";

function shipWithHP(bow = 10, midship = 0, stern = 10) {
  const ship = createShip({ id: "target", name: "Цель", side: "red", x: 10, y: 10, heading: 0, template: "brigantine" });
  for (const [id, value] of Object.entries({ bow, midship, stern })) {
    ship.sections[id].hp = { value, max: 10 };
    ship.sections[id].dr = 0;
    ship.sections[id].systems = [];
  }
  return ship;
}
const values = ship => ["bow", "midship", "stern"].map(id => ship.sections[id].hp.value);
function attack(target, ammo = "roundShot", damage = 12) {
  return { hit: true, target, targetSection: "midship", ammo, damage, skill: 10, roll: 10,
    battery: { arc: "bow" }, battle: { setup: { mode: "air" } } };
}

test("a ruined section transfers half the post-protection hull damage, without rolls or preview mutation", t => {
  t.mock.method(Math, "random", () => assert.fail("Hull preview must not roll"));
  const ship = shipWithHP(), before = structuredClone(ship);
  const plan = DamageEngine.getHullDamagePlan(ship, "midship", 12);
  assert.equal(plan.directDamage, 0);
  assert.equal(plan.transferred, 6);
  assert.deepEqual(plan.changes.map(row => [row.sectionId, row.after]), [["midship", 0], ["bow", 7], ["stern", 7]]);
  assert.deepEqual(ship, before);
  DamageEngine.applyHullDamage(ship, "midship", 12);
  assert.deepEqual(values(ship), [7, 0, 7]);
});

test("the first destroying shot transfers only excess and rounds it down", () => {
  const ship = shipWithHP(10, 3, 10);
  const plan = DamageEngine.applyHullDamage(ship, "midship", 12);
  assert.equal(plan.directDamage, 3);
  assert.equal(plan.excess, 9);
  assert.equal(plan.transferBudget, 4);
  assert.deepEqual(values(ship), [8, 0, 8]);
  const exact = shipWithHP(10, 3, 10);
  assert.equal(DamageEngine.applyHullDamage(exact, "midship", 3).transferred, 0);
  assert.deepEqual(values(exact), [10, 0, 10]);
});

test("capped recipients redistribute a single budget without repeated transfer", () => {
  const uneven = shipWithHP(1, 0, 10);
  const plan = DamageEngine.applyHullDamage(uneven, "midship", 12);
  assert.equal(plan.transferred, 6);
  assert.deepEqual(values(uneven), [0, 0, 5]);
  const last = shipWithHP(0, 0, 3);
  assert.equal(DamageEngine.applyHullDamage(last, "midship", 100).transferred, 3);
  assert.deepEqual(values(last), [0, 0, 0]);
  assert.equal(DamageEngine.applyHullDamage(last, "midship", 100).transferred, 0);
});

test("rounding ties use bow, midship, stern regardless of object order", () => {
  const ship = shipWithHP();
  ship.sections = { stern: ship.sections.stern, midship: ship.sections.midship, bow: ship.sections.bow };
  DamageEngine.applyHullDamage(ship, "midship", 7);
  assert.deepEqual(values(ship), [8, 0, 9]);
});

test("transfer conserves the rounded budget over a bounded matrix of remaining HP", () => {
  for (const bow of [0, 1, 2, 9]) for (const mid of [0, 1, 4, 10])
    for (const stern of [0, 1, 3, 10]) for (const damage of [0, 1, 2, 3, 7, 12, 40]) {
      const ship = shipWithHP(bow, mid, stern);
      const expectedDirect = Math.min(mid, damage);
      const expectedTransfer = Math.min(bow + stern, Math.floor((damage - expectedDirect) / 2));
      const plan = DamageEngine.applyHullDamage(ship, "midship", damage);
      assert.equal(plan.transferred, expectedTransfer);
      assert.equal(bow + mid + stern - values(ship).reduce((a, b) => a + b, 0), expectedDirect + expectedTransfer);
      assert.ok(values(ship).every(hp => Number.isInteger(hp) && hp >= 0));
    }
});

test("nonfinite and negative damage cannot damage the hull", () => {
  for (const damage of [-1, NaN, Infinity, -Infinity]) {
    const ship = shipWithHP();
    assert.equal(DamageEngine.applyHullDamage(ship, "midship", damage).totalDamage, 0);
    assert.deepEqual(values(ship), [10, 0, 10]);
  }
});

test("armor and brace apply once before transfer, and receiving armor is not reapplied", t => {
  t.mock.method(Math, "random", () => 0.999);
  const ship = shipWithHP();
  ship.sections.midship.dr = 4;
  ship.sections.bow.dr = ship.sections.stern.dr = 100;
  ship.selectedOrder = "brace";
  const result = DamageEngine.applyAttackResult(attack(ship, "roundShot", 18));
  assert.equal(result.penetrating, 12);
  assert.equal(result.hull.transferred, 6);
  assert.deepEqual(values(ship), [7, 0, 7]);
  assert.match(result.text, /Сквозные повреждения: 50%/);
  const blocked = shipWithHP();
  blocked.sections.midship.dr = 30;
  assert.equal(DamageEngine.applyAttackResult(attack(blocked)).hull.transferred, 0);
  assert.deepEqual(values(blocked), [10, 0, 10]);
});

test("ordinary, heated, bomb and chain hull damage use the same forecast; grape remains crew damage", t => {
  t.mock.method(Math, "random", () => 0.999);
  for (const ammo of ["roundShot", "heatedShot", "shellBomb", "chainShot"]) {
    const ship = shipWithHP();
    ship.sections.midship.dr = 4;
    const forecast = DamageEngine.getGunneryHullPreview(ship, "midship", 12, ammo);
    const result = DamageEngine.applyAttackResult(attack(ship, ammo));
    assert.equal(result.hull.transferred, forecast.transferred, ammo);
    assert.equal(result.hull.totalDamage, forecast.totalDamage, ammo);
    assert.deepEqual(values(ship), forecast.changes.reduce((hp, row) => {
      hp[["bow", "midship", "stern"].indexOf(row.sectionId)] = row.after;
      return hp;
    }, [10, 0, 10]), ammo);
  }
  const grape = shipWithHP();
  assert.equal(DamageEngine.getGunneryHullPreview(grape, "midship", 12, "grapeShot"), null);
  DamageEngine.applyAttackResult(attack(grape, "grapeShot"));
  assert.deepEqual(values(grape), [10, 0, 10]);
});

test("transferred damage does not attack recipient systems or multiply critical rolls", t => {
  t.mock.method(Math, "random", () => 0.999);
  let criticalCalls = 0;
  t.mock.method(DamageEngine, "resolveCritical", () => { criticalCalls++; return ""; });
  const ship = shipWithHP();
  for (const id of ["bow", "stern"]) ship.sections[id].systems = [
    { name: "Тестовая система", slot: 1, status: "intact", hp: { value: 6, max: 6 } }
  ];
  DamageEngine.applyAttackResult(attack(ship));
  assert.equal(criticalCalls, 1);
  for (const id of ["bow", "stern"]) assert.equal(ship.sections[id].systems[0].hp.value, 6);
});

test("transferred damage can cause normal defeat and appears as section HP changes in a persisted report", t => {
  t.mock.method(Math, "random", () => 0.999);
  const ship = shipWithHP();
  const battle = { id: "overflow-battle", round: 1, revision: 1, setup: { mode: "air" }, ships: [ship] };
  const before = BattleReportService.capture(battle);
  const damage = DamageEngine.applyAttackResult(attack(ship, "roundShot", 26), battle);
  assert.equal(ship.flags.struck, true); // 7 HP remain out of 30: the existing 25% threshold.
  BattleReportService.record(battle, before, { kind: "salvo", outcome: "hit", targetId: ship.id, details: [damage.text] });
  const normalized = BattleNormalizer.normalize(battle);
  const report = normalized.lastReport;
  assert.ok(report.groups[0].changes.filter(row => row.label.endsWith(" · HP")).length >= 2);
  assert.match(report.details.join(" "), /Сквозные повреждения/);
  const privateReport = BattleReportService.project(report, new Set(), []);
  assert.equal(privateReport, null);
});

test("creature anatomy and unknown contact HP never receive a ship hull forecast", () => {
  const creature = createCreature({ id: "creature", side: "red" });
  assert.equal(DamageEngine.getGunneryHullPreview(creature, "body", 20, "roundShot"), null);
  assert.equal(DamageEngine.getGunneryHullPreview({ unitType: "ship", sections: {} }, "midship", 20, "roundShot"), null);
});

test("salvo preview includes overflow without consuming randomness, but delayed preparation does not", t => {
  t.mock.method(Math, "random", () => assert.fail("Shot preview must not roll"));
  const target = shipWithHP();
  const attacker = shipWithHP(10, 10, 10);
  attacker.id = "attacker"; attacker.side = "blue";
  const battle = { setup: { mode: "air" }, sea: { state: "calm", visibility: "clear" }, wind: { direction: 240, strength: "light" } };
  const battery = GunneryEngine.getBattery(attacker, "port");
  const preview = GunneryEngine.getShotPreview(battle, attacker, target, battery, 4, { autoSection: "midship" });
  assert.ok(preview.hullPreview.transferred > 0);
  battery.fireMode = "delayed";
  assert.equal(GunneryEngine.getShotPreview(battle, attacker, target, battery, 4, { autoSection: "midship" }).hullPreview, null);
});
