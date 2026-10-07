import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { MovementPlanBuilder } from "../scripts/context/movement-plan-builder.js";

foundry.applications = { api: {
  ApplicationV2: class { constructor() { this.options = this.constructor.DEFAULT_OPTIONS; } },
  HandlebarsApplicationMixin: Base => Base
} };
const { NavalBattleApp } = await import("../scripts/apps/naval-battle-app.js");
test.beforeEach(() => installTestEnvironment());

function fixture() {
  const battle = BattleNormalizer.normalize(createDefaultBattle());
  battle.setupConfirmed = true;
  battle.phase = "movement";
  battle.revision = 7;
  battle.board.terrain = {};
  battle.wind = { direction: 240, strength: "light" };
  Object.assign(battle.ships[0], { x: 12, y: 10, heading: 0, speed: 3, altitude: 4 });
  battle.turn.activeShipId = battle.ships[0].id;
  battle.turn.phaseOrder.movement = battle.ships.map(ship => ship.id);
  return battle;
}
function destination(battle) {
  const cells = MovementEngine.getReachableCells(battle, battle.ships[0]);
  const cell = cells.find(cell => !cell.collision && cell.heading === 0) ?? cells[0];
  assert.ok(cell, "Fixture has a reachable destination");
  return cell;
}
function harness(battle = fixture()) {
  let stored = structuredClone(battle);
  const app = new NavalBattleApp();
  const state = { app, commits: 0, mode: "allow", beforeMutation: null, afterMutation: null,
    read: () => structuredClone(stored), change: fn => fn(stored) };
  app.selectedShipId = battle.ships[0].id;
  app.renderBattleState = async () => { app.movementPlan.getContext(app.renderBattleSnapshot ?? stored); };
  game.sailshipsCombat = { storage: {
    getBattleForUser: () => structuredClone(stored),
    async updateBattle(mutator) {
      if (state.mode === "deny") return structuredClone(stored);
      await state.beforeMutation?.();
      const next = structuredClone(stored);
      if (await mutator(next) === false || state.mode === "deny-after-mutation") return structuredClone(stored);
      await state.afterMutation?.();
      if (state.mode === "fail") throw new Error("Simulated storage failure");
      next.revision++;
      stored = next;
      state.commits++;
      return structuredClone(stored);
    }
  } };
  return state;
}

test("preview is read-only and consumes no randomness; normal execution matches it", () => {
  const battle = fixture();
  const cell = destination(battle);
  const before = structuredClone(battle);
  const random = Math.random;
  let preview;
  try {
    Math.random = () => { throw new Error("Preview must not roll"); };
    preview = MovementPlanBuilder.build(battle, battle.ships[0].id, cell.x, cell.y);
  } finally { Math.random = random; }
  assert.deepEqual(battle, before);
  const result = MovementEngine.getMoveResult(battle, battle.ships[0].id, cell.x, cell.y);
  MovementEngine.applyMoveResult(battle, result);
  MovementEngine.syncSailingState(battle, battle.ships[0]);
  assert.deepEqual([battle.ships[0].x, battle.ships[0].y, battle.ships[0].heading, battle.ships[0].speed],
    [preview.stopX, preview.stopY, preview.heading, preview.speedAfter]);
});

test("planning, replacing and cancelling do not change AP, logs, position or revision", async () => {
  const state = harness();
  const before = state.read();
  const cells = MovementEngine.getReachableCells(before, before.ships[0]);
  await state.app._moveSelectedShip(cells[0].x, cells[0].y);
  assert.ok(state.app.movementPlan.pending);
  await state.app._moveSelectedShip(cells.at(-1).x, cells.at(-1).y);
  assert.equal(state.app.movementPlan.pending.x, cells.at(-1).x);
  await state.app.movementPlan.cancel();
  assert.equal(state.app.movementPlan.pending, null);
  assert.deepEqual(state.read(), before);
  assert.equal(state.commits, 0);
});

test("confirmation spends one AP, moves once and selects the next unit", async () => {
  const state = harness();
  const cell = destination(state.read());
  const id = state.app.selectedShipId;
  await state.app._moveSelectedShip(cell.x, cell.y);
  const plan = state.app.movementPlan.pending.preview;
  await state.app.movementPlan.confirm();
  const saved = state.read();
  assert.equal(state.commits, 1);
  assert.equal(saved.turn.actions[id].movement._apSpent, 1);
  assert.equal(saved.turn.actions[id].movement.move, true);
  assert.ok(saved.turn.completed.movement.includes(id));
  assert.equal(saved.ships[0].x, plan.stopX);
  assert.equal(saved.ships[0].y, plan.stopY);
  assert.equal(state.app.selectedShipId, saved.turn.activeShipId);
  assert.notEqual(state.app.selectedShipId, id);
  assert.match(state.app.movementPlan.notice, /манёвр выполнен/);
});

test("revision, selection, phase, active unit and route changes are rejected inside the queue", async () => {
  for (const change of [
    state => state.change(battle => battle.revision++),
    state => { state.app.selectedShipId = state.read().ships[1].id; },
    state => state.change(battle => { battle.phase = "gunnery"; }),
    state => state.change(battle => { battle.turn.activeShipId = battle.ships[1].id; }),
    state => state.change(battle => { battle.ships[0].speed = 0; }),
    state => state.change(battle => { battle.outcome = { resolved: true }; })
  ]) {
    const state = harness();
    const cell = destination(state.read());
    await state.app._moveSelectedShip(cell.x, cell.y);
    state.beforeMutation = () => change(state);
    await state.app.movementPlan.confirm();
    const saved = state.read();
    assert.equal(state.commits, 0);
    assert.equal(saved.lastMovement, undefined);
    assert.equal(saved.turn.actions[saved.ships[0].id]?.movement?.move, undefined);
    assert.match(state.app.movementPlan.notice, /изменилась/);
  }
});

test("a pending write ignores repeated confirmation and preserves later selection", async () => {
  const state = harness();
  const cell = destination(state.read());
  await state.app._moveSelectedShip(cell.x, cell.y);
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  state.afterMutation = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const first = state.app.movementPlan.confirm();
  await started;
  await state.app.movementPlan.confirm();
  await state.app.movementPlan.cancel();
  state.app.selectedShipId = "observer-selection";
  release();
  await first;
  assert.equal(state.commits, 1);
  assert.equal(state.app.selectedShipId, "observer-selection");
});

test("denied and failed writes do not announce completion or advance selection", async () => {
  for (const mode of ["deny", "deny-after-mutation", "fail"]) {
    const state = harness();
    const before = state.read();
    const cell = destination(before);
    await state.app._moveSelectedShip(cell.x, cell.y);
    state.mode = mode;
    const error = console.error;
    try { console.error = () => {}; await state.app.movementPlan.confirm(); }
    finally { console.error = error; }
    assert.equal(state.commits, 0);
    assert.deepEqual(state.read(), before);
    assert.equal(state.app.selectedShipId, before.ships[0].id);
    assert.doesNotMatch(state.app.movementPlan.notice, /манёвр выполнен/);
    assert.equal(state.app.movementPlan.busy, false);
    state.mode = "allow";
    await state.app.movementPlan.confirm();
    assert.equal(state.commits, 1, "An unchanged draft can be retried");
  }
});

test("collision preview stops before contact and excludes contact terrain damage", () => {
  const battle = fixture();
  const path = MovementEngine.getPathCells(battle.ships[0], 0, 2, battle);
  Object.assign(battle.ships[1], { x: path[1].x, y: path[1].y, altitude: 4, heading: 180 });
  battle.board.terrain[`${path[1].x},${path[1].y}`] = ["stormCloud"];
  const cell = MovementEngine.getReachableCells(battle, battle.ships[0]).find(cell => cell.collision);
  assert.ok(cell);
  const preview = MovementPlanBuilder.build(battle, battle.ships[0].id, cell.x, cell.y);
  assert.equal(preview.collision, true);
  assert.deepEqual([preview.stopX, preview.stopY], [cell.stopX, cell.stopY]);
  assert.equal(preview.distance, cell.path.length - 1);
  assert.ok(preview.contact);
  assert.ok(preview.warnings.some(text => /столкновение|касание/.test(text)));
  assert.ok(!preview.warnings.some(text => /грозовом/.test(text)));
});

test("terrain braking forecast matches execution and vertical projection uses destination", () => {
  const battle = fixture();
  battle.setup.mode = "mixed";
  const ship = battle.ships[0];
  ship.altitude = 0;
  const cell = destination(battle);
  battle.board.terrain[`${cell.x},${cell.y}`] = ["reef"];
  const preview = MovementPlanBuilder.build(battle, ship.id, cell.x, cell.y);
  assert.ok(preview.warnings.some(text => /Риф/.test(text)));
  MovementEngine.applyMoveResult(battle, MovementEngine.getMoveResult(battle, ship.id, cell.x, cell.y));
  MovementEngine.syncSailingState(battle, ship);
  assert.equal(ship.speed, preview.speedAfter);

  const air = fixture();
  const end = destination(air);
  air.ships[0].verticalVelocity = -1;
  air.board.terrain[`${end.x},${end.y}`] = ["downdraft"];
  const forecast = MovementPlanBuilder.build(air, air.ships[0].id, end.x, end.y);
  assert.equal(forecast.altitudeNow, 4);
  assert.equal(forecast.altitudeEnd, 2);
  Object.assign(air.ships[0], { x: end.x, y: end.y });
  MovementEngine.applyVerticalInertia(air, air.ships[0]);
  assert.equal(air.ships[0].altitude, forecast.altitudeEnd);
});

test("creatures use the same planning workflow and show their terrain effects", async () => {
  const battle = fixture();
  battle.ships[0] = createCreature({ id: "ray", side: "blue", x: 12, y: 10, heading: 0, speed: 3 });
  battle.turn.activeShipId = "ray";
  battle.turn.phaseOrder.movement = battle.ships.map(ship => ship.id);
  const cell = destination(battle);
  battle.board.terrain[`${cell.x},${cell.y}`] = ["turbulence"];
  const state = harness(battle);
  await state.app._moveSelectedShip(cell.x, cell.y);
  assert.ok(state.app.movementPlan.pending.preview.warnings.some(text => /Турбулентность/.test(text)));
  await state.app.movementPlan.confirm();
  assert.equal(state.commits, 1);
  assert.equal(state.read().ships[0].flags.stunned, 1);
});

test("mandatory inertial movement can be confirmed at zero AP", async () => {
  const battle = fixture();
  battle.ships[0].speed = 4;
  battle.turn.actions[battle.ships[0].id] = { movement: { _apSpent: 2 } };
  const state = harness(battle);
  const cell = destination(battle);
  await state.app._moveSelectedShip(cell.x, cell.y);
  assert.equal(state.app.movementPlan.pending.preview.apCost, 0);
  await state.app.movementPlan.confirm();
  assert.equal(state.commits, 1);
  assert.equal(state.read().turn.actions[battle.ships[0].id].movement._apSpent, 2);
});

test("players, setup and completed battles cannot create a movement draft", async () => {
  for (const change of [
    state => { game.user.isGM = false; },
    state => state.change(battle => { battle.setupConfirmed = false; }),
    state => state.change(battle => { battle.outcome = { resolved: true }; })
  ]) {
    installTestEnvironment();
    const state = harness();
    const cell = destination(state.read());
    change(state);
    await state.app.movementPlan.stage(cell.x, cell.y);
    assert.equal(state.app.movementPlan.pending, null);
    assert.equal(state.commits, 0);
  }
});

test("a draft invalidated during a queued confirmation cannot become valid again", async () => {
  const state = harness();
  const cell = destination(state.read());
  await state.app._moveSelectedShip(cell.x, cell.y);
  const selected = state.app.selectedShipId;
  state.beforeMutation = () => {
    state.app.selectedShipId = state.read().ships[1].id;
    state.app.movementPlan.getContext(state.read());
    state.app.selectedShipId = selected;
  };
  await state.app.movementPlan.confirm();
  assert.equal(state.commits, 0);
  assert.equal(state.read().lastMovement, undefined);
});
