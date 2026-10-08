import { MovementEngine } from "../engine/movement-engine.js";
import { SECTION_LABELS, STATUS_LABELS } from "../utils/constants.js";
import { boundedArray, boundedInteger, boundedString, isPlainObject } from "../utils/schema.js";

const OUTCOMES = { worked: "Работа экипажа выполнена", hit: "Попадание", miss: "Промах", prepared: "Батарея подготовлена · +2 к следующему залпу", resolved: "Эффекты раунда обработаны" };

/** Reports describe actual before/after state; they never simulate damage or roll dice. */
export class BattleReportService {
  static capture(battle) {
    return (battle.ships ?? []).map(unit => {
      const values = {};
      const add = (key, label, value) => { values[key] = { label, value: String(value ?? "—") }; };
      add("position", "Позиция", unit.x + ", " + unit.y);
      add("speed", "Ход", unit.speed);
      add("maxSpeed", "Предельный ход", MovementEngine.getEffectiveMaxSpeed(battle, unit));
      if (MovementEngine.usesAltitude(battle)) {
        add("altitude", "Высота", unit.altitude);
        add("vertical", "Вертикальная инерция", unit.verticalVelocity ?? 0);
      }
      add("crew", unit.unitType === "creature" ? "Жизненная сила" : "Экипаж", unit.vitality?.current ?? unit.crew?.current);
      add("rescued", "Спасено команды", unit.crew?.rescued ?? 0);
      add("morale", "Мораль", unit.vitality?.morale ?? unit.crew?.morale);
      if (MovementEngine.usesCore(battle) && unit.crystal) {
        add("coreHeat", "Нагрев ядра", unit.crystal.heat);
        add("coreIntegrity", "Целостность ядра", unit.crystal.integrity);
      }
      for (const [id, section] of Object.entries(unit.sections ?? {})) {
        const name = section.label ?? SECTION_LABELS[id] ?? id;
        for (const [field, label, value] of [
          ["hp", "HP", section.hp?.value], ["fire", "пожар", section.fire ?? 0],
          ["wreckage", "завалы", section.mastWreckage ?? 0],
          ["flooding", "затопление", section.flooding ?? 0], ["breaches", "пробоины", section.breaches ?? 0]
        ]) add(id + ":" + field, name + " · " + label, value);
        for (const [index, system] of (section.systems ?? []).entries()) {
          const key = id + ":system:" + (system.id ?? index);
          const systemName = name + " · " + (system.name ?? "Система");
          add(key, systemName, STATUS_LABELS[system.status ?? "intact"] ?? system.status);
          add(key + ":hp", systemName + " · HP", system.hp?.value);
        }
      }
      for (const [key, label] of Object.entries({
        immobilized: "Обездвижен", uncontrolledFire: "Неконтролируемый пожар", abandoned: "Корабль оставлен",
        falling: "Падение", struck: "Выбыл из боя", withdrawn: "Отступление",
        suppressed: "Подавление", coreExploded: "Взрыв ядра", burning: "Горит"
      })) add("flag:" + key, label, unit.flags?.[key] ? "да" : "нет");
      for (const [key, label] of [["bleeding", "Кровотечение"], ["stunned", "Оглушение"]]) {
        add("flag:" + key, label, unit.flags?.[key] ?? 0);
      }
      for (const weapon of unit.weapons ?? []) {
        add("reload:" + weapon.id, (weapon.label ?? "Батарея") + " · перезарядка", weapon.reload ?? 0);
        add("delayed:" + weapon.id, (weapon.label ?? "Батарея") + " · подготовка", weapon.delayed ? "+2" : "нет");
      }
      for (const attack of unit.attacks ?? []) add("attack:" + attack.id, (attack.label ?? "Атака") + " · перезарядка", attack.cooldown ?? 0);
      return { id: unit.id, name: unit.name, values };
    });
  }

  static record(battle, before, { kind = "salvo", outcome = "resolved", title = "", sourceId = null, targetId = null, details = [], round = battle.round } = {}) {
    const previous = new Map(before.map(unit => [unit.id, unit]));
    const groups = [];
    for (const unit of this.capture(battle)) {
      const old = previous.get(unit.id);
      if (!old) continue;
      const changes = Object.entries(unit.values).filter(([key, row]) => old.values[key]?.value !== row.value)
        .map(([key, row]) => ({ label: row.label, before: old.values[key]?.value ?? "—", after: row.value }));
      if (changes.length) groups.push({ unitId: unit.id, name: unit.name, changes });
    }
    battle.lastReport = this.normalize({
      id: "report-" + battle.id + "-" + (Number(battle.revision ?? 0) + 1),
      battleId: battle.id, round, kind, outcome, title, sourceId, targetId, groups, details
    }, battle);
    return battle.lastReport;
  }

  static normalize(value, battle) {
    if (!isPlainObject(value) || !value.id || value.battleId !== battle.id || !["salvo", "round", "crew"].includes(value.kind)) return null;
    const text = (value, maxLength = 256) => boundedString(value, { maxLength });
    return {
      id: text(value.id, 180), battleId: text(battle.id, 128),
      round: boundedInteger(value.round, { fallback: battle.round, min: 1, max: 1_000_000 }),
      kind: value.kind,
      outcome: Object.hasOwn(OUTCOMES, value.outcome) ? value.outcome : "resolved",
      title: text(value.title), sourceId: value.sourceId ? text(value.sourceId, 128) : null,
      targetId: value.targetId ? text(value.targetId, 128) : null,
      groups: boundedArray(value.groups, { maxLength: 200 }).filter(isPlainObject).map(group => ({
        unitId: text(group.unitId, 128), name: text(group.name),
        changes: boundedArray(group.changes, { maxLength: 32 }).filter(isPlainObject).map(row => ({
          label: text(row.label, 128), before: text(row.before, 80), after: text(row.after, 80)
        }))
      })),
      details: boundedArray(value.details, { maxLength: 80 }).map(line => text(line, 2000))
    };
  }

  static project(report, controlledIds, ships) {
    if (!report) return null;
    const groups = report.groups.filter(group => controlledIds.has(group.unitId));
    if (report.kind !== "round" && !controlledIds.has(report.sourceId) && !controlledIds.has(report.targetId) && !groups.length) return null;
    const visible = new Map(ships.filter(ship => ship.contactState !== "lost").map(ship => [ship.id, ship]));
    return {
      ...report,
      title: report.kind === "round" ? "Итоги раунда " + report.round
        : report.kind === "crew" ? "Работа экипажа · " + (visible.get(report.sourceId)?.name ?? "Неизвестный участник")
        : (visible.get(report.sourceId)?.name ?? "Неизвестный участник") + " → " + (visible.get(report.targetId)?.name ?? "Неизвестная цель"),
      sourceId: visible.has(report.sourceId) ? report.sourceId : null,
      targetId: visible.has(report.targetId) ? report.targetId : null,
      groups, details: []
    };
  }

  static context(report) {
    if (!report) return null;
    const primary = report.groups.find(group => group.unitId === report.targetId) ?? report.groups[0];
    return {
      ...report,
      label: report.kind === "round" ? "Раунд завершён" : report.kind === "crew" ? "Экипаж · раунд " + report.round : "Последняя атака · раунд " + report.round,
      outcomeLabel: OUTCOMES[report.outcome] ?? OUTCOMES.resolved,
      leadChange: primary?.changes[0] ? { ...primary.changes[0], name: primary.name } : null,
      highlights: primary ? primary.changes.slice(0, 3).map(row => ({ ...row, name: primary.name })) : [],
      hasChanges: report.groups.some(group => group.changes.length)
    };
  }
}
