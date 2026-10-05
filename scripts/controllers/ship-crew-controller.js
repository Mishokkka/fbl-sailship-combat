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
    if (remaining > 0) {
      this.app._addLog(battle, `${ship.name}: осталось ОД экипажа ${remaining}.`);
      return;
    }
    this.app._completeShipActivation(battle, ship, "crew");
    const next = this.app._getActiveShip(battle);
    if (next) {
      this.app.selectedShipId = next.id;
      this.app._addLog(battle, `Ход корабля: ${next.name}.`);
    } else {
      this.app._addLog(battle, "Все корабли завершили фазу. Можно перейти дальше.");
    }
  }

  async repair(mode) {
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "crew", "Борьба за живучесть")) return false;
      const actionKey = `crewRepair:${mode ?? "auto"}`;
      if (!this.app._markTurnAction(battle, ship, actionKey)) {
        ui.notifications.warn(`${ship.name} уже выполнял эту команду экипажа в этой фазе или исчерпал ОД.`);
        return false;
      }
      this.app._addLog(battle, DamageEngine.repair(ship, mode));
      this.finishCrewActivation(battle, ship);
    }, { reason: `crew-repair-${mode ?? "auto"}` });
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
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "crew", "Оставить корабль")) return false;
      const actionKey = "crewAbandonShip";
      if (!this.app._markTurnAction(battle, ship, actionKey)) {
        ui.notifications.warn(`${ship.name} уже выполнял эту команду экипажа в этой фазе или исчерпал ОД.`);
        return false;
      }
      const result = DamageEngine.abandonShip(ship);
      this.app._addLog(battle, result.text);
      if (!result.ok) {
        this.app._refundTurnAction(battle, ship, actionKey);
        return;
      }
      this.app._completeShipActivation(battle, ship, "crew");
      const next = this.app._getActiveShip(battle);
      if (next) {
        this.app.selectedShipId = next.id;
        this.app._addLog(battle, `Ход корабля: ${next.name}.`);
      } else {
        this.app._addLog(battle, "Все корабли завершили фазу. Можно перейти дальше.");
      }
    }, { reason: "abandon-ship" });
  }

  async repelCreature() {
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "crew", "Отбить чудовище")) return false;
      const actionKey = "crewRepelCreature";
      if (!this.app._markTurnAction(battle, ship, actionKey)) {
        ui.notifications.warn(`${ship.name}: не хватает ОД или попытка уже предпринималась.`);
        return false;
      }
      const result = CreatureGrappleEngine.repel(battle, ship.id, this.app.selectedTargetId);
      if (!result.ok) {
        this.app._refundTurnAction(battle, ship, actionKey);
        ui.notifications.warn(result.text);
        return false;
      }
      this.app._addLog(battle, result.text);
      this.finishCrewActivation(battle, ship);
    }, { reason: "crew-repel-creature" });
  }

  async boarding(label, action) {
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "crew", label)) return false;
      const actionKey = `crewBoarding:${action}`;
      if (!this.app._markTurnAction(battle, ship, actionKey)) {
        ui.notifications.warn(`${ship.name} уже выполнял эту команду экипажа в этой фазе или исчерпал ОД.`);
        return false;
      }
      const targetId = action === "board" ? BoardingEngine.getGrappledWith(ship) : this.app.selectedTargetId;
      const result = action === "grapple"
        ? BoardingEngine.grapple(battle, ship.id, targetId)
        : action === "board"
          ? BoardingEngine.board(battle, ship.id, targetId)
          : BoardingEngine.release(battle, ship.id);
      this.app._addLog(battle, result.text);
      if (!result.ok) {
        this.app._refundTurnAction(battle, ship, actionKey);
        return;
      }
      this.finishCrewActivation(battle, ship);
    }, { reason: `crew-${action}` });
  }
}
