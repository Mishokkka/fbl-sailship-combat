import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createShip } from "../scripts/data/ship-factory.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { CollisionEngine } from "../scripts/engine/collision-engine.js";
import { BoardingEngine } from "../scripts/engine/boarding-engine.js";
import { GunneryEngine } from "../scripts/engine/gunnery-engine.js";
import { DamageEngine } from "../scripts/engine/damage-engine.js";
import { CreatureAttackEngine } from "../scripts/engine/creature-attack-engine.js";
import { VictoryEngine } from "../scripts/engine/victory-engine.js";
import { buildHexGridPath, clearHexGridPathCache, getHexGridPathCacheStats } from "../scripts/board/board-geometry.js";

function battleWith(units, terrain = {}) {
  return {
    id: "battle",
    round: 1,
    phase: "movement",
    setupConfirmed: true,
    board: { width: 20, height: 20, cellSize: 48, terrainRevision: 1, terrain },
    setup: {
      mode: "air",
      sideOrder: ["blue", "red"],
      sides: { blue: { name: "Blue" }, red: { name: "Red" } },
      victory: VictoryEngine.defaultConfig(["blue", "red"])
    },
    wind: { direction: 240, strength: "light" },
    sea: { state: "calm", visibility: "clear" },
    turn: { activeShipId: units[0]?.id, actions: {}, phaseOrder: {}, initiative: {}, completed: {}, movementReservations: {} },
    playerAssignments: {},
    pendingOrders: {},
    playerVisibility: { contacts: {}, observations: {} },
    ships: units,
    log: []
  };
}

test.beforeEach(() => installTestEnvironment());

test("hex grid path cache records hits and stays bounded", () => {
  clearHexGridPathCache();
  const board = { width: 12, height: 10, cellSize: 48 };
  const first = buildHexGridPath(board);
  const second = buildHexGridPath(board);
  assert.equal(first, second);
  const stats = getHexGridPathCacheStats();
  assert.equal(stats.misses, 1);
  assert.equal(stats.hits, 1);
  for (let index = 0; index < 20; index += 1) buildHexGridPath({ width: 8 + index, height: 8, cellSize: 40 });
  assert.ok(getHexGridPathCacheStats().size <= getHexGridPathCacheStats().limit);
});

test("path generation respects heading and board edge", () => {
  const ship = { x: 5, y: 5 };
  assert.deepEqual(MovementEngine.getPathCells(ship, 0, 2).map(cell => [cell.x, cell.y]), [[5, 4], [5, 3]]);
  const clipped = MovementEngine.getPathCells({ x: 0, y: 0 }, 0, 5, { board: { width: 8, height: 8 }, boardTerrain: {} });
  assert.equal(clipped.length, 0);
});

test("blocking rock prevents a straight reachable destination", () => {
  const ship = createShip({ id: "ship", name: "Ship", side: "blue", x: 5, y: 5, heading: 0, template: "brigantine" });
  ship.speed = 2;
  ship.altitude = 0;
  const battle = battleWith([ship], { "5,4": ["rockHigh"] });
  const reachable = MovementEngine.getReachableCells(battle, ship);
  assert.equal(reachable.some(cell => cell.x === 5 && cell.y <= 4), false);
});

test("collision preview classifies contact and produces damage", () => {
  const attacker = createShip({ id: "a", name: "A", side: "blue", x: 5, y: 5, heading: 0, template: "frigate" });
  const target = createShip({ id: "b", name: "B", side: "red", x: 5, y: 4, heading: 180, template: "brigantine" });
  attacker.speed = 4;
  target.speed = 2;
  const preview = CollisionEngine.previewShipCollision(attacker, target, { angle: 180, attackerSpeed: 4, targetSpeed: 2 });
  assert.ok(preview);
  assert.ok(preview.attackerDamage >= 0);
  assert.ok(preview.targetDamage > 0);
  assert.ok(["touch", "headOn", "broadside"].includes(preview.contactType));
});

test("grapple and release maintain reciprocal links", () => {
  const a = createShip({ id: "a", name: "A", side: "blue", x: 5, y: 5, heading: 0, template: "brigantine" });
  const b = createShip({ id: "b", name: "B", side: "red", x: 5, y: 4, heading: 180, template: "brigantine" });
  const battle = battleWith([a, b]);
  const result = BoardingEngine.grapple(battle, "a", "b");
  assert.equal(result.ok, true);
  assert.equal(a.flags.grappledWith, "b");
  assert.equal(b.flags.grappledWith, "a");
  BoardingEngine.release(battle, "a");
  assert.equal(a.flags.grappledWith ?? null, null);
  assert.equal(b.flags.grappledWith ?? null, null);
});

test("bow battery finds targets ahead but not abeam", () => {
  const attacker = createShip({ id: "a", name: "A", side: "blue", x: 5, y: 5, heading: 0, template: "brigantine" });
  const ahead = createShip({ id: "ahead", name: "Ahead", side: "red", x: 5, y: 3, heading: 180, template: "brigantine" });
  const abeam = createShip({ id: "abeam", name: "Abeam", side: "red", x: 8, y: 5, heading: 180, template: "brigantine" });
  for (const unit of [attacker, ahead, abeam]) unit.altitude = 4;
  const targets = GunneryEngine.getTargets(battleWith([attacker, ahead, abeam]), attacker, "bow");
  assert.deepEqual(targets.map(entry => entry.target.id), ["ahead"]);
});

test("high rock blocks direct gunfire", () => {
  const attacker = createShip({ id: "a", name: "A", side: "blue", x: 5, y: 5, heading: 0, template: "brigantine" });
  const target = createShip({ id: "target", name: "Target", side: "red", x: 5, y: 2, heading: 180, template: "brigantine" });
  attacker.altitude = 1;
  target.altitude = 1;
  const targets = GunneryEngine.getTargets(battleWith([attacker, target], { "5,4": ["rockHigh"] }), attacker, "bow");
  assert.equal(targets.length, 0);
});

test("manual damage and fire change the selected section", () => {
  const ship = createShip({ id: "ship", name: "Ship", side: "blue", x: 0, y: 0, heading: 0, template: "brigantine" });
  const before = ship.sections.midship.hp.value;
  DamageEngine.addManualDamage(ship, 5, "midship");
  DamageEngine.addManualFire(ship, "midship");
  assert.equal(ship.sections.midship.hp.value, Math.max(0, before - 5));
  assert.ok(ship.sections.midship.fire >= 1);
});

test("creature attack targets an adjacent hostile combatant", () => {
  const creature = createCreature({ id: "beast", side: "red", x: 5, y: 5, heading: 0, template: "skyRay" });
  const ship = createShip({ id: "ship", name: "Ship", side: "blue", x: 5, y: 4, heading: 180, template: "brigantine" });
  creature.altitude = ship.altitude = 3;
  const attack = creature.attacks[0];
  attack.range = Math.max(1, attack.range);
  const targets = CreatureAttackEngine.getTargets(battleWith([creature, ship]), creature, attack.id);
  assert.ok(targets.some(entry => entry.target.id === "ship"));
});

test("victory resolves when only one participating side remains operational", () => {
  const winner = createShip({ id: "winner", name: "Winner", side: "blue", x: 2, y: 2, heading: 0, template: "brigantine" });
  const loser = createShip({ id: "loser", name: "Loser", side: "red", x: 10, y: 10, heading: 180, template: "brigantine" });
  loser.flags.struck = true;
  const battle = battleWith([winner, loser]);
  battle.setup.victory.initialShipCount = { blue: 1, red: 1 };
  battle.setup.victory.initialStrength = { blue: VictoryEngine.shipStrength(winner), red: VictoryEngine.shipStrength(loser) };
  const outcome = VictoryEngine.evaluate(battle);
  assert.equal(outcome.resolved, true);
  assert.equal(outcome.winnerSideId, "blue");
  assert.equal(outcome.reason, "elimination");
});
