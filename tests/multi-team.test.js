import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createShip } from "../scripts/data/ship-factory.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { BattleScenarioService } from "../scripts/services/battle-scenario-service.js";
import { ShipTemplateService } from "../scripts/services/ship-template-service.js";
import { CreatureTemplateService } from "../scripts/services/creature-template-service.js";
import { CreatureAttackEngine } from "../scripts/engine/creature-attack-engine.js";
import { GunneryEngine } from "../scripts/engine/gunnery-engine.js";
import { VisibilityEngine } from "../scripts/engine/visibility-engine.js";
import { VictoryEngine } from "../scripts/engine/victory-engine.js";
import { TerrainGenerationService } from "../scripts/services/terrain-generation-service.js";

function threeSideBattle(units = []) {
  const battle = createDefaultBattle();
  battle.board = { width: 24, height: 18, cellSize: 48, terrainRevision: 1, terrain: {} };
  battle.setupConfirmed = true;
  battle.setup = BattleScenarioService.defaultSetup({ width: 24, height: 18, scenarioName: "Three sides" });
  const third = BattleScenarioService.addSide(battle);
  third.name = "Чудовище";
  battle.ships = units;
  battle.setup.victory = VictoryEngine.defaultConfig(BattleScenarioService.getSideIds(battle));
  return battle;
}

function sampleLine(from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
  const cells = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    cells.push({ x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) });
  }
  return cells;
}

test.beforeEach(() => installTestEnvironment());

test("explicit destination team is used for new ships and creatures", () => {
  const battle = threeSideBattle([]);
  const thirdSide = battle.setup.sideOrder[2];
  const ship = ShipTemplateService.createShipFromTemplate("brigantine", { battle, side: thirdSide });
  battle.ships.push(ship);
  const creature = CreatureTemplateService.createCreatureFromTemplate("skyRay", { battle, side: thirdSide });

  assert.equal(ship.side, thirdSide);
  assert.equal(creature.side, thirdSide);
  assert.ok(ship.x >= battle.setup.sides[thirdSide].zone.x1 && ship.x <= battle.setup.sides[thirdSide].zone.x2);
  assert.ok(creature.y >= battle.setup.sides[thirdSide].zone.y1 && creature.y <= battle.setup.sides[thirdSide].zone.y2);
  assert.notDeepEqual([ship.x, ship.y], [creature.x, creature.y]);
});

test("a creature treats both other teams as hostile", () => {
  const blue = createShip({ id: "blue", name: "Blue", side: "blue", x: 5, y: 4, heading: 180, template: "brigantine" });
  const red = createShip({ id: "red", name: "Red", side: "red", x: 6, y: 5, heading: 180, template: "brigantine" });
  const monster = createCreature({ id: "monster", side: "side3", x: 5, y: 5, heading: 0, template: "skyRay" });
  for (const unit of [blue, red, monster]) unit.altitude = 3;
  monster.attacks[0].arc = "all";
  monster.attacks[0].range = 2;
  const battle = threeSideBattle([blue, red, monster]);

  const ids = CreatureAttackEngine.getTargets(battle, monster, monster.attacks[0].id).map(entry => entry.target.id).sort();
  assert.deepEqual(ids, ["blue", "red"]);
});



test("ship gunnery treats every other team as hostile", () => {
  const attacker = createShip({ id: "attacker", name: "Attacker", side: "blue", x: 5, y: 5, heading: 0, template: "frigate" });
  const red = createShip({ id: "red", name: "Red", side: "red", x: 5, y: 4, heading: 180, template: "brigantine" });
  const monster = createCreature({ id: "monster", side: "side3", x: 6, y: 5, heading: 180, template: "skyRay" });
  for (const unit of [attacker, red, monster]) unit.altitude = 3;
  attacker.weapons[0].arc = "swivel";
  attacker.weapons[0].range = 4;
  const battle = threeSideBattle([attacker, red, monster]);

  const ids = GunneryEngine.getTargets(battle, attacker, "swivel").map(entry => entry.target.id).sort();
  assert.deepEqual(ids, ["monster", "red"]);
});

test("player visibility tracks contacts from two independent hostile teams", () => {
  const observer = createShip({ id: "observer", name: "Observer", side: "blue", x: 5, y: 5, heading: 0, template: "brigantine" });
  const red = createShip({ id: "red", name: "Red", side: "red", x: 5, y: 4, heading: 180, template: "brigantine" });
  const monster = createCreature({ id: "monster", side: "side3", x: 6, y: 5, heading: 180, template: "skyRay" });
  for (const unit of [observer, red, monster]) unit.altitude = 3;
  const battle = threeSideBattle([observer, red, monster]);
  battle.playerAssignments = { "player-a": { shipIds: [observer.id], side: "blue" } };

  VisibilityEngine.updateContacts(battle);
  const contacts = battle.playerVisibility.contacts["player-a"];
  assert.equal(contacts.red.state, "identified");
  assert.equal(contacts.monster.state, "identified");
  assert.equal(contacts.red.side, "red");
  assert.equal(contacts.monster.side, "side3");
});

test("three-side elimination waits until only one team remains", () => {
  const blue = createShip({ id: "blue", name: "Blue", side: "blue", x: 2, y: 2, heading: 0, template: "brigantine" });
  const red = createShip({ id: "red", name: "Red", side: "red", x: 10, y: 10, heading: 180, template: "brigantine" });
  const monster = createCreature({ id: "monster", side: "side3", x: 12, y: 10, heading: 180, template: "skyRay" });
  const battle = threeSideBattle([blue, red, monster]);
  VictoryEngine.captureInitialStrength(battle);

  red.flags.struck = true;
  assert.equal(VictoryEngine.evaluate(battle).resolved, false);

  monster.flags.struck = true;
  const outcome = VictoryEngine.evaluate(battle);
  assert.equal(outcome.resolved, true);
  assert.equal(outcome.winnerSideId, "blue");
});

test("failed escape does not award an arbitrary winner among multiple defenders", () => {
  const runner = createShip({ id: "runner", name: "Runner", side: "blue", x: 2, y: 2, heading: 0, template: "brigantine" });
  const red = createShip({ id: "red", name: "Red", side: "red", x: 10, y: 10, heading: 180, template: "brigantine" });
  const monster = createCreature({ id: "monster", side: "side3", x: 12, y: 10, heading: 180, template: "skyRay" });
  const battle = threeSideBattle([runner, red, monster]);
  battle.setup.victory.mode = "escape";
  battle.setup.victory.objectiveSideId = "blue";
  battle.setup.victory.requiredShips = 1;
  VictoryEngine.captureInitialStrength(battle);
  runner.flags.struck = true;

  const outcome = VictoryEngine.evaluate(battle);
  assert.equal(outcome.resolved, true);
  assert.equal(outcome.reason, "escapeDenied");
  assert.equal(outcome.winnerSideId, null);
  assert.match(outcome.summary, /автоматический победитель/);
});

test("a non-empty team cannot be deleted silently", () => {
  const battle = threeSideBattle([]);
  const thirdSide = battle.setup.sideOrder[2];
  battle.ships.push(createCreature({ id: "monster", side: thirdSide, x: 4, y: 4, template: "skyRay" }));
  assert.equal(BattleScenarioService.removeSide(battle, thirdSide), false);
  battle.ships = [];
  assert.equal(BattleScenarioService.removeSide(battle, thirdSide), true);
  assert.equal(battle.setup.sideOrder.includes(thirdSide), false);
});

test("generated terrain gives every team a blocking-free route toward the center", () => {
  const battle = threeSideBattle([]);
  const generated = TerrainGenerationService.generate({
    board: battle.board,
    scenarioId: "skyArchipelago",
    mode: "air",
    sides: battle.setup.sides,
    seed: "three-team-regression"
  });
  const center = { x: (battle.board.width - 1) / 2, y: (battle.board.height - 1) / 2 };
  const blocking = new Set(["rockHigh", "skyIsland"]);

  for (const side of Object.values(battle.setup.sides)) {
    const from = { x: (side.zone.x1 + side.zone.x2) / 2, y: (side.zone.y1 + side.zone.y2) / 2 };
    for (const cell of sampleLine(from, center)) {
      const terrain = generated.terrain[`${cell.x},${cell.y}`] ?? [];
      assert.equal(terrain.some(type => blocking.has(type)), false, `${side.id} lane blocked at ${cell.x},${cell.y}`);
    }
  }
});
