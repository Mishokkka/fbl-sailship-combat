import { MovementEngine } from "../engine/movement-engine.js";
import { DamageEngine } from "../engine/damage-engine.js";
import { chance } from "../utils/random.js";

export class ShipMovementController {
  constructor(app) {
    this.app = app;
  }

  get battle() {
    return this.app.battle;
  }

  getSelectedShip(battle = this.battle) {
    return this.app.getSelectedShip(battle);
  }

  async fullSail() {
    await this.app._updateBattleAndRender(async battle => {
      const ship = this.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "movement", "Увеличение хода")) return false;
      const inertia = MovementEngine.getInertiaProfile(battle, ship);
      const beforeSpeed = Number(ship.speed ?? 0);
      const resultingSpeed = Math.min(Number(inertia.effectiveMax ?? beforeSpeed), beforeSpeed + Number(inertia.acceleration ?? 1));
      if (!this.app._canSpendMovementPreparation(battle, ship, { resultingSpeed })) {
        ui.notifications.warn(`${ship.name}: оставьте 1 ОД для обязательного движения по инерции.`);
        return false;
      }
      if (!this.app._markTurnAction(battle, ship, "sail")) {
        ui.notifications.warn(`${ship.name} уже менял паруса в этой фазе или исчерпал ОД.`);
        return false;
      }
      const result = MovementEngine.increaseSpeed(battle, ship.id);
      if (!result?.ok) {
        this.app._refundTurnAction(battle, ship, "sail");
        ui.notifications.warn(result?.reason ?? "Нельзя увеличить ход.");
        return false;
      }
      this.app._addLog(battle, `${ship.name}: увеличивает ход ${result.before} → ${ship.speed} (ускорение ${result.acceleration}). Осталось ОД: ${this.app._getRemainingAP(battle, ship, "movement")}.`);
      await this.app._completeIfNoAP(battle, ship, "movement");
    }, { reason: "full-sail" });
  }

  async reduceSail() {
    await this.app._updateBattleAndRender(async battle => {
      const ship = this.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "movement", "Снижение хода")) return false;
      const inertia = MovementEngine.getInertiaProfile(battle, ship);
      const beforeSpeed = Number(ship.speed ?? 0);
      const resultingSpeed = Math.max(0, beforeSpeed - Number(inertia.braking ?? 1));
      if (!this.app._canSpendMovementPreparation(battle, ship, { resultingSpeed })) {
        ui.notifications.warn(`${ship.name}: после торможения останется обязательное движение. Оставьте 1 ОД для манёвра.`);
        return false;
      }
      if (!this.app._markTurnAction(battle, ship, "sail")) {
        ui.notifications.warn(`${ship.name} уже менял паруса в этой фазе или исчерпал ОД.`);
        return false;
      }
      const result = MovementEngine.reduceSpeed(battle, ship.id);
      this.app._addLog(battle, `${ship.name}: снижает ход ${result?.before ?? "?"} → ${ship.speed} (торможение ${result?.braking ?? 1}). Осталось ОД: ${this.app._getRemainingAP(battle, ship, "movement")}.`);
      await this.app._completeIfNoAP(battle, ship, "movement");
    }, { reason: "reduce-sail" });
  }

  async turn(delta) {
    await this.app._updateBattleAndRender(async battle => {
      const ship = this.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "movement", "Поворот")) return false;
      if (MovementEngine.getTurnLimit(ship) <= 0) {
        ui.notifications.warn(ship.unitType === "creature" ? "Повреждения или оглушение не позволяют повернуть." : "Руль или штурвал не позволяют повернуть.");
        return false;
      }
      if (!this.app._canSpendMovementPreparation(battle, ship, { resultingSpeed: Number(ship.speed ?? 0) })) {
        ui.notifications.warn(`${ship.name}: оставьте 1 ОД для обязательного движения по инерции.`);
        return false;
      }
      if (!this.app._markTurnAction(battle, ship, "turn")) {
        ui.notifications.warn(`${ship.name} уже поворачивал в этой фазе или исчерпал ОД.`);
        return false;
      }
      const direction = delta < 0 ? "влево" : "вправо";
      const result = MovementEngine.resolveTurn(battle, ship, delta);
      if (!result.ok) {
        this.app._refundTurnAction(battle, ship, "turn");
        ui.notifications.warn(result.text ?? "Поворот невозможен.");
        return false;
      }
      if (result.assessment?.needsCheck) {
        battle.turn ??= {};
        battle.turn.lastManeuverCheck = {
          shipId: ship.id,
          shipName: ship.name,
          round: battle.round,
          phase: battle.phase,
          direction,
          reason: result.assessment.reason,
          roll: result.assessment.roll,
          skill: result.assessment.skill,
          success: !result.failed,
          text: result.failed
            ? `Провал: 3d6=${result.assessment.roll} > ${result.assessment.skill}`
            : `Успех: 3d6=${result.assessment.roll} ≤ ${result.assessment.skill}`
        };
      }
      this.app._addLog(battle, `${ship.name}: поворот ${direction}: ${result.text} Осталось ОД: ${this.app._getRemainingAP(battle, ship, "movement")}.`);
      await this.app._completeIfNoAP(battle, ship, "movement");
    }, { reason: "turn" });
  }

  async coreManeuver(mode) {
    await this.app._updateBattleAndRender(async battle => {
      const ship = this.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "movement", "Ядро кристалла")) return false;
      const modeData = MovementEngine.getCoreModeData(ship);
      const beforeSpeed = Number(ship.speed ?? 0);
      const isImpulse = mode === "impulse";
      const resultingSpeed = isImpulse
        ? Math.min(MovementEngine.getEffectiveMaxSpeed(battle, ship) + Number(modeData.impulseBonus ?? 1), beforeSpeed + Number(modeData.impulseBonus ?? 1))
        : beforeSpeed;
      if (!this.app._canSpendMovementPreparation(battle, ship, { resultingSpeed })) {
        ui.notifications.warn(`${ship.name}: оставьте 1 ОД для обязательного движения по инерции.`);
        return false;
      }
      if (!this.app._markTurnAction(battle, ship, "core")) {
        ui.notifications.warn(`${ship.name} уже нагружал ядро в этой фазе или исчерпал ОД.`);
        return false;
      }
      const result = MovementEngine.applyCoreManeuver(battle, ship, mode);
      if (!result?.ok) {
        this.app._refundTurnAction(battle, ship, "core");
        ui.notifications.warn(result?.reason ?? "Маневр ядра невозможен.");
        return false;
      }

      const heatText = DamageEngine.applyCrystalHeat(ship, Number(result.heat ?? 0), result.reason ?? "маневр ядра");
      let riskText = "";
      if (chance(modeData.risk)) {
        const beforeIntegrity = Number(ship.crystal.integrity ?? 0);
        ship.crystal.integrity = Math.max(0, beforeIntegrity - 1);
        riskText = ` Рискованный режим повреждает ядро: целостность ${beforeIntegrity}/${ship.crystal.maxIntegrity} → ${ship.crystal.integrity}/${ship.crystal.maxIntegrity}.`;
        if (ship.crystal.integrity <= 0) riskText += DamageEngine.triggerCrystalFailure(ship, "аварийная нагрузка сорвала ядро", { battle });
      }
      const modeLabel = modeData.label;
      this.app._addLog(battle, `${ship.name}: ядро (${modeLabel}) — ${result.text} ${heatText}${riskText} Осталось ОД: ${this.app._getRemainingAP(battle, ship, "movement")}.`);

      await this.app._completeIfNoAP(battle, ship, "movement");
    }, { reason: `core-${mode}` });
  }

  async setCoreMode(mode) {
    await this.app._updateBattleAndRender(battle => {
      const ship = this.getSelectedShip(battle);
      if (!this.app._requireActivePhase(battle, ship, "movement", "Режим ядра")) return false;
      const result = MovementEngine.setCoreMode(ship, mode, battle);
      if (!result?.ok && result?.before === result?.after) {
        ui.notifications.info(`${ship.name}: режим ядра уже «${result.label}».`);
        return false;
      }
      if (!result?.ok) {
        ui.notifications.warn(result?.reason ?? "Нельзя сменить режим ядра.");
        return false;
      }
      this.app._addLog(battle, `${ship.name}: режим ядра — ${result.label}.`);
    }, { reason: `set-core-mode-${mode}` });
  }
}
