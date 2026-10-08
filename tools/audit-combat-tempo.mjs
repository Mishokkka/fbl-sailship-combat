// Reproducible four-ship rules benchmark; no wall-clock/player-thinking claims.
import "../tests/test-env.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createShip } from "../scripts/data/ship-factory.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { GunneryEngine } from "../scripts/engine/gunnery-engine.js";
import { VictoryEngine } from "../scripts/engine/victory-engine.js";
import { CrewTaskService } from "../scripts/services/crew-task-service.js";
import { CombatantRules } from "../scripts/rules/combatant-rules.js";

foundry.applications = { api: {
  ApplicationV2: class { constructor() { this.options = this.constructor.DEFAULT_OPTIONS; } },
  HandlebarsApplicationMixin: Base => Base
} };
game.i18n = { localize: key => key };
const { NavalBattleApp } = await import("../scripts/apps/naval-battle-app.js");
const ROUND_CAP = 12;
const SEEDS = [7, 41, 20261008];
const originalRandom = Math.random;
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hull = ship => Object.values(ship.sections).reduce((sum, sec) => sum + sec.hp.value, 0);
function fixture(scenario) {
  const battle = createDefaultBattle();
  battle.id = "tempo-" + scenario;
  battle.name = "Контрольный бой: " + scenario;
  battle.setupConfirmed = true;
  battle.board = { width: 30, height: 30, cellSize: 48, terrain: {}, terrainRevision: 1 };
  battle.wind = { direction: 240, strength: "light" };
  battle.log = [];
  battle.ships = [
    ["blue-brig", "Синий бриг", "blue", 10, 20, "brigantine"],
    ["blue-sloop", "Синий шлюп", "blue", 10, 25, "sloop"],
    ["red-brig", "Красный бриг", "red", 14, 20, "brigantine"],
    ["red-sloop", "Красный шлюп", "red", 14, 25, "sloop"]
  ].map(([id, name, side, x, y, template]) => {
    const ship = createShip({ id, name, side, x, y, template, heading: 0 });
    ship.altitude = 4;
    ship.speed = scenario === "parallel" ? 1 : 0;
    for (const weapon of ship.weapons) {
      weapon.fireMode = "full";
      weapon.ammo = weapon.type === "swivel" ? "grapeShot" : "roundShot";
    }
    return ship;
  });
  const normalized = BattleNormalizer.normalize(battle);
  normalized.setup.victory.roundLimit = ROUND_CAP;
  VictoryEngine.captureInitialStrength(normalized);
  return normalized;
}
function shotChoices(battle, ship, ignoreReload = false) {
  // Target/weapon preview normalizes ammo; keep that work off the stored battle.
  const copy = structuredClone(battle);
  const source = copy.ships.find(unit => unit.id === ship.id);
  if (ignoreReload) for (const weapon of source.weapons) weapon.reload = 0;
  return source.weapons.flatMap(weapon =>
    GunneryEngine.getTargets(copy, source, weapon.arc).map(entry => ({
      weaponId: weapon.id, arc: weapon.arc, targetId: entry.target.id,
      range: entry.range, chance: entry.preview.hitChance,
      expectedDamage: entry.preview.expectedDamage,
      score: entry.preview.hitChance * entry.preview.expectedDamage
    }))
  ).sort((a, b) => b.score - a.score || a.range - b.range || a.targetId.localeCompare(b.targetId));
}
function summarizeShip(ship) {
  return { id: ship.id, hull: hull(ship), crew: ship.crew.current, morale: ship.crew.morale,
    x: ship.x, y: ship.y, speed: ship.speed, altitude: ship.altitude,
    struck: Boolean(ship.flags.struck), withdrawn: Boolean(ship.flags.withdrawn) };
}
async function run(scenario, seed) {
  Math.random = seededRandom(seed);
  let stored = fixture(scenario);
  const initial = structuredClone(stored);
  const app = new NavalBattleApp();
  app.renderBattleState = async () => {};
  game.sailshipsCombat = { storage: {
    getBattleForUser: () => structuredClone(stored),
    async updateBattle(mutator) {
      const next = structuredClone(stored);
      if (await mutator(next) === false) return structuredClone(stored);
      next.revision = stored.revision + 1;
      stored = BattleNormalizer.normalize(next);
      return structuredClone(stored);
    }
  } };
  app.phase.startPhase(stored, "orders");
  const summary = {
    scenario, seed, roundsSettled: 0, activations: { orders: 0, movement: 0, gunnery: 0, crew: 0 },
    empty: { movement: 0, gunnery: 0, crew: 0 }, phaseTransitions: 0,
    shots: 0, hits: 0, hullDamageShots: 0, reloadOnlyPasses: 0, otherGunneryPasses: 0,
    crewTasks: 0, movementPlans: 0, manualPasses: 0, firstHitRound: null,
    firstHullDamageRound: null, firstTenPercentHullLossRound: null, firstStruckRound: null,
    batteryShotIntervals: [], shipShotIntervals: []
  };
  const trace = [], previousBatteryShots = new Map(), previousShipShots = new Map();
  let steps = 0;
  const scanDamage = round => {
    for (const ship of stored.ships) {
      const start = initial.ships.find(unit => unit.id === ship.id);
      if (hull(ship) <= hull(start) * 0.9) summary.firstTenPercentHullLossRound ??= round;
      if (ship.flags.struck) summary.firstStruckRound ??= round;
    }
  };
  const pass = async () => {
    summary.manualPasses++;
    assert.equal(await app.phase.passTurn(), true, "Activation must finish");
  };
  while (!stored.outcome?.resolved && stored.round <= ROUND_CAP) {
    assert.ok(++steps <= ROUND_CAP * 24, "Battle loop must remain bounded");
    const round = stored.round, phase = stored.phase;
    const ship = app.phase.getActiveShip(stored);
    if (!ship) {
      const beforeRound = stored.round;
      assert.equal(await app.phase.nextPhase(), true, "Phase transition must commit");
      summary.phaseTransitions++;
      if (phase === "crew") summary.roundsSettled = beforeRound;
      scanDamage(round);
      trace.push({ round, phase, action: "next-phase", ships: stored.ships.map(summarizeShip) });
      continue;
    }
    const id = ship.id;
    app.selectedShipId = id;
    app.selectedTargetId = null;
    app.aimSection = null;
    summary.activations[phase]++;
    const event = { round, phase, ship: id, actions: [] };
    const revision = stored.revision;
    if (phase === "orders") {
      const urgent = CrewTaskService.tasks(stored, ship).some(task => task.repairable && task.priority >= 75);
      const order = urgent ? "damageControl" : "steadyGunnery";
      await app.orders.setOrder(order);
      event.actions.push({ order });
    } else if (phase === "movement") {
      const route = MovementEngine.getReachableCells(stored, ship)
        .filter(cell => !cell.collision && cell.steeringDelta === 0)
        .sort((a, b) => b.steps - a.steps)[0];
      if (route) {
        await app.movementPlan.stage(route.x, route.y);
        assert.ok(app.movementPlan.pending, "Legal route must produce a preview");
        await app.movementPlan.confirm();
        assert.equal(app.movementPlan.pending, null, "Movement must commit");
        summary.movementPlans++;
        event.actions.push({ move: [route.x, route.y] });
      } else summary.empty.movement++;
      if (stored.turn.activeShipId === id) await pass();
    } else if (phase === "gunnery") {
      const shot = shotChoices(stored, ship)[0];
      if (shot) {
        const beforeHull = hull(stored.ships.find(unit => unit.id === shot.targetId));
        app.selectedTargetId = shot.targetId;
        await app.gunnery.fireArc(shot.arc, { dataset: { weaponId: shot.weaponId, targetId: shot.targetId } });
        assert.equal(stored.lastReport?.kind, "salvo");
        assert.equal(stored.lastReport.sourceId, id);
        summary.shots++;
        if (stored.lastReport.outcome === "hit") { summary.hits++; summary.firstHitRound ??= round; }
        if (hull(stored.ships.find(unit => unit.id === shot.targetId)) < beforeHull) {
          summary.hullDamageShots++; summary.firstHullDamageRound ??= round;
        }
        for (const [map, key, values] of [
          [previousBatteryShots, id + ":" + shot.weaponId, summary.batteryShotIntervals],
          [previousShipShots, id, summary.shipShotIntervals]
        ]) {
          if (map.has(key)) values.push(round - map.get(key));
          map.set(key, round);
        }
        event.actions.push({ shot, outcome: stored.lastReport.outcome, details: stored.lastReport.details });
      } else {
        const reason = shotChoices(stored, ship, true).length ? "reload-only" : "geometry-or-damage";
        summary.empty.gunnery++;
        if (reason === "reload-only") summary.reloadOnlyPasses++; else summary.otherGunneryPasses++;
        event.actions.push({ pass: reason });
        await pass();
      }
    } else if (phase === "crew") {
      for (let attempt = 0; attempt < 2 && stored.turn.activeShipId === id; attempt++) {
        const current = stored.ships.find(unit => unit.id === id);
        const used = stored.turn.actions?.[id]?.crew ?? {};
        const task = CrewTaskService.tasks(stored, current).find(task => task.repairable && !used[task.actionKey]);
        if (!task) break;
        const beforeRevision = stored.revision;
        await app.crew.performTask(task.id, { dataset: { shipId: id, revision: String(beforeRevision) } });
        assert.ok(stored.revision > beforeRevision, "Crew task must commit");
        summary.crewTasks++;
        event.actions.push({ task: task.id, details: stored.lastReport.details });
      }
      if (!event.actions.length) summary.empty.crew++;
      if (stored.turn.activeShipId === id) await pass();
    } else assert.fail("Unexpected activation phase: " + phase);
    assert.ok(stored.revision > revision, "Every activation must commit progress");
    scanDamage(round);
    trace.push(event);
  }
  summary.outcome = stored.outcome?.reason ?? "round-cap";
  summary.activeShips = stored.ships.filter(ship => CombatantRules.isActive(ship)).length;
  summary.finalShips = stored.ships.map(summarizeShip);
  assert.ok(summary.shots > 0, "Fixture must actually exercise gunnery");
  return { summary, initial: {
    board: initial.board, wind: initial.wind, ships: initial.ships.map(ship => ({
      ...summarizeShip(ship), template: ship.template,
      batteries: ship.weapons.map(weapon => ({ arc: weapon.arc, type: weapon.type, reloadMax: weapon.reloadMax, damage: weapon.damage }))
    }))
  }, trace };
}
const results = [];
try {
  for (const scenario of ["stationary", "parallel"]) for (const seed of SEEDS) results.push(await run(scenario, seed));
} finally { Math.random = originalRandom; }
await mkdir("artifacts/tempo", { recursive: true });
await writeFile("artifacts/tempo/four-ship-audit.json", JSON.stringify({
  roundCap: ROUND_CAP, seeds: SEEDS, policy: "parallel course; highest displayed chance × damage; urgent damage control; full salvos", results
}, null, 2));
console.log("TEMPO_SUMMARY:" + JSON.stringify(results.map(result => result.summary)));
