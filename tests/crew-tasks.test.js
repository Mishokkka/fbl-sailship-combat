import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "../scripts/services/document-state-store.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { BattleProjectionService } from "../scripts/services/battle-projection-service.js";
import { CrewTaskService } from "../scripts/services/crew-task-service.js";
import { CrewContextBuilder } from "../scripts/context/crew-context-builder.js";
import { DamageEngine } from "../scripts/engine/damage-engine.js";

foundry.applications = { api: {
  ApplicationV2: class { constructor() { this.options = this.constructor.DEFAULT_OPTIONS; } },
  HandlebarsApplicationMixin: Base => Base
} };
const { NavalBattleApp } = await import("../scripts/apps/naval-battle-app.js");
test.beforeEach(() => {
  installTestEnvironment();
  game.i18n = { localize: key => key };
});

function fixture() {
  const battle = BattleNormalizer.normalize(createDefaultBattle());
  battle.phase = "crew";
  battle.setupConfirmed = true;
  battle.revision = 7;
  battle.board.terrain = {};
  battle.wind = { direction: 240, strength: "light" };
  battle.turn.activeShipId = battle.ships[0].id;
  battle.turn.phaseOrder.crew = battle.ships.map(unit => unit.id);
  battle.ships[0].selectedOrder = "damageControl";
  battle.ships[0].sections.bow.fire = 1;
  battle.ships[0].sections.stern.fire = 4;
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

function taskFor(state, mode, sectionId = null) {
  const battle = state.read();
  const task = CrewTaskService.tasks(battle, battle.ships[0]).find(task => task.mode === mode && task.sectionId === sectionId);
  assert.ok(task, mode + " task exists");
  return task;
}
function perform(state, task) {
  const battle = state.read();
  return state.app.crew.performTask(task.id, { dataset: { shipId: battle.ships[0].id, revision: String(battle.revision) } });
}

test("task forecasts are read-only, consume no randomness and disclose severe-fire risk", t => {
  const battle = fixture();
  const before = structuredClone(battle);
  t.mock.method(Math, "random", () => assert.fail("Forecast must not roll"));
  const tasks = CrewTaskService.tasks(battle, battle.ships[0]);
  const fire = tasks.find(task => task.mode === "fire" && task.sectionId === "stern");
  assert.equal(fire.after, 2);
  assert.match(fire.risk, /80%/);
  assert.deepEqual(battle, before);
});

test("crew extinguishes the chosen section, reports losses and retains remaining AP", async t => {
  t.mock.method(Math, "random", () => 0);
  const state = harness();
  const initial = state.read();
  await perform(state, taskFor(state, "fire", "stern"));
  const saved = state.read();
  assert.equal(saved.ships[0].sections.stern.fire, 2);
  assert.equal(saved.ships[0].sections.bow.fire, 1);
  assert.equal(saved.ships[0].crew.current, initial.ships[0].crew.current - 1);
  assert.equal(saved.turn.actions[saved.ships[0].id].crew._apSpent, 1);
  assert.equal(state.app.selectedShipId, saved.ships[0].id);
  assert.equal(saved.lastReport.kind, "crew");
  assert.ok(saved.lastReport.groups[0].changes.some(row => /пожар/.test(row.label) && row.after === "2"));
  assert.ok(saved.lastReport.groups[0].changes.some(row => row.label === "Экипаж"));
});

test("one work category per phase remains enforced across sections", async () => {
  const state = harness();
  await perform(state, taskFor(state, "fire", "stern"));
  await perform(state, taskFor(state, "fire", "bow"));
  assert.equal(state.commits, 1);
  const battle = state.read();
  const controls = CrewContextBuilder.build(battle, battle.ships[0], state.app._getActionState(battle, battle.ships[0]), state.app);
  assert.ok(controls.tasks.filter(task => task.mode === "fire").every(task => !task.canUse && /уже выполнен/.test(task.blockedReason)));
});

test("pumping and sealing target different problems but share the action limit", async () => {
  const state = harness();
  state.change(battle => {
    battle.ships[0].sections.stern.flooding = 3;
    battle.ships[0].sections.bow.breaches = 2;
  });
  await perform(state, taskFor(state, "breaches", "bow"));
  assert.equal(state.read().ships[0].sections.bow.breaches, 0);
  assert.equal(state.read().ships[0].sections.stern.flooding, 3);
  await perform(state, taskFor(state, "flooding", "stern"));
  assert.equal(state.commits, 1);
});

test("explicit system repair avoids another system and local wreckage; partial HP is reported", async () => {
  const state = harness();
  state.change(battle => {
    const ship = battle.ships[0];
    ship.selectedOrder = "battleSail";
    ship.sections.bow.systems[0].status = "damaged";
    ship.sections.bow.systems[0].hp = { value: 1, max: 10 };
    ship.sections.stern.systems[1].status = "damaged";
    ship.sections.stern.systems[1].hp = { value: 1, max: 10 };
    ship.sections.stern.mastWreckage = 1;
  });
  const task = CrewTaskService.tasks(state.read(), state.read().ships[0]).find(task => task.mode === "system" && task.sectionId === "stern" && task.systemIndex === 1);
  assert.equal(task.after, 3);
  assert.match(task.effect, /останется повреждённой/);
  await perform(state, task);
  const saved = state.read();
  assert.equal(saved.ships[0].sections.stern.systems[1].hp.value, 3);
  assert.equal(saved.ships[0].sections.stern.systems[1].status, "damaged");
  assert.equal(saved.ships[0].sections.bow.systems[0].hp.value, 1);
  assert.equal(saved.ships[0].sections.stern.mastWreckage, 1);
  assert.equal(state.app.selectedShipId, saved.turn.activeShipId);
  assert.notEqual(state.app.selectedShipId, saved.ships[0].id);
  assert.ok(saved.lastReport.groups[0].changes.some(row => row.label.endsWith(" · HP") && row.before === "1" && row.after === "3"));
});

test("removing the final wreckage immediately restores mobility", async () => {
  const state = harness();
  state.change(battle => {
    battle.ships[0].sections.stern.mastWreckage = 1;
    battle.ships[0].flags.immobilized = true;
  });
  await perform(state, taskFor(state, "wreckage", "stern"));
  const ship = state.read().ships[0];
  assert.equal(ship.sections.stern.mastWreckage, 0);
  assert.equal(Boolean(ship.flags.immobilized), false);
  assert.ok(state.read().lastReport.groups[0].changes.some(row => row.label === "Обездвижен" && row.after === "нет"));
});

test("destroyed systems, vanished targets, stale revisions and changed selection never spend AP", async () => {
  for (const mode of ["destroyed", "vanished", "revision", "selection", "phase", "player"]) {
    const state = harness();
    const task = taskFor(state, "fire", "stern");
    if (mode === "destroyed") {
      state.change(battle => { battle.ships[0].sections.stern.systems[0].status = "destroyed"; });
      const destroyed = CrewTaskService.tasks(state.read(), state.read().ships[0]).find(task => task.mode === "system" && task.sectionId === "stern" && task.systemIndex === 0);
      await perform(state, destroyed);
    } else {
      state.beforeMutation = () => {
        if (mode === "vanished") state.change(battle => { battle.ships[0].sections.stern.fire = 0; });
        if (mode === "revision") state.change(battle => { battle.revision++; });
        if (mode === "selection") state.app.selectedShipId = state.read().ships[1].id;
        if (mode === "phase") state.change(battle => { battle.phase = "gunnery"; });
      };
      if (mode === "player") game.user.isGM = false;
      await perform(state, task);
      game.user.isGM = true;
    }
    assert.equal(state.commits, 0, mode);
    assert.equal(state.read().lastReport, undefined);
    assert.equal(state.read().turn.actions[state.read().ships[0].id]?.crew?._apSpent, undefined);
  }
});

test("double clicks spend one action; failed and denied writes preserve selection and state", async () => {
  const state = harness();
  const task = taskFor(state, "fire", "stern");
  await Promise.all([perform(state, task), perform(state, task)]);
  assert.equal(state.commits, 1);
  for (const mode of ["deny", "fail"]) {
    const state = harness();
    state.change(battle => { battle.ships[0].selectedOrder = "battleSail"; });
    const before = state.read();
    state.mode = mode;
    await perform(state, taskFor(state, "fire", "stern"));
    assert.deepEqual(state.read(), before);
    assert.equal(state.app.selectedShipId, before.ships[0].id);
    assert.equal(state.app.crew.busy, false);
  }
});

test("core forecast matches cooling, repair and fall recovery; sea mode hides the task", async () => {
  const state = harness();
  state.change(battle => {
    const ship = battle.ships[0];
    ship.crystal.heat = 6;
    ship.crystal.integrity = 0;
    ship.flags.falling = true;
  });
  const task = taskFor(state, "crystal");
  assert.equal(task.after, 2);
  await perform(state, task);
  const ship = state.read().ships[0];
  assert.equal(ship.crystal.heat, task.after);
  assert.equal(ship.crystal.integrity, 2);
  assert.equal(Boolean(ship.flags.falling), false);
  const sea = state.read();
  sea.setup.mode = "sea";
  assert.equal(CrewTaskService.tasks(sea, sea.ships[0]).some(task => task.mode === "crystal"), false);
});

test("nearby boarding remains useful even before a target is selected", () => {
  const state = harness();
  const battle = state.read();
  battle.ships[0].sections.bow.fire = battle.ships[0].sections.stern.fire = 0;
  Object.assign(battle.ships[0], { x: 10, y: 10, altitude: 4 });
  Object.assign(battle.ships[1], { x: 10, y: 9, altitude: 4 });
  state.app.selectedTargetId = null;
  const context = CrewContextBuilder.build(battle, battle.ships[0], state.app._getActionState(battle, battle.ships[0]), state.app);
  assert.equal(context.noUsefulAction, false);
  assert.equal(context.boardingTargets.length, 1);
});

test("crew reports normalize and redact enemy changes in player projections", async () => {
  const state = harness();
  await perform(state, taskFor(state, "fire", "stern"));
  const battle = BattleNormalizer.normalize(state.read());
  battle.playerAssignments = { "player-a": { shipIds: [battle.ships[0].id] } };
  const projected = BattleProjectionService.project(battle, game.users.get("player-a"));
  assert.equal(projected.lastReport.kind, "crew");
  assert.match(projected.lastReport.title, /Работа экипажа/);
  assert.deepEqual(projected.lastReport.details, []);
  assert.ok(projected.lastReport.groups.every(group => group.unitId === battle.ships[0].id));
});

test("legacy untargeted repair still chooses the first burning section", () => {
  const battle = fixture();
  DamageEngine.repair(battle.ships[0], "fire");
  assert.equal(battle.ships[0].sections.bow.fire, 0);
  assert.equal(battle.ships[0].sections.stern.fire, 4);
});
