import { CombatantRules } from "../rules/combatant-rules.js";
import { GunneryEngine } from "../engine/gunnery-engine.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { BoardingEngine } from "../engine/boarding-engine.js";
import { CreatureAttackEngine } from "../engine/creature-attack-engine.js";
import { CreatureAbilityEngine } from "../engine/creature-ability-engine.js";
import { CreatureGrappleEngine } from "../engine/creature-grapple-engine.js";
import { CrewTaskService } from "./crew-task-service.js";

const state = (kind, label, reason = label, extra = {}) =>
  ({ kind, label, reason, canSkip: kind === "waiting", ...extra });

/** Read-only readiness across all targets; orders and movement always remain manual decisions. */
export class ActivationReadinessService {
  static assess(battle, unit, budget) {
    if (!unit || !battle.ships?.some(ship => ship.id === unit.id) || !CombatantRules.isEligibleForPhase(unit, battle.phase)) return state("unknown", "Вне очереди");
    if (battle.turn?.completed?.[battle.phase]?.includes(unit.id)) return state("done", "Завершено");
    if (!battle.setupConfirmed || battle.outcome?.resolved) return state("unknown", "Бой не активен");
    // A projection cannot establish the absence of legal actions against hidden opponents.
    if (battle.projection?.kind === "player" || unit.contactState) return state("unknown", "Решение ведущего");
    const actions = battle.turn?.actions?.[unit.id]?.[battle.phase] ?? {};
    if (battle.phase === "orders") return state("manual", "Нужен приказ");
    if (battle.phase === "movement") {
      const copy = foundry.utils.deepClone(battle);
      const moving = copy.ships.find(ship => ship.id === unit.id);
      const resolution = MovementEngine.getHorizontalResolutionState(copy, moving, { actions, checkRoutes: true });
      return resolution.mustMove
        ? state("required", "Обязательное движение", "Инерция: минимум " + resolution.requiredAdvance + " гекс. Манёвр выбирает ведущий.")
        : state("manual", "Решение о манёвре", "Манёвр и завершение движения остаются под контролем ведущего.");
    }
    if (!["gunnery", "crew"].includes(battle.phase)) return state("unknown", "Расчёт фазы");
    if (Number(budget ?? 0) - Number(actions._apSpent ?? 0) <= 0) return state("waiting", "ОД потрачены");

    // Some engine previews normalize weapon settings. Keep those writes off the authoritative state.
    const copy = foundry.utils.deepClone(battle);
    const ship = copy.ships.find(ship => ship.id === unit.id);
    if (ship.unitType === "creature") return this.creature(copy, ship, actions);
    return battle.phase === "gunnery" ? this.gunnery(copy, ship, actions) : this.crew(copy, ship, actions);
  }

  static gunnery(battle, ship, actions) {
    if (actions.gunnery) return state("waiting", "Залп уже выполнен");
    const batteries = GunneryEngine.getArcOrder().map(arc => GunneryEngine.getBattery(ship, arc))
      .filter(battery => battery && GunneryEngine.isBatteryFunctional(ship, battery));
    if (!batteries.length) return state("waiting", "Нет действующих батарей");
    const ready = batteries.filter(battery => Number(battery.reload ?? 0) <= 0);
    const reloading = batteries.filter(battery => Number(battery.reload ?? 0) > 0);
    const reloadRounds = reloading.length ? Math.min(...reloading.map(battery => Number(battery.reload))) : null;
    for (const battery of ready) {
      for (const ammo of GunneryEngine.getAvailableAmmo(battle, ship, battery)) {
        battery.ammo = ammo;
        for (const mode of GunneryEngine.getAllowedFireModes(battery)) {
          battery.fireMode = mode;
          if (GunneryEngine.getTargets(battle, ship, battery.arc, { aimedSection: null }).length) {
            return state("ready", "Есть залп", "Есть допустимая цель хотя бы для одной батареи; можно выбрать боеприпас и режим.");
          }
        }
      }
    }
    return ready.length
      ? state("waiting", "Нет допустимой цели", "Проверены все цели, боеприпасы и режимы готовых батарей."
        + (reloadRounds ? " Ближайшая перезарядка: " + reloadRounds + " р." : ""), { reloadRounds })
      : state("waiting", "Перезарядка · " + reloadRounds + " р.",
        "Ближайшая действующая батарея будет готова через " + reloadRounds + " окончаний раунда. Возможность выстрела зависит от обстановки.", { reloadRounds });
  }

  static crew(battle, ship, actions) {
    const tasks = CrewTaskService.tasks(battle, ship).filter(task => task.repairable && !actions[task.actionKey]);
    if (tasks.length) return state("ready", "Работа экипажа", "Доступно задач: " + tasks.length + ". Первая по приоритету: " + tasks[0].title + ".");
    const hostId = BoardingEngine.getGrappledWith(ship);
    const host = battle.ships.find(unit => unit.id === hostId);
    if (hostId && !actions["crewBoarding:release"]) return state("ready", "Разрыв сцепки");
    if (host && host.side !== ship.side && host.flags?.grappledWith === ship.id && !actions["crewBoarding:board"]) return state("ready", "Абордажная атака");
    if (!actions["crewBoarding:grapple"] && battle.ships.some(target =>
      CombatantRules.isActive(target) && BoardingEngine.canGrapple(ship, target))) return state("ready", "Есть цель для сцепки");
    const attached = CreatureGrappleEngine.getAttachedCreatures(battle, ship);
    if (!actions.crewRepelCreature && attached.some(creature => CreatureGrappleEngine.findDetachCell(battle, creature, ship))) {
      return state("ready", "Защита палубы", "Можно попытаться сбросить прицепившееся существо.");
    }
    return state("waiting", "Нет доступных работ",
      attached.length && !actions.crewRepelCreature
        ? "Для сброса существа нет свободной клетки. Других доступных работ нет."
        : "Ремонт, сбор команды, абордаж и защита палубы сейчас недоступны. Эвакуация остаётся ручным решением.");
  }

  static creature(battle, creature, actions) {
    for (const ability of CreatureAbilityEngine.getActiveAbilities(creature, battle.phase)) {
      if (actions["creatureAbility:" + ability.id]) continue;
      const targets = ability.target === "enemy"
        ? battle.ships.filter(unit => unit.side !== creature.side && CombatantRules.isActive(unit)).map(unit => unit.id) : [null];
      if (targets.some(id => CreatureAbilityEngine.canUse(battle, creature, ability, id))) {
        return state("ready", "Есть способность", ability.label ?? "Доступна способность существа.");
      }
    }
    if (battle.phase === "gunnery") {
      if (!actions.creatureAttack && (creature.attacks ?? []).some(attack => CreatureAttackEngine.getTargets(battle, creature, attack.id).length)) {
        return state("ready", "Есть атака");
      }
      const timers = (creature.attacks ?? []).filter(attack => Number(attack.cooldown ?? 0) > 0).map(attack => Number(attack.cooldown));
      const reloadRounds = timers.length ? Math.min(...timers) : null;
      return state("waiting", "Нет доступной атаки", "Проверены атаки, цели и активные способности."
        + (reloadRounds ? " Ближайшее восстановление атаки: " + reloadRounds + " р." : ""), { reloadRounds });
    }
    const recovery = [
      ["stopBleeding", Number(creature.flags?.bleeding ?? 0) > 0],
      ["shakeOff", Number(creature.flags?.stunned ?? 0) > 0],
      ["extinguish", Boolean(creature.flags?.burning)],
      ["steady", Number(creature.vitality?.morale ?? 10) < 10]
    ];
    if (recovery.some(([mode, needed]) => needed && !actions["creatureRecover:" + mode])) return state("ready", "Нужно восстановление");
    return state("waiting", "Восстановление не требуется", "Нет доступного восстановления или активной способности.");
  }
}
