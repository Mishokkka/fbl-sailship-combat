import { CombatantRules } from "../rules/combatant-rules.js";

/**
 * The persisted collection is intentionally still named battle.ships for schema
 * compatibility. All new runtime code should access it through these helpers.
 */
export function getCombatants(battle) {
  return Array.isArray(battle?.ships) ? battle.ships : [];
}

export function getCombatant(battle, id) {
  const key = String(id ?? "");
  return getCombatants(battle).find(unit => String(unit?.id ?? "") === key) ?? null;
}

export function getOperationalCombatants(battle) {
  return getCombatants(battle).filter(unit => CombatantRules.isOperational(unit));
}

export function getActiveCombatants(battle) {
  return getCombatants(battle).filter(unit => CombatantRules.isActive(unit));
}

export function getCombatantsForSide(battle, sideId, { activeOnly = false } = {}) {
  const source = activeOnly ? getActiveCombatants(battle) : getCombatants(battle);
  return source.filter(unit => String(unit?.side ?? "") === String(sideId ?? ""));
}
