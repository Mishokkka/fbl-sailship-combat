export const ShipCombatantRules = Object.freeze({
  type: "ship",
  label: "Корабль",
  operational: true,
  capabilities: Object.freeze({
    movement: true,
    wind: true,
    crystal: true,
    gunnery: true,
    boarding: true,
    crew: true,
    damage: true,
    victory: true,
    targetable: true
  }),

  occupiesCell(unit) {
    return Boolean(unit) && !unit.flags?.struck && !unit.flags?.withdrawn;
  },

  isActive(unit) {
    return Boolean(unit) && !unit.flags?.struck && !unit.flags?.withdrawn;
  },

  getMovementBlockReason(unit, battle) {
    const usesAltitude = String(battle?.setup?.mode ?? "mixed") !== "sea";
    if (!unit) return "Боевая единица не выбрана.";
    if (unit.flags?.grappledWith && !unit.flags?.towingId) return "Корабль сцеплен и не может двигаться.";
    if (unit.flags?.struck) return "Корабль выбыл из боя.";
    if (unit.flags?.withdrawn) return "Корабль уже вышел из зоны боя.";
    if (usesAltitude && unit.flags?.falling) return "Корабль падает.";
    if (unit.flags?.immobilized) return "Корабль обездвижен.";
    return null;
  },

  getVictoryStrength(unit, context = {}) {
    if (!this.isActive(unit)) return 0;
    const clamp = context.clamp ?? ((value, min, max) => Math.max(min, Math.min(max, Number(value) || 0)));
    const totalHp = context.totalHp?.(unit) ?? { value: 0, max: 0 };
    const hpRatio = totalHp.max > 0 ? clamp(totalHp.value / totalHp.max, 0, 1, 0) : 0;
    const requiredCrew = Number(unit.crew?.required ?? 0);
    const crewRatio = requiredCrew > 0 ? clamp(Number(unit.crew?.current ?? 0) / requiredCrew, 0, 1, 0) : 1;
    const moraleRatio = clamp(Number(unit.crew?.morale ?? 10) / 10, 0, 1, 1);
    const mobilityRatio = unit.flags?.immobilized ? 0 : 1;
    const crisisPenalty = Math.min(15, Number(context.totalFire?.(unit) ?? 0) * 1.5 + Number(context.totalFlooding?.(unit) ?? 0));
    return Math.max(0, hpRatio * 55 + crewRatio * 20 + moraleRatio * 15 + mobilityRatio * 10 - crisisPenalty);
  }
});
