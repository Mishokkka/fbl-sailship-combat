import { CrewTaskService } from "../services/crew-task-service.js";
import { BattleReportService } from "../services/battle-report-service.js";
import { DamageEngine } from "../engine/damage-engine.js";
import { BoardingEngine } from "../engine/boarding-engine.js";
import { CreatureGrappleEngine } from "../engine/creature-grapple-engine.js";

export class ShipCrewController {
  constructor(app) {
    this.app = app;
  }

  get battle() {
    return this.app.battle;
  }

  finishCrewActivation(battle, ship) {
    const remaining = this.app._getRemainingAP(battle, ship, "crew");
    if (remaining > 0 && !ship.flags?.struck) {
      this.app._addLog(battle, ship.name + ": осталось ОД экипажа " + remaining + ".");
      return;
    }
    this.app._completeShipActivation(battle, ship, "crew");
    const next = this.app._getActiveShip(battle);
    this.app._addLog(battle, next ? "Ход корабля: " + next.name + "." : "Работа экипажей завершена. Можно завершить раунд.");
  }

  /** Execute the shown decision once, and change local selection only after a verified save. */
  async execute({ reason, button = null, usesTarget = false }, resolve) {
    if (!game.user.isGM || this.busy) return false;
    const shown = this.app.renderBattleSnapshot ?? this.battle;
    const request = { id: shown.id, revision: Number(button?.dataset?.revision ?? shown.revision),
      round: shown.round, shipId: button?.dataset?.shipId ?? this.app.selectedShipId, targetId: this.app.selectedTargetId };
    this.busy = true;
    let reportId = null;
    try {
      const saved = await this.app._updateBattleAndRender(battle => {
        if (battle.id !== request.id || battle.revision !== request.revision || battle.round !== request.round
          || !battle.setupConfirmed || battle.outcome?.resolved || this.app.selectedShipId !== request.shipId
          || (usesTarget && this.app.selectedTargetId !== request.targetId)) {
          ui.notifications.warn("Обстановка изменилась. Проверьте задачу экипажа заново.");
          return false;
        }
        const ship = battle.ships.find(unit => unit.id === request.shipId);
        if (ship?.unitType === "creature" || !this.app._requireActivePhase(battle, ship, "crew", "Работа экипажа")) return false;
        const before = BattleReportService.capture(battle);
        const result = resolve(battle, ship, request);
        if (!result.ok) { ui.notifications.warn(result.text); return false; }
        this.app._addLog(battle, result.text);
        this.finishCrewActivation(battle, ship);
        reportId = BattleReportService.record(battle, before, {
          kind: "crew", outcome: "worked", title: ship.name + " · " + result.label,
          sourceId: ship.id, targetId: result.targetId ?? ship.id, details: [result.text]
        }).id;
        return true;
      }, { reason, renderParts: [] });
      if (reportId && saved?.lastReport?.id === reportId && saved.revision > request.revision) {
        if (this.app.selectedShipId === request.shipId) {
          const next = this.app._getActiveShip(saved);
          this.app.selectedShipId = next?.id ?? request.shipId;
          if (next?.id !== request.shipId) this.app.selectedTargetId = null;
        }
        return true;
      }
      if (reportId) ui.notifications.warn("Работа экипажа не сохранена. Проверьте состояние боя.");
      return false;
    } catch (error) {
      this.app.renderBattleSnapshot = null;
      ui.notifications.error("Не удалось сохранить работу экипажа. Проверьте состояние боя перед повтором.");
      console.error("Sailships Combat | Crew action failed", error);
      return false;
    } finally {
      this.busy = false;
      await this.app.renderBattleState();
    }
  }

  async performTask(taskId, button = null) {
    return this.execute({ reason: "crew-task", button }, (battle, ship) => {
      const task = CrewTaskService.tasks(battle, ship).find(task => task.id === taskId);
      if (!task?.repairable) return { ok: false, text: task?.blockedReason ?? "Выбранная авария уже устранена или изменилась." };
      if (!this.app._markTurnAction(battle, ship, task.actionKey)) return { ok: false, text: "Этот вид работ уже выполнен или не осталось ОД экипажа." };
      const result = CrewTaskService.resolve(battle, ship, task.id);
      if (!result.ok) this.app._refundTurnAction(battle, ship, task.actionKey);
      return { ...result, label: task.title };
    });
  }

  // Older action IDs remain usable, but now resolve to a concrete task before entering the queue.
  async repair(mode) {
    const battle = this.app.renderBattleSnapshot ?? this.battle;
    const ship = this.app.getSelectedShip(battle);
    const tasks = CrewTaskService.tasks(battle, ship).filter(task => task.repairable);
    const modes = mode === "auto" ? ["fire", "flooding", "breaches", "wreckage", "system"]
      : mode === "flooding" ? ["flooding", "breaches"] : mode === "system" ? ["wreckage", "system"] : [mode];
    const task = modes.map(mode => tasks.find(task => task.mode === mode)).find(Boolean);
    if (!task) return ui.notifications.warn("Подходящих задач для этого вида работ нет.");
    return this.performTask(task.id);
  }

  async manualDamage(kind) {
    if (!game.user.isGM) return ui.notifications.warn("Ручные повреждения доступны только ГМу.");
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      const text = kind === "fire"
        ? DamageEngine.addManualFire(ship, "midship")
        : kind === "flooding"
          ? DamageEngine.addManualFlooding(ship, "midship")
          : DamageEngine.addManualDamage(ship, 5, "midship");
      this.app._addLog(battle, text);
    }, { reason: `manual-${kind}` });
  }

  async abandonShip() {
    return this.execute({ reason: "abandon-ship" }, (battle, ship) => {
      if (!this.app._markTurnAction(battle, ship, "crewAbandonShip")) return { ok: false, text: "Недостаточно ОД экипажа." };
      const result = DamageEngine.abandonShip(ship);
      if (!result.ok) this.app._refundTurnAction(battle, ship, "crewAbandonShip");
      return { ...result, label: "Оставить корабль" };
    });
  }

  async repelCreature() {
    return this.execute({ reason: "crew-repel-creature", usesTarget: true }, (battle, ship, request) => {
      const actionKey = "crewRepelCreature";
      if (!this.app._markTurnAction(battle, ship, actionKey)) return { ok: false, text: "Попытка уже использована или не осталось ОД." };
      const result = CreatureGrappleEngine.repel(battle, ship.id, request.targetId);
      if (!result.ok) this.app._refundTurnAction(battle, ship, actionKey);
      return { ...result, label: "Отбить чудовище" };
    });
  }

  async boarding(label, action) {
    return this.execute({ reason: "crew-" + action, usesTarget: action === "grapple" }, (battle, ship, request) => {
      const actionKey = "crewBoarding:" + action;
      if (!this.app._markTurnAction(battle, ship, actionKey)) return { ok: false, text: "Эта команда уже выполнена или не осталось ОД." };
      const targetId = action === "grapple" ? request.targetId : BoardingEngine.getGrappledWith(ship);
      const result = action === "grapple" ? BoardingEngine.grapple(battle, ship.id, targetId)
        : action === "board" ? BoardingEngine.board(battle, ship.id, targetId) : BoardingEngine.release(battle, ship.id);
      if (!result.ok) this.app._refundTurnAction(battle, ship, actionKey);
      return { ...result, label, targetId };
    });
  }
}
