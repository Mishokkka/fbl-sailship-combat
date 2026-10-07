import { BattleReportService } from "../services/battle-report-service.js";
import { AMMO_LABELS, FIRE_MODE_LABELS } from "../utils/constants.js";
import { GunneryEngine } from "../engine/gunnery-engine.js";
import { DamageEngine } from "../engine/damage-engine.js";

export class ShipGunneryController {
  constructor(app) {
    this.app = app;
  }

  get battle() {
    return this.app.battle;
  }

  async fireArc(arc, button = null) {
    if (this.busy) return;
    const snapshot = this.app.renderBattleSnapshot ?? this.battle;
    const request = {
      battleId: snapshot.id, revision: Number(snapshot.revision ?? 0), round: snapshot.round,
      shipId: this.app.selectedShipId, targetId: button?.dataset?.targetId ?? this.app.selectedTargetId,
      weaponId: button?.dataset?.weaponId ?? null, aim: this.app.aimSection
    };
    if (!request.targetId) return ui.notifications.warn("Сначала выберите цель залпа.");
    this.busy = true;
    let reportId = null;
    try {
      await this.app.renderBattleState(["controls"]);
      const saved = await this.app._updateBattleAndRender(async battle => {
        if (battle.id !== request.battleId || Number(battle.revision ?? 0) !== request.revision
          || battle.round !== request.round || !battle.setupConfirmed || battle.outcome?.resolved
          || this.app.selectedShipId !== request.shipId || this.app.selectedTargetId !== request.targetId
          || this.app.aimSection !== request.aim) {
          ui.notifications.warn("Обстановка или прицел изменились. Проверьте залп заново.");
          return false;
        }
        const ship = battle.ships.find(unit => unit.id === request.shipId);
        if (!this.app._requireActivePhase(battle, ship, "gunnery", "Стрельба")) return false;
        const battery = GunneryEngine.getBattery(ship, arc);
        if (request.weaponId && request.weaponId !== battery?.id) return false;
        const target = battle.ships.find(unit => unit.id === request.targetId);
        const blocked = GunneryEngine.getShotBlockReason(battle, ship, battery, target, { aimedSection: request.aim });
        if (blocked) { ui.notifications.warn(blocked); return false; }
        if (!this.app._markTurnAction(battle, ship, "gunnery")) return false;
        const before = BattleReportService.capture(battle);
        const result = await GunneryEngine.fire(battle, ship.id, arc, target.id, { aimedSection: request.aim });
        if (!result.ok) {
          this.app._refundTurnAction(battle, ship, "gunnery");
          ui.notifications.warn(result.text);
          return false;
        }
        const details = [result.text];
        this.app._addLog(battle, result.text);
        if (result.hit) {
          const damage = DamageEngine.applyAttackResult(result, battle);
          if (damage) { details.push(damage.text); this.app._addLog(battle, damage.text); }
        }
        const report = BattleReportService.record(battle, before, {
          kind: "salvo", outcome: result.delayed ? "prepared" : result.hit ? "hit" : "miss",
          title: `${ship.name} → ${target.name}`, sourceId: ship.id, targetId: target.id, details
        });
        reportId = report.id;
        if (!result.delayed) {
          const timestamp = Date.now();
          battle.lastAudioEvent = { id: "audio-" + reportId, type: "gunfire", shipId: ship.id, timestamp };
        }
        this.finishGunneryActivation(battle, ship);
      }, { reason: `fire-${arc}`, renderParts: [] });
      if (reportId && saved.lastReport?.id === reportId && Number(saved.revision ?? 0) > request.revision) {
        if (this.app.selectedShipId === request.shipId) {
          this.app.selectedShipId = this.app._getActiveShip(saved)?.id ?? request.shipId;
          this.app.selectedTargetId = null;
          this.app.aimSection = null;
        }
      } else if (reportId) ui.notifications.warn("Залп не сохранён. Состояние боя не изменено.");
    } catch (error) {
      this.app.renderBattleSnapshot = null;
      ui.notifications.error("Не удалось сохранить залп. Проверьте состояние боя перед повтором.");
      console.error("Sailships | Salvo failed", error);
    } finally {
      this.busy = false;
      await this.app.renderBattleState();
    }
  }

  finishGunneryActivation(battle, ship) {
    this.app._completeShipActivation(battle, ship, "gunnery");
    const next = this.app._getActiveShip(battle);
    this.app._addLog(battle, next ? `Ход корабля: ${next.name}.` : "Стрельба завершена. Можно перейти к экипажу.");
  }

  async setAmmo(event, target) {
    if (!game.user.isGM) return ui.notifications.warn("Боеприпасы пока меняет ГМ.");
    const actionTarget = target ?? event.currentTarget ?? event.target?.closest?.("[data-action]");
    const weaponId = actionTarget?.dataset?.weaponId;
    const ammo = actionTarget?.dataset?.ammo;
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      const weapon = ship.weapons?.find(w => w.id === weaponId);
      if (!weapon || !ammo) return false;
      if (!GunneryEngine.getAvailableAmmo(battle, ship, weapon).includes(ammo)) {
        ui.notifications.warn(ammo === "heatedShot"
          ? "Каленые ядра требуют корабельной нагревательной печи или сценарной подготовки стороны."
          : "Этот боеприпас несовместим с выбранным орудием.");
        return false;
      }
      if (weapon.ammo === ammo) return false;

      weapon.ammo = ammo;
      this.app._addLog(battle, `${ship.name}: ${weapon.label} заряжает ${AMMO_LABELS[weapon.ammo] ?? weapon.ammo}.`);
    }, { preserveRightPanelScroll: true, reason: "set-ammo" });
  }

  async setFireMode(event, target) {
    if (!game.user.isGM) return ui.notifications.warn("Режим залпа пока меняет ГМ.");
    const actionTarget = target ?? event.currentTarget ?? event.target?.closest?.("[data-action]");
    const weaponId = actionTarget?.dataset?.weaponId;
    const fireMode = actionTarget?.dataset?.fireMode;
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      const weapon = ship.weapons?.find(w => w.id === weaponId);
      if (!weapon || !fireMode) return false;
      if (!GunneryEngine.getAllowedFireModes(weapon).includes(fireMode)) {
        ui.notifications.warn("Этот режим несовместим с выбранным орудием.");
        return false;
      }
      if (weapon.fireMode === fireMode) return false;

      weapon.fireMode = fireMode;
      this.app._addLog(battle, `${ship.name}: ${weapon.label} — режим «${FIRE_MODE_LABELS[weapon.fireMode] ?? weapon.fireMode}».`);
    }, { preserveRightPanelScroll: true, reason: "set-fire-mode" });
  }

  clearTarget() {
    this.app.selectedTargetId = null;
    this.app.aimSection = null;
    this.app.renderBattleState();
  }

  setAim(section) {
    if (section === "crystalCore") {
      const ship = this.app.getSelectedShip(this.battle);
      if (!GunneryEngine.canAttackerTargetCrystalCore(this.battle, ship)) {
        ui.notifications.warn("Этой стороне запрещен прицельный огонь по ядру кристалла.");
        this.app.aimSection = null;
        this.app.renderBattleState();
        return;
      }
    }
    this.app.aimSection = section;
    this.app.renderBattleState();
  }
}
