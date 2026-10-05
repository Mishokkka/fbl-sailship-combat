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

  async fireArc(arc) {
    await this.app._updateBattleAndRender(async battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "gunnery", "Стрельба")) return false;
      if (!this.app._markTurnAction(battle, ship, "gunnery")) {
        ui.notifications.warn(`${ship.name} уже стрелял в этой фазе или исчерпал ОД.`);
        return false;
      }

      const result = await GunneryEngine.fire(battle, ship.id, arc, this.app.selectedTargetId, { aimedSection: this.app.aimSection });
      this.app._addLog(battle, result.text);
      if (!result.ok) {
        this.app._refundTurnAction(battle, ship, "gunnery");
        return;
      }

      if (result.hit) {
        const damage = DamageEngine.applyAttackResult(result, battle);
        if (damage) this.app._addLog(battle, damage.text);
      }

      const audioTimestamp = Date.now();
      battle.lastAudioEvent = {
        id: `audio-gunfire-${Number(battle.round ?? 1)}-${ship.id}-${audioTimestamp}`,
        type: "gunfire",
        shipId: ship.id,
        timestamp: audioTimestamp
      };

      this.finishGunneryActivation(battle, ship);
    }, { reason: `fire-${arc}` });
  }

  finishGunneryActivation(battle, ship) {
    this.app._completeShipActivation(battle, ship, "gunnery");
    const next = this.app._getActiveShip(battle);
    if (next) {
      this.app.selectedShipId = next.id;
      this.app._addLog(battle, `Ход корабля: ${next.name}.`);
    } else {
      this.app._addLog(battle, "Все корабли завершили фазу. Можно перейти дальше.");
    }
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
