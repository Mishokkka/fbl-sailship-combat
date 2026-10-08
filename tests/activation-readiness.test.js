import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createCreature } from "../scripts/data/creature-factory.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { ActivationReadinessService } from "../scripts/services/activation-readiness-service.js";
import { CreatureGrappleEngine } from "../scripts/engine/creature-grapple-engine.js";
import { GunneryEngine } from "../scripts/engine/gunnery-engine.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { VictoryEngine } from "../scripts/engine/victory-engine.js";

foundry.applications = { api: {
  ApplicationV2: class { constructor() { this.options = this.constructor.DEFAULT_OPTIONS; } },
  HandlebarsApplicationMixin: Base => Base
} };
const { NavalBattleApp } = await import("../scripts/apps/naval-battle-app.js");
test.beforeEach(() => {
  installTestEnvironment();
  game.i18n = { localize: key => key };
});


function fixture(phase = "gunnery") {
  const battle = BattleNormalizer.normalize(createDefaultBattle());
  battle.setupConfirmed = true;
  battle.phase = phase;
  battle.revision = 7;
  battle.board.terrain = {};
  battle.wind = { direction: 240, strength: "light" };
  Object.assign(battle.ships[0], { x: 12, y: 10, heading: 0, speed: 2, altitude: 4 });
  Object.assign(battle.ships[1], { x: 12, y: 6, heading: 180, speed: 2, altitude: 4 });
  for (const ship of battle.ships) {
    ship.crew.morale = 10;
    ship.crystal.heat = 0;
    ship.crystal.integrity = ship.crystal.maxIntegrity;
    MovementEngine.syncSailingState(battle, ship);
  }
  battle.turn.activeShipId = battle.ships[0].id;
  battle.turn.phaseOrder[phase] = battle.ships.map(ship => ship.id);
  battle.turn.completed[phase] = [];
  return battle;
}
function waiting(battle) {
  for (const ship of battle.ships) for (const weapon of ship.weapons ?? []) weapon.reload = 3;
  return battle;
}
const readiness = (battle, ship = battle.ships[0], budget = 1) => ActivationReadinessService.assess(battle, ship, budget);
function actions(battle, unit = battle.ships[0]) {
  battle.turn.actions[unit.id] ??= {};
  return battle.turn.actions[unit.id][battle.phase] ??= {};
}
function harness(battle = fixture()) {
  let stored = structuredClone(battle);
  const app = new NavalBattleApp();
  const state = { app, commits: 0, mode: "allow", beforeMutation: null,
    read: () => structuredClone(stored), change: fn => fn(stored) };
  app.selectedShipId = battle.ships[0]?.id ?? null;
  app.selectedTargetId = battle.ships[1]?.id ?? null;
  app.renderBattleState = async () => {};
  game.sailshipsCombat = { storage: {
    getBattleForUser: () => structuredClone(stored),
    async updateBattle(mutator) {
      await state.beforeMutation?.();
      const next = structuredClone(stored);
      if (await mutator(next) === false || state.mode === "deny") return structuredClone(stored);
      if (state.mode === "fail") throw new Error("Simulated storage failure");
      next.revision++;
      stored = next;
      state.commits++;
      return structuredClone(stored);
    }
  } };
  return state;
}

test("readiness is read-only, deterministic and independent of selected ammo or aim", t => {
  const battle = fixture();
  const battery = GunneryEngine.getBattery(battle.ships[0], "bow");
  battery.ammo = "chainShot";
  battery.fireMode = "ranging";
  const before = structuredClone(battle);
  t.mock.method(Math, "random", () => assert.fail("Readiness must never roll"));
  assert.equal(readiness(battle).kind, "ready");
  assert.deepEqual(battle, before, "Preview normalization never changes stored weapons");
});

test("all ammo and fire modes are considered before declaring a gun activation empty", t => {
  const battle = fixture();
  t.mock.method(GunneryEngine, "getTargets", (_battle, ship, arc, options) => {
    const battery = GunneryEngine.getBattery(ship, arc);
    assert.equal(options.aimedSection, null);
    return battery.ammo === "roundShot" && battery.fireMode === "partial" ? [{}] : [];
  });
  assert.equal(readiness(battle).kind, "ready");
});

test("reload and no-target reasons remain distinct; nearest functional reload is shown", () => {
  const battle = waiting(fixture());
  GunneryEngine.getBattery(battle.ships[0], "bow").reload = 2;
  assert.equal(readiness(battle).reloadRounds, 2);
  assert.match(readiness(battle).label, /Перезарядка/);
  battle.ships[1].side = battle.ships[0].side;
  GunneryEngine.getBattery(battle.ships[0], "bow").reload = 0;
  assert.match(readiness(battle).label, /Нет допустимой цели/);
  battle.ships[0].weapons = [];
  assert.match(readiness(battle).label, /Нет действующих батарей/);
});

test("orders and movement never skip, including spent AP and unresolved inertia", () => {
  for (const phase of ["orders", "movement"]) {
    const battle = fixture(phase);
    actions(battle)._apSpent = 3;
    assert.equal(readiness(battle, battle.ships[0], 0).canSkip, false);
  }
  const battle = fixture("movement");
  battle.ships[0].speed = 5;
  assert.equal(readiness(battle).kind, "required");
  battle.ships[0].speed = 0;
  assert.equal(readiness(battle).canSkip, false);
});

test("crew recognizes repairs and shared category limits", () => {
  const battle = fixture("crew");
  assert.equal(readiness(battle).canSkip, true);
  battle.ships[0].sections.bow.fire = 2;
  assert.equal(readiness(battle).kind, "ready");
  actions(battle)["crewRepair:fire"] = true;
  assert.equal(readiness(battle, battle.ships[0], 2).canSkip, true);
  battle.ships[0].sections.bow.breaches = 1;
  assert.equal(readiness(battle, battle.ships[0], 2).kind, "ready");
  actions(battle)["crewRepair:flooding"] = true;
  assert.equal(readiness(battle, battle.ships[0], 2).canSkip, true);
  battle.ships[0].sections.bow.mastWreckage = 1;
  assert.equal(readiness(battle, battle.ships[0], 2).kind, "ready");
  actions(battle)["crewRepair:system"] = true;
  assert.equal(readiness(battle, battle.ships[0], 2).canSkip, true);
});

test("boarding, release and defense of the deck stop the queue without a selected target", t => {
  const battle = fixture("crew"), [ship, enemy] = battle.ships;
  Object.assign(enemy, { x: ship.x, y: ship.y - 1 });
  assert.match(readiness(battle).label, /сцепки/);
  ship.flags.grappledWith = enemy.id;
  enemy.flags.grappledWith = ship.id;
  assert.match(readiness(battle).label, /Разрыв/);
  actions(battle)["crewBoarding:release"] = true;
  assert.match(readiness(battle).label, /Абордаж/);
  actions(battle)["crewBoarding:board"] = true;
  assert.equal(readiness(battle).canSkip, true);
  const creature = createCreature({ id: "attached", x: ship.x, y: ship.y, side: "wild", flags: { attachedTo: ship.id } });
  battle.ships.push(creature);
  assert.match(readiness(battle).label, /Защита палубы/);
  t.mock.method(CreatureGrappleEngine, "findDetachCell", () => null);
  assert.equal(readiness(battle).canSkip, true);
  assert.match(readiness(battle).reason, /нет свободной клетки/);
});

test("creature readiness accounts for cooldown, recovery and enemy-target abilities", () => {
  const battle = fixture(), ship = battle.ships[0];
  const creature = createCreature({ id: "creature", x: ship.x, y: ship.y - 1, side: "wild", heading: 180, abilities: [], vitality: { morale: 10 } });
  battle.ships.push(creature);
  assert.equal(readiness(battle, creature).kind, "ready");
  for (const attack of creature.attacks) attack.cooldown = 2;
  assert.equal(readiness(battle, creature).canSkip, true);
  creature.abilities = [{ id: "special", type: "active", effect: "none", phase: "gunnery", target: "enemy", range: 2, label: "Особый эффект" }];
  assert.equal(readiness(battle, creature).kind, "ready");
  actions(battle, creature)["creatureAbility:special"] = true;
  assert.equal(readiness(battle, creature).canSkip, true);
  battle.phase = "crew";
  assert.equal(readiness(battle, creature).canSkip, true);
  creature.vitality.morale = 8;
  assert.equal(readiness(battle, creature).kind, "ready");
  actions(battle, creature)["creatureRecover:steady"] = true;
  assert.equal(readiness(battle, creature).canSkip, true);
  creature.flags.bleeding = 1;
  assert.equal(readiness(battle, creature).kind, "ready");
});

test("one transaction skips waiting ships and stops at the next real shot", async () => {
  const battle = fixture();
  for (const weapon of battle.ships[0].weapons) weapon.reload = 2;
  const state = harness(battle);
  assert.equal(await state.app.phase.advanceToDecision(), true);
  assert.equal(state.commits, 1);
  assert.equal(state.read().turn.activeShipId, battle.ships[1].id);
  assert.equal(state.read().phase, "gunnery");
  assert.equal(state.app.selectedShipId, battle.ships[1].id);
  assert.match(state.app.phase.advanceNotice.text, /активаций: 1/);
  assert.ok(state.read().log.some(entry => /Перезарядка/.test(entry.text)));
});

test("empty gun and crew phases settle once and stop at the new round", async t => {
  t.mock.method(Math, "random", () => 0.5);
  const state = harness(waiting(fixture()));
  assert.equal(await state.app.phase.advanceToDecision(), true);
  const after = state.read();
  assert.equal(state.commits, 1);
  assert.equal(after.phase, "orders");
  assert.equal(after.round, 2);
  assert.equal(after.lastReport.kind, "round");
  assert.equal(after.ships[0].weapons[0].reload, 2);
  assert.match(state.app.phase.advanceNotice.text, /активаций: 4; переходов фазы: 2/);
});

test("fast navigation preserves manual end-round results with four ships", async t => {
  t.mock.method(Math, "random", () => 0.5);
  const battle = waiting(fixture());
  const extras = structuredClone(battle.ships).map((ship, i) => ({ ...ship, id: ship.id + "-2", name: ship.name + " II", x: 20, y: 5 + i * 5 }));
  battle.ships.push(...extras);
  battle.turn.phaseOrder.gunnery = battle.ships.map(ship => ship.id);
  const fast = harness(battle);
  await fast.app.phase.advanceToDecision();
  const fastResult = fast.read();
  const manual = harness(battle);
  for (const phase of ["gunnery", "crew"]) {
    for (let i = 0; i < battle.ships.length; i++) await manual.app.phase.passTurn();
    assert.equal(manual.read().turn.activeShipId, null);
    await manual.app.phase.nextPhase();
  }
  const manualResult = manual.read();
  assert.equal(fast.commits, 1);
  assert.equal(manual.commits, 10);
  assert.deepEqual(fastResult.ships, manualResult.ships);
  assert.deepEqual(fastResult.turn, manualResult.turn);
  assert.deepEqual(fastResult.lastReport.groups, manualResult.lastReport.groups);
  assert.equal(fastResult.round, manualResult.round);
  console.log("Four-ship waiting window: 10 navigation clicks -> 1; identical ships, turn and round report changes.");
});

test("next-phase traversal stops on crew work and never chooses it", async () => {
  const battle = waiting(fixture());
  battle.ships[0].sections.bow.fire = 1;
  const state = harness(battle);
  await state.app.phase.advanceToDecision();
  assert.equal(state.read().phase, "crew");
  assert.equal(state.read().turn.activeShipId, battle.ships[0].id);
  assert.equal(state.read().ships[0].sections.bow.fire, 1);
  assert.equal(state.read().round, 1);
});

test("ready decisions, permissions, projections and a pending movement plan prevent writes", async () => {
  for (const mode of ["ready", "orders", "movement", "player", "projection", "plan", "planBusy"]) {
    game.user.isGM = true;
    const state = harness(mode === "ready" ? fixture() : waiting(fixture(["orders", "movement"].includes(mode) ? mode : "gunnery")));
    if (mode === "player") game.user.isGM = false;
    if (mode === "projection") state.change(b => { b.projection = { kind: "player" }; });
    if (mode === "plan") state.app.movementPlan.pending = { shipId: state.app.selectedShipId };
    if (mode === "planBusy") state.app.movementPlan.busy = true;
    const selected = state.app.selectedShipId;
    await state.app.phase.advanceToDecision();
    assert.equal(state.commits, 0, mode);
    assert.equal(state.app.selectedShipId, selected);
  }
});

test("stale buttons, changed active unit and denied/failed persistence do not change local selection", async t => {
  t.mock.method(console, "error", () => {});
  for (const mode of ["revision", "active", "phase", "round", "deny", "fail", "button"]) {
    const state = harness(waiting(fixture()));
    const shown = state.read(), selected = state.app.selectedShipId;
    const button = { dataset: { battleId: shown.id, revision: String(shown.revision), phase: shown.phase, round: String(shown.round), activeId: shown.turn.activeShipId } };
    if (mode === "button") button.dataset.revision = "1";
    if (["deny", "fail"].includes(mode)) state.mode = mode;
    else if (mode !== "button") state.beforeMutation = () => state.change(b => {
      if (mode === "revision") b.revision++;
      if (mode === "active") b.turn.activeShipId = b.ships[1].id;
      if (mode === "phase") b.phase = "crew";
      if (mode === "round") b.round++;
    });
    await state.app.phase.advanceToDecision(button);
    assert.equal(state.commits, 0, mode);
    assert.equal(state.app.selectedShipId, selected);
    assert.equal(state.app.phase.advanceNotice, undefined);
    assert.equal(state.app.phase.busy, false);
  }
});

test("double click commits once; inspection changed during save remains selected", async () => {
  const state = harness(waiting(fixture()));
  state.beforeMutation = () => { state.app.selectedShipId = state.read().ships[1].id; };
  const inspected = state.read().ships[1].id;
  await Promise.all([state.app.phase.advanceToDecision(), state.app.phase.advanceToDecision()]);
  assert.equal(state.commits, 1);
  assert.equal(state.app.selectedShipId, inspected);
});

test("victory stops settlement and repeat commands cannot tick reload twice", async t => {
  t.mock.method(VictoryEngine, "evaluate", () => ({ resolved: true, title: "Победа", summary: "Итог" }));
  const state = harness(waiting(fixture()));
  await state.app.phase.advanceToDecision();
  assert.equal(state.read().phase, "end");
  assert.equal(state.read().round, 1);
  assert.equal(state.read().outcome.resolved, true);
  await state.app.phase.advanceToDecision();
  assert.equal(state.commits, 1);
  assert.equal(state.read().ships[0].weapons[0].reload, 2);
});

test("creature-only empty order phases stop at movement and after one settlement", async t => {
  t.mock.method(VictoryEngine, "evaluate", () => ({ resolved: false }));
  const battle = fixture("orders");
  battle.ships = ["blue", "red"].map((side, i) => createCreature({ id: side, side, x: 5 + i * 15, y: 5, vitality: { morale: 10 }, abilities: [] }));
  battle.turn.activeShipId = null;
  const state = harness(battle);
  await state.app.phase.advanceToDecision();
  assert.equal(state.read().phase, "movement");
  assert.equal(state.read().round, 1);
  state.change(b => { b.phase = "crew"; b.turn.activeShipId = b.ships[0].id; b.turn.phaseOrder.crew = b.ships.map(s => s.id); });
  state.app.renderBattleSnapshot = null;
  await state.app.phase.advanceToDecision();
  assert.equal(state.read().phase, "orders");
  assert.equal(state.read().round, 2);
  assert.equal(state.read().turn.activeShipId, null);
});

test("queue reveals readiness only to GM and caches assessments per battle revision", t => {
  const state = harness(waiting(fixture()));
  const battle = state.read(), builder = state.app.contextBuilder;
  builder.setScope(battle);
  let calls = 0;
  const assess = state.app.phase.getReadiness.bind(state.app.phase);
  t.mock.method(state.app.phase, "getReadiness", (...args) => { calls++; return assess(...args); });
  const context = { activeShip: battle.ships[0] };
  const first = builder.getTurnFields(battle, context);
  builder.getTurnFields(battle, context);
  assert.equal(calls, 2);
  assert.equal(first.pacing.available, true);
  game.user.isGM = false;
  const player = builder.getTurnFields(battle, context);
  assert.equal(player.pacing.available, false);
  assert.ok(player.turnOrder.every(unit => unit.readiness.label === "Решение ведущего"));
  assert.equal(calls, 2, "Player context never assesses private weapon state");
  battle.projection = { kind: "player" };
  assert.equal(readiness(battle).canSkip, false);
});

test("spent crew AP still settles fire, descent and cooldowns exactly as manual navigation", async t => {
  t.mock.method(Math, "random", () => 0.5);
  const battle = waiting(fixture("crew"));
  battle.ships[0].sections.bow.fire = 2;
  battle.ships[0].verticalVelocity = -1;
  for (const ship of battle.ships) actions(battle, ship)._apSpent = 2;
  const fast = harness(battle);
  await fast.app.phase.advanceToDecision();
  const after = fast.read();
  const manual = harness(battle);
  for (let i = 0; i < battle.ships.length; i++) await manual.app.phase.passTurn();
  await manual.app.phase.nextPhase();
  assert.deepEqual(after.ships, manual.read().ships);
  assert.deepEqual(after.lastReport.groups, manual.read().lastReport.groups);
  assert.ok(after.lastReport.groups.length > 0);
  assert.ok(after.ships[0].sections.bow.hp.value < battle.ships[0].sections.bow.hp.value);
});

test("legacy checkpoints and an empty battle are bounded by one round", async t => {
  t.mock.method(VictoryEngine, "evaluate", () => ({ resolved: false }));
  for (const phase of ["damage", "end", "orders"]) {
    const battle = waiting(fixture(phase));
    battle.ships = [];
    battle.turn.activeShipId = null;
    const state = harness(battle);
    await state.app.phase.advanceToDecision();
    assert.equal(state.read().round, 2, phase);
    assert.equal(state.read().phase, "orders", phase);
    assert.equal(state.commits, 1, phase);
  }
});
