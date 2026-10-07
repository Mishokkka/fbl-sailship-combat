import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { BattleReportService } from "../scripts/services/battle-report-service.js";
import { BattleProjectionService } from "../scripts/services/battle-projection-service.js";
import { CombatPanelContextBuilder } from "../scripts/context/combat-panel-context-builder.js";
import { GunneryEngine } from "../scripts/engine/gunnery-engine.js";
import { DamageEngine } from "../scripts/engine/damage-engine.js";
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
  for (const unit of battle.ships) MovementEngine.syncSailingState(battle, unit);
  battle.turn.activeShipId = phase === "crew" || phase === "end" || phase === "damage" ? null : battle.ships[0].id;
  battle.turn.phaseOrder[phase] = battle.ships.map(ship => ship.id);
  if (phase === "crew") battle.turn.completed.crew = battle.ships.map(ship => ship.id);
  return battle;
}
function harness(battle = fixture()) {
  let stored = structuredClone(battle);
  const app = new NavalBattleApp();
  const state = { app, commits: 0, mode: "allow", beforeMutation: null,
    read: () => structuredClone(stored), change: fn => fn(stored) };
  app.selectedShipId = battle.ships[0].id;
  app.selectedTargetId = battle.ships[1].id;
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
function fire(state) {
  const battle = state.read();
  const battery = GunneryEngine.getBattery(battle.ships[0], "bow");
  return state.app.gunnery.fireArc("bow", { dataset: { weaponId: battery.id, targetId: battle.ships[1].id } });
}

test("salvo cards keep unavailable batteries and require an explicit target", () => {
  const state = harness();
  const battle = state.read();
  const panels = new CombatPanelContextBuilder(state.app);
  const noTarget = panels.getShotPreviews(battle, battle.ships[0], null);
  assert.ok(noTarget.length >= 4);
  assert.ok(noTarget.every(card => !card.canFireNow && card.blockedReason));
  const battery = GunneryEngine.getBattery(battle.ships[0], "bow");
  battery.reload = 2;
  const blocked = panels.getShotPreviews(battle, battle.ships[0], battle.ships[1]).find(card => card.arc === "bow");
  assert.match(blocked.blockedReason, /Перезарядка/);
  battery.reload = 0;
  const available = panels.getShotPreviews(battle, battle.ships[0], battle.ships[1]).find(card => card.arc === "bow");
  assert.equal(available.canFireNow, true);
  assert.equal(available.targetId, battle.ships[1].id);
});

test("a real hit applies damage once and records final values before selecting the next ship", async t => {
  t.mock.method(Math, "random", () => 0.15);
  const apply = DamageEngine.applyAttackResult;
  let applied = 0;
  t.mock.method(DamageEngine, "applyAttackResult", function (...args) { applied++; return apply.apply(this, args); });
  const state = harness();
  const before = state.read();
  await fire(state);
  const saved = state.read();
  assert.equal(state.commits, 1);
  assert.equal(applied, 1);
  assert.equal(saved.lastReport.outcome, "hit");
  const target = saved.lastReport.groups.find(group => group.unitId === before.ships[1].id);
  assert.ok(target?.changes.length, "Actual target changes are recorded");
  const afterValues = BattleReportService.capture(saved).find(unit => unit.id === target.unitId).values;
  assert.ok(target.changes.every(row => Object.values(afterValues).some(value => value.label === row.label && value.value === row.after)));
  assert.ok(saved.lastReport.details.some(line => /Бросок/.test(line)));
  assert.equal(state.app.selectedShipId, saved.turn.activeShipId);
  assert.notEqual(state.app.selectedShipId, before.ships[0].id);
  assert.equal(saved.turn.actions[before.ships[0].id].gunnery._apSpent, 1);
  assert.deepEqual(BattleNormalizer.normalize(structuredClone(saved)).lastReport, saved.lastReport);
});

test("miss and preparation report distinct outcomes without target damage", async t => {
  for (const mode of ["full", "delayed"]) {
    const battle = fixture();
    GunneryEngine.getBattery(battle.ships[0], "bow").fireMode = mode;
    const state = harness(battle);
    const before = state.read().ships[1];
    t.mock.method(Math, "random", () => 0.999);
    await fire(state);
    const saved = state.read();
    assert.equal(saved.lastReport.outcome, mode === "delayed" ? "prepared" : "miss");
    assert.deepEqual(saved.ships[1], before);
    const weapon = GunneryEngine.getBattery(saved.ships[0], "bow");
    if (mode === "delayed") {
      assert.equal(weapon.reload, 0);
      assert.equal(weapon.delayed, true);
      assert.equal(saved.lastAudioEvent, undefined);
    } else assert.ok(weapon.reload > 0);
  }
});

test("queued shots reject changed revision, selection, aim, target, phase and battery", async t => {
  t.mock.method(GunneryEngine, "fire", () => assert.fail("A stale shot must never roll"));
  for (const change of [
    state => state.change(battle => battle.revision++),
    state => { state.app.selectedShipId = state.read().ships[1].id; },
    state => { state.app.selectedTargetId = null; },
    state => { state.app.aimSection = "stern"; },
    state => state.change(battle => { battle.phase = "crew"; }),
    state => state.change(battle => { GunneryEngine.getBattery(battle.ships[0], "bow").reload = 2; }),
    state => state.change(battle => { battle.outcome = { resolved: true }; })
  ]) {
    const state = harness();
    state.beforeMutation = () => change(state);
    await fire(state);
    assert.equal(state.commits, 0);
    assert.equal(state.read().lastReport, undefined);
  }
});

test("double click fires once; denied or failed writes preserve selection and battle", async t => {
  t.mock.method(Math, "random", () => 0.15);
  const state = harness();
  await Promise.all([fire(state), fire(state)]);
  assert.equal(state.commits, 1);
  for (const mode of ["deny", "fail"]) {
    const state = harness();
    state.mode = mode;
    const before = state.read();
    const selected = state.app.selectedShipId;
    await fire(state);
    assert.equal(state.commits, 0);
    assert.deepEqual(state.read(), before);
    assert.equal(state.app.selectedShipId, selected);
    assert.equal(state.app.gunnery.busy, false);
  }
});

test("four decision phases preserve legacy damage and end checkpoints", async () => {
  const state = harness();
  assert.deepEqual(["orders", "movement", "gunnery", "crew", "damage", "end"].map(id => state.app.phase.nextPhaseId(id)),
    ["movement", "gunnery", "crew", "orders", "crew", "orders"]);
  const old = harness(fixture("damage"));
  await old.app.phase.nextPhase();
  assert.equal(old.read().phase, "crew");
  assert.equal(old.read().round, 1);
  assert.equal(old.read().lastReport, undefined);
  const legacyEnd = harness(fixture("end"));
  await legacyEnd.app.phase.nextPhase();
  assert.equal(legacyEnd.read().phase, "orders");
  assert.equal(legacyEnd.read().round, 2);
});

test("crew completion settles effects once in the established order and reports the old round", async t => {
  const events = [];
  t.mock.method(MovementEngine, "advanceEndOfRoundMovement", battle => { events.push("movement"); battle.ships[0].altitude--; return ["Снижение на 1"]; });
  t.mock.method(DamageEngine, "checkStruck", () => { events.push("strike"); });
  t.mock.method(DamageEngine, "advanceOngoingDamage", battle => { events.push("damage"); battle.ships[0].sections.bow.hp.value--; return ["Пожар в носу"]; });
  t.mock.method(VictoryEngine, "processWithdrawals", () => { events.push("withdrawals"); return []; });
  t.mock.method(VictoryEngine, "evaluate", () => { events.push("victory"); return { resolved: false }; });
  const battle = fixture("crew");
  GunneryEngine.getBattery(battle.ships[0], "bow").reload = 3;
  battle.log = Array.from({ length: 200 }, (_, n) => ({ id: "old-" + n, text: "old" }));
  const state = harness(battle);
  await Promise.all([state.app.phase.nextPhase(), state.app.phase.nextPhase()]);
  const saved = state.read();
  assert.equal(state.commits, 1);
  assert.equal(saved.phase, "orders");
  assert.equal(saved.round, battle.round + 1);
  assert.equal(GunneryEngine.getBattery(saved.ships[0], "bow").reload, 2);
  assert.deepEqual(events, ["movement", ...battle.ships.map(() => "strike"), "damage", "withdrawals", "victory"]);
  assert.equal(saved.lastReport.kind, "round");
  assert.equal(saved.lastReport.round, battle.round);
  assert.ok(saved.lastReport.details.includes("Пожар в носу"), "Capped logs do not lose the report");
  assert.equal(state.app.selectedShipId, saved.turn.activeShipId);
});

test("round settlement rejects pending activations, stale state and failed persistence", async () => {
  for (const mode of ["active", "stale", "deny", "fail"]) {
    const state = harness(fixture("crew"));
    if (mode === "active") state.change(battle => { battle.turn.activeShipId = battle.ships[0].id; });
    if (mode === "stale") state.beforeMutation = () => state.change(battle => battle.revision++);
    if (["deny", "fail"].includes(mode)) state.mode = mode;
    const selected = state.app.selectedShipId;
    await state.app.phase.nextPhase();
    assert.equal(state.commits, 0, mode);
    assert.equal(state.read().round, 1);
    assert.equal(state.read().lastReport, undefined);
    assert.equal(state.app.selectedShipId, selected);
    assert.equal(state.app.phase.busy, false);
  }
});

test("victory during settlement leaves end checkpoint; continuing never ticks twice", async t => {
  let ticks = 0;
  t.mock.method(DamageEngine, "advanceOngoingDamage", () => { ticks++; return []; });
  t.mock.method(VictoryEngine, "evaluate", () => ({ resolved: true, title: "Победа", summary: "Итог" }));
  const state = harness(fixture("crew"));
  await state.app.phase.nextPhase();
  assert.equal(state.read().phase, "end");
  assert.equal(state.read().round, 1);
  assert.equal(state.read().lastReport.kind, "round");
  await state.app.phase.continueBattle();
  assert.equal(ticks, 1);
  assert.equal(state.read().phase, "orders");
  assert.equal(state.read().round, 2);
});

test("player reports expose only owned deltas and projected contact names", () => {
  const battle = fixture();
  const own = battle.ships[0];
  const enemy = battle.ships[1];
  const before = BattleReportService.capture(battle);
  own.crew.current--;
  enemy.crew.current -= 12;
  enemy.name = "Secret flagship";
  BattleReportService.record(battle, before, {
    outcome: "hit", sourceId: own.id, targetId: enemy.id, title: own.name + " → Secret flagship",
    details: ["Secret flagship: crew 321, hidden critical"]
  });
  battle.playerAssignments = { "player-a": { shipIds: [own.id] } };
  battle.playerVisibility.contacts["player-a"] = { [enemy.id]: { shipId: enemy.id, state: "detected", x: enemy.x, y: enemy.y } };
  const projected = BattleProjectionService.project(battle, game.users.get("player-a"));
  assert.ok(projected.lastReport);
  assert.equal(projected.lastReport.groups.length, 1);
  assert.equal(projected.lastReport.groups[0].unitId, own.id);
  assert.deepEqual(projected.lastReport.details, []);
  assert.equal(JSON.stringify(projected.lastReport).includes("Secret flagship"), false);
  assert.equal(BattleReportService.project(battle.lastReport, new Set(), []), null);
});

test("imported report metadata is bounded and unrelated battles cannot inject a report", () => {
  const battle = fixture();
  assert.equal(BattleReportService.normalize({ id: "bad", battleId: "other", kind: "round" }, battle), null);
  const report = BattleReportService.normalize({ id: "valid", battleId: battle.id, kind: "round",
    title: "x".repeat(1000), details: Array(100).fill("x".repeat(3000)), outcome: "<script>" }, battle);
  assert.equal(report.title.length, 256);
  assert.equal(report.details.length, 80);
  assert.equal(report.details[0].length, 2000);
  assert.equal(report.outcome, "resolved");
});
