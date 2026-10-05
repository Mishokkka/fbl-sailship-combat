function enabledSections(unit) {
  return Object.values(unit?.sections ?? {}).filter(section => section?.enabled !== false);
}

export const CreatureCombatantRules = Object.freeze({
  type: "creature",
  label: "Летающее существо",
  operational: true,
  capabilities: Object.freeze({
    movement: true,
    wind: true,
    crystal: false,
    gunnery: false,
    naturalAttack: true,
    boarding: false,
    crew: false,
    recovery: true,
    damage: true,
    victory: true,
    targetable: true
  }),

  occupiesCell(unit) {
    return Boolean(unit) && !unit.flags?.struck && !unit.flags?.withdrawn && !unit.flags?.attachedTo;
  },

  isActive(unit) {
    return Boolean(unit)
      && Number(unit?.vitality?.current ?? 0) > 0
      && !unit.flags?.struck
      && !unit.flags?.withdrawn;
  },

  getMovementBlockReason(unit) {
    if (!this.isActive(unit)) return "Существо выбыло из боя.";
    if (unit.flags?.attachedTo) return "Существо держится за корабль и перемещается вместе с ним.";
    if (unit.flags?.falling) return "Существо падает и не может выполнять обычное движение.";
    const flight = enabledSections(unit).filter(section => section.tags?.some?.(tag => ["flight", "wing", "levitation"].includes(tag)));
    if (flight.length && flight.every(section => Number(section?.hp?.value ?? 0) <= 0 || section.status === "destroyed")) {
      return "Все несущие органы уничтожены.";
    }
    return null;
  },

  getVictoryStrength(unit) {
    if (!this.isActive(unit)) return 0;
    const vitalityMax = Math.max(1, Number(unit?.vitality?.max ?? 1));
    const vitalityRatio = Math.max(0, Math.min(1, Number(unit?.vitality?.current ?? 0) / vitalityMax));
    const moraleRatio = Math.max(0, Math.min(1, Number(unit?.vitality?.morale ?? 0) / 10));
    const attacks = (unit?.attacks ?? []).filter(attack => Number(attack?.damage ?? 0) > 0).length;
    const mobility = Math.max(0, Number(unit?.maxSpeed ?? 0));
    return Math.max(1, Math.round((vitalityMax * vitalityRatio * 0.45) + (attacks * 4) + mobility + (moraleRatio * 5)));
  }
});
