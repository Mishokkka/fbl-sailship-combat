import test from "node:test";
import assert from "node:assert/strict";
import { BattleGuidanceBuilder } from "../scripts/context/battle-guidance-builder.js";

const ship = { id: "a", name: "Люмен", unitType: "ship" };
function guidance(overrides = {}) {
  return BattleGuidanceBuilder.build({
    battle: { round: 2, phase: "gunnery", setupConfirmed: true },
    selectedShip: ship, activeShip: ship, canViewDetails: true, isGM: true, hasSelectedTarget: true, ...overrides
  });
}

test("setup guidance exposes the setup action only to the GM", () => {
  const battle = { setupConfirmed: false };
  assert.equal(guidance({ battle }).action, "openBattleSetup");
  assert.equal(guidance({ battle, isGM: false }).action, undefined);
});

test("hidden contacts do not expose actionable or detailed ship guidance", () => {
  const result = guidance({ isGM: false, canViewDetails: false, canSubmitOrder: true });
  assert.equal(result.title, "Наблюдение за контактом");
  assert.equal(result.action, undefined);
});

test("players receive pending order feedback without GM phase controls", () => {
  const result = guidance({ isGM: false, canSubmitOrder: true, pendingOrder: true });
  assert.equal(result.title, "Приказ отправлен");
  assert.equal(result.action, undefined);
  assert.equal(guidance({ isGM: false, activeShip: null }).action, undefined);
});

test("phase progression is offered only after all activations", () => {
  assert.equal(guidance().action, undefined);
  assert.equal(guidance({ activeShip: null }).action, "nextPhase");
  assert.equal(guidance({ battle: { phase: "end", setupConfirmed: true } }).actionLabel, "Начать новый раунд");
});

test("mandatory movement tells the GM why completing the action is unavailable", () => {
  const result = guidance({
    battle: { phase: "movement", setupConfirmed: true },
    actionState: { movementState: { mustMove: true, requiredAdvance: 3 } }
  });
  assert.equal(result.tone, "warning");
  assert.match(result.description, /3 гекс/);
});

test("a different selected unit offers a return to the active unit", () => {
  assert.equal(guidance({ selectedShip: { id: "b" } }).action, "selectActiveShip");
});

test("gunnery guidance follows displayed usable previews, not other targets in an arc", () => {
  assert.equal(guidance({ actionState: { canFirePort: true }, hasShotPreview: false }).title, "Сейчас нет доступного выстрела");
  assert.equal(guidance({ hasShotPreview: true }).tone, "ready");
});

test("resolved battle and creature guidance do not offer ship-specific actions", () => {
  assert.equal(guidance({ battle: { setupConfirmed: true, outcome: { resolved: true } } }).action, undefined);
  const creature = { id: "a", unitType: "creature" };
  assert.equal(guidance({ selectedShip: creature }).title, "Выберите цель и атаку");
  assert.match(guidance({ selectedShip: creature, battle: { phase: "crew", setupConfirmed: true } }).title, /существа/);
});

test("gunnery starts by asking for a target before diagnosing weapon limits", () => {
  assert.equal(guidance({ hasSelectedTarget: false }).title, "Выберите цель залпа");
});
