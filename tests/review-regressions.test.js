import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createShip } from "../scripts/data/ship-factory.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { normalizeAngle, headingToVector } from "../scripts/board/board-geometry.js";
import { BoardingEngine } from "../scripts/engine/boarding-engine.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { CollisionEngine } from "../scripts/engine/collision-engine.js";
import { CreatureAIEngine } from "../scripts/engine/creature-ai-engine.js";
import { CreatureMovementEngine } from "../scripts/engine/creature-movement-engine.js";
import { DamageEngine } from "../scripts/engine/damage-engine.js";
import { BattleScenarioService } from "../scripts/services/battle-scenario-service.js";
import { ShipMovementController } from "../scripts/controllers/ship-movement-controller.js";
import { ShipyardBattleController } from "../scripts/controllers/shipyard-battle-controller.js";
import { CreatureEditorController } from "../scripts/controllers/creature-editor-controller.js";
import { CreatureEditorActions } from "../scripts/controllers/creature-editor-actions.js";

test.beforeEach(() => installTestEnvironment());

function battleWith(ships) {
  const battle = createDefaultBattle();
  battle.setup.mode = "air";
  battle.board = { width: 20, height: 20, cellSize: 48, terrain: {} };
  battle.wind = { direction: 240, strength: "light" };
  battle.ships = ships;
  battle.turn = { actions: {}, movementReservations: {} };
  return battle;
}

test("invalid imported headings remain usable by movement geometry", () => {
  for (const value of ["abc", Infinity, -Infinity, NaN]) {
    const heading = normalizeAngle(value);
    assert.equal(heading, 0);
    assert.ok(headingToVector(heading, 5, 5));
  }
  assert.equal(normalizeAngle(-60), 300);
  assert.equal(normalizeAngle(420), 60);
});

test("the larger grappled ship can tow while the follower remains blocked", () => {
  const leader = createShip({ id: "leader", side: "blue", x: 6, y: 8, heading: 0, template: "frigate" });
  const follower = createShip({ id: "follower", side: "red", x: 6, y: 9, heading: 0, template: "cutter" });
  leader.stats.sm = 9;
  follower.stats.sm = 5;
  const battle = battleWith([leader, follower]);
  assert.equal(BoardingEngine.grapple(battle, leader.id, follower.id).ok, true);
  assert.equal(leader.flags.towingId, follower.id);
  assert.ok(MovementEngine.getReachableCells(battle, leader).length > 0);
  assert.deepEqual(MovementEngine.getReachableCells(battle, follower), []);
});

test("collision damage affects creature vitality without ship flooding", () => {
  const creature = createCreature({ id: "creature", template: "skyRay" });
  const before = creature.vitality.current;
  CollisionEngine.applySectionDamage(creature, "midship", 7, "collision");
  assert.equal(creature.vitality.current, before - 7);
  assert.ok(Object.values(creature.sections).every(section => !section.flooding && !section.breaches));
});

test("AI uses the same occupied-altitude checks as manual flight", () => {
  const creature = createCreature({ id: "creature", side: "red", x: 5, y: 5, heading: 0, template: "skyRay" });
  creature.altitude = 3;
  creature.movement.climb = 1;
  const target = createShip({ id: "target", side: "blue", x: 5, y: 5, heading: 0 });
  target.altitude = 4;
  const battle = battleWith([creature, target]);
  CreatureAIEngine.runMovement(battle, creature);
  assert.equal(creature.altitude, 3);
});

test("AI vertical target stops at the target band and respects damaged flight", () => {
  const creature = createCreature({ id: "creature", x: 5, y: 5, template: "skyRay" });
  creature.altitude = 3;
  creature.movement.climb = 3;
  const battle = battleWith([creature]);
  const result = CreatureMovementEngine.verticalManeuver(battle, creature, "climb", MovementEngine, { targetAltitude: 4 });
  assert.equal(result.ok, true);
  assert.equal(creature.altitude, 4);
  for (const section of Object.values(creature.sections)) {
    if (section.tags?.some(tag => ["flight", "wing", "levitation"].includes(tag))) {
      section.hp.value = 0;
      section.status = "destroyed";
    }
  }
  creature.movement.climb = 1;
  assert.equal(CreatureMovementEngine.verticalManeuver(battle, creature, "climb", MovementEngine).ok, false);
});

test("sea battles never resolve incidental core hits or ongoing core heat", () => {
  const ship = createShip({ id: "ship", x: 5, y: 5 });
  const battle = battleWith([ship]);
  battle.setup.mode = "sea";
  ship.altitude = 0;
  ship.crystal.heat = 99;
  const core = structuredClone(ship.crystal);
  const section = ship.sections.stern;
  const system = section.systems.find(item => item.name.includes("ядра"));
  assert.ok(system);
  DamageEngine.resolveCritical(ship, "stern", section, system, 2, { battle, damage: 2 });
  DamageEngine.advanceOngoingDamage(battle);
  assert.deepEqual(ship.crystal, core);
  assert.equal(Boolean(ship.flags?.coreExploded || ship.flags?.falling), false);
});

test("smaller board and scenario presets keep every unit within the field", () => {
  for (const method of ["applyBoardPreset", "applyScenarioPreset"]) {
    const ship = createShip({ id: "ship", x: 79, y: 79 });
    const battle = battleWith([ship]);
    battle.board.width = 80;
    battle.board.height = 80;
    BattleScenarioService[method](battle, method === "applyBoardPreset" ? "skirmish" : "openDuel");
    assert.ok(ship.x >= 0 && ship.x < battle.board.width);
    assert.ok(ship.y >= 0 && ship.y < battle.board.height);
  }
});

test("braking at zero speed refunds the action and never completes activation", async () => {
  const ship = createShip({ id: "ship" });
  ship.speed = 0;
  const battle = battleWith([ship]);
  let spent = 0;
  let completed = false;
  const app = {
    getSelectedShip: () => ship,
    _updateBattleAndRender: callback => callback(battle),
    _requireActivePhase: () => true,
    _canSpendMovementPreparation: () => true,
    _markTurnAction: () => { spent += 1; return true; },
    _refundTurnAction: () => { spent -= 1; },
    _addLog: () => assert.fail("No successful braking log is expected"),
    _completeIfNoAP: () => { completed = true; }
  };
  await new ShipMovementController(app).reduceSail();
  assert.equal(spent, 0);
  assert.equal(completed, false);
});

test("queued roster and creature edits recheck a battle confirmed after the initial guard", async () => {
  const ship = createShip({ id: "ship", side: "blue", x: 5, y: 5 });
  const battle = battleWith([ship]);
  battle.setupConfirmed = true;
  const before = structuredClone(battle);
  const app = {
    _assertSetup: () => true,
    _updateBattleAndRender: callback => callback(battle),
    getSelectedShip: () => assert.fail("A locked battle must not enter the editor")
  };
  await new ShipyardBattleController(app).setSelectedShipSide("red");
  const editor = new CreatureEditorActions(app);
  await editor.applyEdits();
  await editor.mutate("test", () => assert.fail("The mutation must not run"));
  assert.deepEqual(battle, before);
});

test("applying creature fields preserves the normalized unit identity and anatomy", () => {
  const creature = createCreature({ id: "edited-creature", name: "Before", template: "skyRay", side: "red" });
  const sections = Object.keys(creature.sections);
  const attackIds = creature.attacks.map(attack => attack.id);
  const root = {
    querySelector: selector => selector === '[data-creature-edit="name"]' ? { value: "After" } : null,
    querySelectorAll: () => []
  };
  const result = new CreatureEditorController(root).applyEdits(creature);
  assert.deepEqual(result, { oldName: "Before", newName: "After", renamed: true });
  assert.equal(creature.id, "edited-creature");
  assert.equal(creature.unitType, "creature");
  assert.equal(creature.side, "red");
  assert.deepEqual(Object.keys(creature.sections), sections);
  assert.deepEqual(creature.attacks.map(attack => attack.id), attackIds);
  assert.ok(creature.vitality.max > 0);
});
