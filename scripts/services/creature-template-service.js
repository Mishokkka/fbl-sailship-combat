import { CREATURE_TEMPLATES, createCreature } from "../data/creature-factory.js";
import { BattleScenarioService } from "./battle-scenario-service.js";

export class CreatureTemplateService {
  static hasTemplate(id) {
    return Boolean(CREATURE_TEMPLATES[id]);
  }

  static createCreatureFromTemplate(id, { battle = null, side = null } = {}) {
    if (!this.hasTemplate(id)) return null;
    const offset = Number(battle?.ships?.length ?? 0);
    const sideIds = battle ? BattleScenarioService.getSideIds(battle) : ["blue", "red"];
    const resolvedSide = sideIds.includes(side) ? side : sideIds[offset % Math.max(1, sideIds.length)] ?? "wild";
    const sideOffset = battle ? (battle.ships ?? []).filter(unit => unit.side === resolvedSide).length : offset;
    const spawn = battle ? BattleScenarioService.getSideSpawnPoint(battle, resolvedSide, sideOffset) : null;
    return createCreature({
      template: id,
      side: resolvedSide,
      x: spawn?.x ?? 0,
      y: spawn?.y ?? 0,
      heading: spawn?.heading ?? 0,
      battleRound: battle?.round ?? 1
    });
  }

  static getTemplateGroups() {
    const groups = new Map();
    for (const template of Object.values(CREATURE_TEMPLATES)) {
      const category = template.category ?? "Прочие";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push({
        id: template.id,
        category,
        label: template.label,
        description: template.description,
        creatureType: template.creatureType,
        size: template.size,
        maxSpeed: template.maxSpeed,
        vitality: template.vitality?.max ?? 0,
        armor: template.stats?.armor ?? 0,
        sections: Object.keys(template.sections ?? {}).length,
        attacks: (template.attacks ?? []).length,
        movementProfile: template.movement?.profile ?? "flier"
      });
    }
    return [...groups.entries()].map(([category, templates]) => ({ category, templates }));
  }
}
