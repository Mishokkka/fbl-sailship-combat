import { COMBATANT_TYPES } from "../utils/constants.js";
import { ShipCombatantRules } from "./ship-combatant-rules.js";
import { CreatureCombatantRules } from "./creature-combatant-rules.js";

const registry = new Map([
  [ShipCombatantRules.type, ShipCombatantRules],
  [CreatureCombatantRules.type, CreatureCombatantRules]
]);

export class CombatantRules {
  static typeOf(unit, fallback = "ship") {
    const value = String(unit?.unitType ?? fallback).trim();
    return COMBATANT_TYPES.includes(value) ? value : fallback;
  }

  static register(type, handler) {
    const key = String(type ?? "").trim();
    if (!COMBATANT_TYPES.includes(key)) throw new Error(`Неизвестный тип боевой единицы: ${key || "<пусто>"}.`);
    if (!handler || typeof handler !== "object") throw new Error(`Обработчик ${key} должен быть объектом.`);
    registry.set(key, Object.freeze({ ...handler, type: key }));
    return registry.get(key);
  }

  static forType(type) {
    return registry.get(String(type ?? "")) ?? registry.get("ship");
  }

  static for(unit) {
    return this.forType(this.typeOf(unit));
  }

  static supports(unit, capability) {
    return Boolean(this.for(unit)?.operational && this.for(unit)?.capabilities?.[capability]);
  }

  static isOperational(unit) {
    return Boolean(this.for(unit)?.operational);
  }

  static isActive(unit) {
    return Boolean(this.for(unit)?.isActive?.(unit));
  }

  static isEligibleForPhase(unit, phase) {
    if (!this.isActive(unit)) return false;
    if (phase === "orders") return this.typeOf(unit) === "ship";
    if (phase === "movement") return this.supports(unit, "movement");
    if (phase === "gunnery") return this.supports(unit, "gunnery") || this.supports(unit, "naturalAttack");
    if (phase === "crew") return this.supports(unit, "crew") || this.supports(unit, "recovery");
    return true;
  }

  static occupiesCell(unit) {
    const handler = this.for(unit);
    if (typeof handler?.occupiesCell === "function") return Boolean(handler.occupiesCell(unit));
    return Boolean(unit) && !unit.flags?.struck && !unit.flags?.withdrawn;
  }

  static getMovementBlockReason(unit, battle) {
    return this.for(unit)?.getMovementBlockReason?.(unit, battle) ?? null;
  }

  static getVictoryStrength(unit, context = {}) {
    return Number(this.for(unit)?.getVictoryStrength?.(unit, context) ?? 0);
  }

  static list() {
    return [...registry.values()];
  }
}
