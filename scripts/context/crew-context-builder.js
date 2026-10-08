import { CrewTaskService } from "../services/crew-task-service.js";
import { BoardingEngine } from "../engine/boarding-engine.js";
import { CreatureGrappleEngine } from "../engine/creature-grapple-engine.js";
import { CombatantRules } from "../rules/combatant-rules.js";

/** Build crew choices only for a detail-visible ship supplied by BattleContextBuilder. */
export class CrewContextBuilder {
  static build(battle, ship, actionState, app) {
    if (!ship || battle.phase !== "crew") return null;
    const actions = battle.turn?.actions?.[ship.id]?.crew ?? {};
    const block = key => app.crew?.busy ? "Работа выполняется."
      : !game.user.isGM ? "Действия выполняет ведущий."
      : battle.outcome?.resolved ? "Бой завершён."
      : !actionState.isActive ? "Сейчас действует другой участник."
      : !actionState.canCrew ? "Не осталось ОД экипажа."
      : actions[key] ? "Этот вид работ уже выполнен в этой фазе." : "";
    const tasks = CrewTaskService.tasks(battle, ship).map(task => {
      const blockedReason = task.repairable ? block(task.actionKey) : task.blockedReason;
      return { ...task, canUse: !blockedReason, blockedReason,
        urgent: task.priority >= 75, priorityLabel: task.priority >= 75 ? "Срочно" : "Требует внимания" };
    });
    const boardingTargets = battle.ships.filter(target => CombatantRules.isActive(target) && BoardingEngine.canGrapple(ship, target))
      .map(target => ({ id: target.id, name: target.name, selected: target.id === app.selectedTargetId }));
    const hostId = BoardingEngine.getGrappledWith(ship);
    const host = battle.ships.find(unit => unit.id === hostId);
    const attached = CreatureGrappleEngine.getAttachedCreatures(battle, ship);
    const boarding = [
      { action: "grapple", key: "crewBoarding:grapple", label: "Сцепиться", visible: !host,
        possible: actionState.canGrappleAction, text: "Соседняя цель на той же высоте. Сцепка сразу свяжет корабли." },
      { action: "boarding", key: "crewBoarding:board", label: "Абордажная атака", visible: Boolean(host),
        possible: actionState.canBoardAction, text: host ? "Атака на " + host.name + ". Сила сторон: " + BoardingEngine.getBoardingPower(ship) + " / " + BoardingEngine.getBoardingPower(host) + ". Потери определит бросок." : "" },
      { action: "releaseGrapple", key: "crewBoarding:release", label: "Разорвать сцепку", visible: Boolean(host),
        possible: actionState.canReleaseGrappleAction, text: "Корабли смогут двигаться независимо." },
      { action: "repelCreature", key: "crewRepelCreature", label: "Отбить чудовище", visible: attached.length > 0,
        possible: actionState.canRepelCreature, text: "На корпусе: " + attached.map(unit => unit.name).join(", ") + ". Исход определит проверка команды." }
    ].filter(entry => entry.visible).map(entry => {
      const blockedReason = block(entry.key) || (!entry.possible ? "Выберите подходящую цель или проверьте условия действия." : "");
      return { ...entry, canUse: !blockedReason, blockedReason };
    });
    const available = tasks.filter(task => task.canUse);
    if (available.length) available[0].suggested = true;
    return {
      tasks: tasks.filter(task => task.repairable), unavailable: tasks.filter(task => !task.repairable),
      availableCount: available.length, taskCount: tasks.filter(task => task.repairable).length,
      noUsefulAction: !available.length && !boarding.some(entry => entry.canUse)
        && !(boardingTargets.length && !block("crewBoarding:grapple")),
      noProblems: tasks.length === 0,
      canFinish: Boolean(actionState.isActive && actionState.canPass && !app.crew?.busy),
      remainingAP: actionState.remainingAP ?? 0,
      boosted: ship.selectedOrder === "damageControl",
      boarding, boardingTargets, boardingRelevant: Boolean(host || attached.length || boardingTargets.length),
      abandonText: actionState.abandonShipTitle,
      canAbandon: Boolean(actionState.canAbandonShip && !app.crew?.busy)
    };
  }
}
