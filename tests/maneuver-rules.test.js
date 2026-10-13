import "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { WindEngine } from "../scripts/engine/wind-engine.js";
import { VictoryEngine } from "../scripts/engine/victory-engine.js";
import { CreatureAIEngine } from "../scripts/engine/creature-ai-engine.js";
import { MovementPlanBuilder } from "../scripts/context/movement-plan-builder.js";
import { MovementReadoutBuilder } from "../scripts/context/movement-readout-builder.js";

function fixture() {
  const b = BattleNormalizer.normalize(createDefaultBattle());
  b.setupConfirmed = true; b.setup.mode = "air"; b.phase = "movement";
  b.board.terrain = {}; b.wind = { direction: 240, strength: "light" };
  Object.assign(b.ships[0], { x: 12, y: 10, heading: 0, speed: 3, altitude: 4, verticalVelocity: 0 });
  b.turn.activeShipId = b.ships[0].id;
  b.setup.victory.mode = "escape"; b.setup.victory.objectiveSideId = b.ships[0].side;
  b.setup.victory.exitEdge = "right"; b.setup.victory.requiredShips = 1;
  VictoryEngine.captureInitialStrength(b);
  return b;
}

test("wind sync, rejected acceleration and a turn into wind all preserve momentum", () => {
  const b = fixture(), ship = b.ships[0];
  const before = ship.speed;
  const turn = MovementEngine.resolveTurn(b, ship, 1);
  assert.equal(turn.ok, true); assert.equal(turn.assessment.enteringIrons, true);
  assert.equal(ship.speed, before);
  WindEngine.syncInIronsFlag(ship, b.wind);
  assert.equal(ship.speed, before);
  assert.equal(MovementEngine.increaseSpeed(b, ship.id).ok, false);
  assert.equal(ship.speed, before);
  const normalized = BattleNormalizer.normalize(b);
  assert.equal(normalized.ships[0].speed, before);
  assert.equal(MovementEngine.getEffectiveMaxSpeed(b, ship), 0);
  ship.selectedOrder = "pressSail";
  assert.equal(MovementEngine.getEffectiveMaxSpeed(b, ship), 0, "Sail orders cannot restore thrust into the wind");
  assert.ok(MovementEngine.getReachableCells(b, ship).length);
});

test("failed exit from wind loses two speed, not all speed, and keeps the next-attempt assistance", () => {
  const b = fixture(), ship = b.ships[0];
  ship.heading = 60; ship.flags.inIrons = true; ship.speed = 3;
  const result = MovementEngine.resolveTurn(b, ship, -1, { random: () => .9999 });
  assert.equal(result.failed, true);
  assert.equal(ship.heading, 60); assert.equal(ship.speed, 1);
  assert.equal(ship.flags.inIronsAttempts, 1);
  assert.equal(MovementEngine.getTurnAssessment(b, ship, -1).ironsAssist, 2);
});

test("a planned route into wind predicts the same retained speed as execution", () => {
  const b = fixture(), ship = b.ships[0];
  const cell = MovementEngine.getReachableCells(b, ship).find(c => c.heading === 60 && c.steps === 3);
  assert.ok(cell);
  const p = MovementPlanBuilder.build(b, ship.id, cell.x, cell.y);
  assert.equal(p.speedAfter, 3);
  MovementEngine.applyMoveResult(b, MovementEngine.getMoveResult(b, ship.id, cell.x, cell.y));
  MovementEngine.syncSailingState(b, ship);
  assert.equal(ship.speed, p.speedAfter);
});

test("short path to a boundary is selectable even below the mandatory distance, without boundary damage", () => {
  const b = fixture(), ship = b.ships[0];
  Object.assign(ship, { y: 1, speed: 6 });
  ship.stats.sm = 9; ship.stats.handling = 0;
  const before = structuredClone(ship.sections);
  const cell = MovementEngine.getReachableCells(b, ship).find(c => c.boundary);
  assert.ok(cell); assert.equal(cell.y, 0); assert.equal(cell.steps, 1);
  const p = MovementPlanBuilder.build(b, ship.id, cell.x, cell.y);
  assert.equal(p.speedAfter, 0); assert.equal(p.boundary, true);
  MovementEngine.applyMoveResult(b, MovementEngine.getMoveResult(b, ship.id, cell.x, cell.y));
  assert.equal(ship.y, 0); assert.equal(ship.speed, 0);
  assert.deepEqual(ship.sections, before);
  assert.equal(Boolean(ship.flags.withdrawn), false);
});

test("mandatory completion at the edge stops ships and creatures without direct impact damage", () => {
  for (const creature of [false, true]) {
    const b = fixture();
    if (creature) b.ships[0] = createCreature({ template: "skyRay", x: 12, y: 0, speed: 6, heading: 0, altitude: 4 });
    const unit = b.ships[0];
    unit.y = 0; unit.speed = 6; unit.heading = 0;
    unit.stats.sm = 9; unit.stats.handling = 0;
    if (creature) unit.movement.turnLimit = 0;
    const before = structuredClone(unit.sections);
    const state = MovementEngine.getHorizontalResolutionState(b, unit, { checkRoutes: true });
    assert.equal(state.boundaryStop, true);
    const result = MovementEngine.resolveHorizontalCompletion(b, unit);
    assert.equal(result.ok, true); assert.equal(result.boundary, true);
    assert.deepEqual(unit.sections, before);
    assert.equal(unit.speed, 0); assert.equal(unit.y, 0);
  }
});

test("real blocking terrain still causes emergency impact damage", () => {
  const b = fixture(), ship = b.ships[0];
  ship.speed = 6; ship.stats.sm = 9; ship.stats.handling = 0;
  ship.altitude = 0; b.board.terrain["12,9"] = ["rockHigh"];
  const before = ship.sections.bow.hp.value;
  const result = MovementEngine.resolveHorizontalCompletion(b, ship);
  assert.equal(result.ok, true); assert.equal(result.boundary, undefined);
  assert.ok(ship.sections.bow.hp.value < before);
});

test("boundary drift retains speed, does not withdraw, and agrees with forecast at all headings", () => {
  for (const direction of [0,60,120,180,240,300]) for (const creature of [false,true]) {
    const b = fixture();
    if (creature) b.ships[0] = createCreature({ template: "cloudJelly", speed: 3 });
    const unit = b.ships[0]; b.ships = [unit]; unit.speed = 3; unit.altitude = 4;
    Object.assign(unit, { x: direction === 60 || direction === 120 ? b.board.width - 1 : direction >= 240 ? 0 : 12,
      y: direction === 0 ? 0 : direction === 180 ? b.board.height - 1 : 10 });
    b.wind = { direction, strength: "storm" };
    const before = structuredClone(unit.sections);
    const prediction = MovementReadoutBuilder.forecast(b, unit);
    assert.equal(prediction.boundary, true);
    MovementEngine.advanceEndOfRoundMovement(b, { rng: () => .5 });
    assert.deepEqual(unit.sections, before);
    assert.equal(unit.speed, 3); assert.equal(Boolean(unit.flags.withdrawn), false);
    assert.deepEqual({ x: unit.x, y: unit.y }, prediction.path.at(-1));
  }
});

test("reaching an escape edge never withdraws without an explicit decision", () => {
  const b = fixture(), unit = b.ships[0]; unit.x = b.board.width - 1;
  const before = structuredClone(b);
  assert.deepEqual(VictoryEngine.processWithdrawals(b), []);
  assert.deepEqual(b, before);
  const preview = VictoryEngine.getWithdrawalPreview(b, unit);
  assert.equal(preview.successful, true);
  assert.equal(VictoryEngine.withdraw(b, unit).ok, true);
  assert.equal(unit.flags.withdrawalKind, "escape");
  assert.equal(VictoryEngine.evaluate(b).reason, "escape");
});

test("withdrawal through another edge is retreat and does not complete a breakthrough", () => {
  const b = fixture(), unit = b.ships[0]; unit.x = 0;
  assert.equal(VictoryEngine.getWithdrawalPreview(b, unit).successful, false);
  VictoryEngine.withdraw(b, unit);
  assert.equal(unit.flags.withdrawalKind, "retreat");
  assert.notEqual(VictoryEngine.evaluate(b).reason, "escape");
  assert.equal(BattleNormalizer.normalize(b).ships[0].flags.withdrawalKind, "retreat");
});

test("towing, grappling, attached creatures and falling prevent voluntary withdrawal", () => {
  for (const flag of ["towingId","grappledWith","falling"]) {
    const b = fixture(), unit = b.ships[0]; unit.x = 0; unit.flags[flag] = flag === "falling" ? true : "other";
    assert.equal(VictoryEngine.getWithdrawalPreview(b, unit).allowed, false);
    assert.equal(VictoryEngine.withdraw(b, unit).ok, false);
  }
  const b = fixture(), unit = b.ships[0]; unit.x = 0;
  b.ships.push(createCreature({ flags: { attachedTo: unit.id } }));
  assert.equal(VictoryEngine.withdraw(b, unit).ok, false);
});

test("an AI rout is not a successful scenario escape", () => {
  const b = fixture();
  b.ships[0] = createCreature({ template: "skyRay", side: b.setup.victory.objectiveSideId,
    behavior: { mode: "coward", controlledByAI: true }, vitality: { current: 46, max: 46, morale: 2 }, x: 12, y: 10, speed: 3 });
  VictoryEngine.captureInitialStrength(b);
  CreatureAIEngine.runMovement(b, b.ships[0]);
  assert.equal(b.ships[0].flags.withdrawalKind, "rout");
  assert.notEqual(VictoryEngine.evaluate(b).reason, "escape");
});

test("turn and withdrawal forecasts cannot mutate state or consume dice", () => {
  const b = fixture(), unit = b.ships[0]; unit.x = 0; unit.heading = 60; unit.flags.inIrons = true;
  const before = structuredClone(b), original = Math.random;
  Math.random = () => { throw new Error("Forecast rolled dice"); };
  try {
    const turn = MovementPlanBuilder.turn(b, unit, -1);
    assert.equal(turn.assessment.needsCheck, true);
    assert.ok(MovementPlanBuilder.withdrawal(b, unit));
    assert.deepEqual(b, before);
  } finally { Math.random = original; }
});
