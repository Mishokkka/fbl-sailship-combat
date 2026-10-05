import { createShip, getTemplateArmamentSummary } from "../data/ship-factory.js";
import { SHIP_TEMPLATES } from "../data/ship-templates.js";
import { BattleScenarioService } from "./battle-scenario-service.js";

export class ShipTemplateService {
  static hasTemplate(templateKey) {
    return Boolean(SHIP_TEMPLATES[templateKey]);
  }

  static getTemplate(templateKey) {
    return SHIP_TEMPLATES[templateKey] ?? null;
  }

  static getTemplateSummary(templateKey) {
    const t = SHIP_TEMPLATES[templateKey] ?? {};
    const hp = Number(t.bowHp ?? 0) + Number(t.midHp ?? 0) + Number(t.sternHp ?? 0);
    return {
      id: templateKey,
      label: t.label ?? templateKey,
      category: t.category ?? "Прочие",
      description: t.description ?? "Базовый корабельный шаблон.",
      maxSpeed: t.maxSpeed ?? 0,
      crew: t.crew ?? 0,
      hp,
      dr: t.midDr ?? 0,
      broadsideDamage: t.broadsideDamage ?? 0,
      chaserDamage: t.chaserDamage ?? 0,
      armament: getTemplateArmamentSummary(templateKey),
      handling: t.handling ?? 0,
      stability: t.stability ?? 0,
      crystalIntegrity: t.crystalIntegrity ?? 0,
      crystalArmor: t.crystalArmor ?? 0
    };
  }

  static getTemplateGroups() {
    const groups = new Map();
    for (const key of Object.keys(SHIP_TEMPLATES)) {
      const summary = this.getTemplateSummary(key);
      if (!groups.has(summary.category)) groups.set(summary.category, []);
      groups.get(summary.category).push(summary);
    }
    return [...groups.entries()].map(([category, templates]) => ({ category, templates }));
  }

  static createShipFromTemplate(templateKey, { battle, count = null, side = null, x = null, y = null, heading = null } = {}) {
    if (!this.hasTemplate(templateKey)) return null;
    const shipCount = count ?? Number(battle?.ships?.length ?? 0) + 1;
    const sideIds = battle ? BattleScenarioService.getSideIds(battle) : ["blue", "red"];
    const resolvedSide = sideIds.includes(side) ? side : sideIds[(shipCount - 1) % sideIds.length] ?? "blue";
    const boardWidth = Number(battle?.board?.width ?? 24);
    const boardHeight = Number(battle?.board?.height ?? 16);
    const sideOffset = battle ? (battle.ships ?? []).filter(unit => unit.side === resolvedSide).length : shipCount - 1;
    const spawn = battle ? BattleScenarioService.getSideSpawnPoint(battle, resolvedSide, sideOffset) : null;
    const resolvedX = x ?? spawn?.x ?? Math.min(boardWidth - 1, 3);
    const resolvedY = y ?? spawn?.y ?? Math.min(boardHeight - 1, 3 + shipCount);
    const template = this.getTemplate(templateKey);
    return createShip({
      name: `${template.label ?? "Корабль"} ${shipCount}`,
      side: resolvedSide,
      x: resolvedX,
      y: resolvedY,
      heading: heading ?? spawn?.heading ?? 120,
      template: templateKey
    });
  }
}
