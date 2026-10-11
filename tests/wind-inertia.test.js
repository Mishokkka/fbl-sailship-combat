import "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { MovementPlanBuilder } from "../scripts/context/movement-plan-builder.js";
import { MovementReadoutBuilder as Readout } from "../scripts/context/movement-readout-builder.js";
import { describeWindField } from "../scripts/visuals/wind-field.js";
import { cellToPixel, headingToVector } from "../scripts/board/board-geometry.js";

function fixture() {
  const battle = BattleNormalizer.normalize(createDefaultBattle());
  battle.setup.mode = "air"; battle.setupConfirmed = true; battle.phase = "movement";
  battle.board.terrain = {};
  battle.wind = { direction: 240, strength: "strong" };
  battle.ships = [battle.ships[0]];
  Object.assign(battle.ships[0], { x: 12, y: 10, heading: 0, speed: 3, altitude: 4, verticalVelocity: 0 });
  return battle;
}
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test("readouts do not mutate a frozen battle or consume randomness", () => {
  const b = freeze(fixture());
  const random = Math.random;
  Math.random = () => { throw new Error("Forecast must not roll"); };
  try {
    assert.equal(Readout.build(b, b.ships[0]).endOfRound.steps, 1);
    const cell = MovementEngine.getReachableCells(b, b.ships[0])[0];
    assert.ok(MovementPlanBuilder.build(b, b.ships[0].id, cell.x, cell.y).endOfRound);
  } finally { Math.random = random; }
});

test("forecast agrees with actual vertical movement then wind drift at all six headings", () => {
  for (const direction of [0, 60, 120, 180, 240, 300]) for (const velocity of [-1, 0, 1, 2]) {
    const b = fixture(), unit = b.ships[0];
    b.wind.direction = direction; b.wind.strength = "storm"; unit.verticalVelocity = velocity;
    const prediction = Readout.forecast(b, unit);
    MovementEngine.advanceEndOfRoundMovement(b, { rng: () => .5 });
    assert.equal(unit.altitude, prediction.altitudeEnd);
    assert.deepEqual({ x: unit.x, y: unit.y }, prediction.path.at(-1));
  }
});

test("sails braking preview follows the actual engine, including required path afterwards", () => {
  for (const speed of [0, 1, 3, 6]) {
    const b = fixture(), unit = b.ships[0]; unit.speed = speed;
    const preview = Readout.build(b, unit);
    MovementEngine.reduceSpeed(b, unit.id);
    assert.equal(unit.speed, preview.brakeSpeed);
    assert.equal(MovementEngine.getHorizontalResolutionState(b, unit).requiredAdvance, preview.brakeMinimum);
  }
});

test("drift tests occupancy at the projected altitude and stops before an obstacle", () => {
  const b = fixture(), unit = b.ships[0]; unit.verticalVelocity = 1;
  const v = headingToVector(b.wind.direction, unit.x, unit.y);
  const other = structuredClone(unit); other.id = "obstacle"; other.x += v.dx; other.y += v.dy;
  b.ships.push(other);
  assert.equal(Readout.forecast(b, unit).blocked, false, "Below the projected altitude");
  other.altitude = 5;
  const prediction = Readout.forecast(b, unit);
  assert.equal(prediction.blocked, true);
  assert.equal(prediction.hasPath, false);
  assert.match(prediction.warnings.join(" "), /столкновение/);
});

test("landing and attachment suppress a misleading exact drift position", () => {
  const b = fixture(), unit = b.ships[0]; unit.altitude = 1; unit.verticalVelocity = -2;
  assert.equal(Readout.forecast(b, unit).landing, true);
  assert.equal(Readout.forecast(b, unit).hasPath, false);
  const creature = createCreature("skyRay"); creature.flags.attachedTo = unit.id;
  assert.match(Readout.forecast(b, creature).driftText, /носителем/);
  unit.flags.coreExploded = true;
  assert.equal(Readout.forecast(b, unit).altitudeEnd, unit.altitude);
});

test("non-hovering creatures stall instead of drifting; hovering creatures drift normally", () => {
  for (const hover of [false, true]) {
    const b = fixture();
    const creature = createCreature("skyRay");
    Object.assign(creature, { x: 12, y: 10, altitude: 4, speed: 0 });
    creature.movement.canHover = hover; creature.movement.windResponse = "drifting";
    b.ships = [creature];
    const prediction = Readout.build(b, creature);
    assert.equal(prediction.stallOnStop, !hover);
    assert.equal(prediction.endOfRound.altitudeEnd, hover ? 4 : 2);
    MovementEngine.advanceEndOfRoundMovement(b, { rng: () => .5 });
    assert.equal(creature.altitude, prediction.endOfRound.altitudeEnd);
    assert.deepEqual({ x: creature.x, y: creature.y }, prediction.endOfRound.path.at(-1));
  }
});

test("delayed-turn cue follows the actual route and never extends through blocked terrain", () => {
  const b = fixture(), unit = b.ships[0]; unit.speed = 6;
  const cells = MovementEngine.getReachableCells(b, unit);
  const cue = Readout.turnCue(b, unit, cells);
  assert.ok(cue?.delay > 0);
  const turn = cells.find(c => c.heading !== unit.heading);
  assert.ok(turn);
  const beforeTurn = cellToPixel(b.board, turn.path[cue.delay - 1].x, turn.path[cue.delay - 1].y);
  assert.equal(cue.cx, beforeTurn.cx); assert.equal(cue.cy, beforeTurn.cy);
  assert.equal(Readout.turnCue(b, unit, []), null);
});

test("wind direction agrees with world geometry and workload is independent of map size", () => {
  for (const direction of [0, 60, 120, 180, 240, 300]) {
    for (const viewWidth of [320, 1200, 5000]) {
      const field = describeWindField({ direction, strength: "storm" }, { x: 100, y: 200, viewWidth, viewHeight: viewWidth * .8 });
      assert.equal(field.windParticles.length, 16);
      const delta = headingToVector(direction, 12, 10);
      const start = cellToPixel({}, 12, 10), end = cellToPixel({}, 12 + delta.dx, 10 + delta.dy);
      const radians = field.windParticleAngle * Math.PI / 180;
      const dot = (end.cx - start.cx) * Math.cos(radians) + (end.cy - start.cy) * Math.sin(radians);
      assert.ok(dot > 0);
      const cross = (end.cx - start.cx) * Math.sin(radians) - (end.cy - start.cy) * Math.cos(radians);
      assert.ok(Math.abs(cross) < 1e-6);
    }
  }
  const camera = { x: 0, y: 0, viewWidth: 1200, viewHeight: 900 };
  assert.equal(describeWindField({ strength: "calm" }, camera).windParticles.length, 0);
  assert.equal(describeWindField({ strength: "storm" }, camera, { enabled: false }).windParticles.length, 0);
});
