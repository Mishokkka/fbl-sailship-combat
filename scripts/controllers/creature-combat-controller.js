import { CreatureAttackEngine } from "../engine/creature-attack-engine.js";
import { CreatureDamageEngine } from "../engine/creature-damage-engine.js";
import { CreatureMovementEngine } from "../engine/creature-movement-engine.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { CreatureAbilityEngine } from "../engine/creature-ability-engine.js";
import { CreatureGrappleEngine } from "../engine/creature-grapple-engine.js";
import { CreatureAIEngine } from "../engine/creature-ai-engine.js";

export class CreatureCombatController {
  constructor(app) {
    this.app = app;
  }

  getSelectedCreature(battle) {
    const unit = this.app.getSelectedShip(battle);
    return unit?.unitType === "creature" ? unit : null;
  }

  async vertical(mode) {
    await this.app._updateBattleAndRender(async battle => {
      const creature = this.getSelectedCreature(battle);
      if (!this.app._requireActivePhase(battle, creature, "movement", mode === "climb" ? "Набор высоты" : "Снижение")) return false;
      if (!this.app._canSpendMovementPreparation(battle, creature, { resultingSpeed: Number(creature.speed ?? 0) })) {
        ui.notifications.warn(`${creature.name}: оставьте 1 ОД для обязательного движения по инерции.`);
        return false;
      }
      if (!this.app._markTurnAction(battle, creature, "vertical")) {
        ui.notifications.warn(`${creature.name} уже менял высоту в этой фазе или исчерпал ОД.`);
        return false;
      }
      const result = CreatureMovementEngine.verticalManeuver(battle, creature, mode, MovementEngine);
      if (!result.ok) {
        this.app._refundTurnAction(battle, creature, "vertical");
        ui.notifications.warn(result.reason ?? "Вертикальный маневр невозможен.");
        return false;
      }
      this.app._addLog(battle, `${creature.name}: ${result.text} Осталось ОД: ${this.app._getRemainingAP(battle, creature, "movement")}.`);
      await this.app._completeIfNoAP(battle, creature, "movement");
    }, { reason: `creature-${mode}` });
  }

  async recoverFall() {
    await this.app._updateBattleAndRender(async battle => {
      const creature = this.getSelectedCreature(battle);
      if (!this.app._requireActivePhase(battle, creature, "movement", "Выход из падения")) return false;
      const profile = CreatureMovementEngine.getFallRecoveryProfile(battle, creature);
      if (!profile.canAttempt) {
        ui.notifications.warn(profile.reason ?? "Существо не может восстановить полёт.");
        return false;
      }
      if (!this.app._markTurnAction(battle, creature, "recoverFall")) {
        ui.notifications.warn(`${creature.name}: попытка выхода из падения уже использована или не хватает ОД.`);
        return false;
      }
      const result = CreatureMovementEngine.recoverFromFall(battle, creature);
      if (!result.ok) {
        this.app._refundTurnAction(battle, creature, "recoverFall");
        ui.notifications.warn(result.text ?? `${creature.name}: не удалось выйти из падения.`);
        return false;
      }
      this.app._addLog(battle, result.text);
      await this.app._completeIfNoAP(battle, creature, "movement");
    }, { reason: "creature-recover-fall" });
  }

  async attack(attackId) {
    await this.app._updateBattleAndRender(battle => {
      const creature = this.getSelectedCreature(battle);
      if (!this.app._requireActivePhase(battle, creature, "gunnery", "Атака существа")) return false;
      if (!attackId) return false;
      if (!this.app._markTurnAction(battle, creature, "creatureAttack")) {
        ui.notifications.warn(`${creature.name} уже атаковал в этой фазе или исчерпал ОД.`);
        return false;
      }
      const result = CreatureAttackEngine.resolve(battle, creature.id, attackId, this.app.selectedTargetId);
      if (!result.ok) {
        this.app._refundTurnAction(battle, creature, "creatureAttack");
        ui.notifications.warn(result.text ?? "Атака невозможна.");
        return false;
      }
      this.app._addLog(battle, result.text);
      const timestamp = Date.now();
      battle.lastAudioEvent = { id: `audio-creature-${battle.round}-${creature.id}-${timestamp}`, type: "creatureAttack", shipId: creature.id, timestamp };
      this.app._completeShipActivation(battle, creature, "gunnery");
      const next = this.app._getActiveShip(battle);
      if (next) {
        this.app.selectedShipId = next.id;
        this.app._addLog(battle, `Ход боевой единицы: ${next.name}.`);
      } else {
        this.app._addLog(battle, "Все боевые единицы завершили фазу. Можно перейти дальше.");
      }
      this.app.selectedTargetId = null;
    }, { reason: `creature-attack-${attackId}` });
  }

  async ability(abilityId) {
    await this.app._updateBattleAndRender(async battle => {
      const creature = this.getSelectedCreature(battle);
      if (!creature || !["movement", "gunnery", "crew"].includes(battle.phase)) return false;
      if (!this.app._requireActivePhase(battle, creature, battle.phase, "Способность существа")) return false;
      const ability = CreatureAbilityEngine.getAbility(creature, abilityId);
      if (battle.phase === "movement") {
        const before = Number(creature.speed ?? 0);
        const resultingSpeed = ability?.effect === "dash"
          ? Math.min(Number(creature.maxSpeed ?? before), before + Math.max(1, Number(ability.power ?? 1)))
          : before;
        if (!this.app._canSpendMovementPreparation(battle, creature, { resultingSpeed })) {
          ui.notifications.warn(`${creature.name}: оставьте 1 ОД для обязательного движения по инерции.`);
          return false;
        }
      }
      const key = `creatureAbility:${abilityId}`;
      if (!this.app._markTurnAction(battle, creature, key)) {
        ui.notifications.warn(`${creature.name}: способность уже использована в этой фазе или не хватает ОД.`);
        return false;
      }
      const result = CreatureAbilityEngine.resolve(battle, creature.id, abilityId, this.app.selectedTargetId);
      if (!result.ok) {
        this.app._refundTurnAction(battle, creature, key);
        ui.notifications.warn(result.text ?? "Способность недоступна.");
        return false;
      }
      this.app._addLog(battle, result.text);
      await this.app._completeIfNoAP(battle, creature, battle.phase);
    }, { reason: `creature-ability-${abilityId}` });
  }

  async detach() {
    await this.app._updateBattleAndRender(async battle => {
      const creature = this.getSelectedCreature(battle);
      if (!this.app._requireActivePhase(battle, creature, "movement", "Отцепление")) return false;
      if (!this.app._markTurnAction(battle, creature, "creatureDetach")) {
        ui.notifications.warn(`${creature.name}: не хватает ОД для отцепления.`);
        return false;
      }
      const result = CreatureGrappleEngine.detach(battle, creature.id);
      if (!result.ok) {
        this.app._refundTurnAction(battle, creature, "creatureDetach");
        ui.notifications.warn(result.text);
        return false;
      }
      this.app._addLog(battle, result.text);
      await this.app._completeIfNoAP(battle, creature, "movement");
    }, { reason: "creature-detach" });
  }

  async runAI() {
    await this.app._updateBattleAndRender(battle => {
      const creature = this.getSelectedCreature(battle);
      if (!creature || !this.app._requireActivePhase(battle, creature, battle.phase, "Ход ИИ")) return false;
      if (!creature.behavior?.controlledByAI) {
        ui.notifications.warn(`${creature.name}: управление ИИ отключено в редакторе.`);
        return false;
      }
      const result = CreatureAIEngine.runPhase(battle, creature);
      if (!result.ok) {
        ui.notifications.warn(result.text ?? "ИИ не смог выполнить действие.");
        return false;
      }
      this.app._addLog(battle, `[ИИ] ${result.text}`);
      if (battle.phase === "movement") {
        const actions = this.app._getShipTurnActions(battle, creature);
        if (result.moved) actions.move = true;
        const resolution = MovementEngine.resolveHorizontalCompletion(battle, creature, { actions });
        if (!resolution.ok) {
          ui.notifications.warn(`${creature.name}: ИИ восстановил движение, но не завершил обязательный путь. Выберите подсвеченную клетку вручную.`);
          return false;
        }
        if (resolution.text) this.app._addLog(battle, resolution.text);
      }
      this.app._completeShipActivation(battle, creature, battle.phase);
      const next = this.app._getActiveShip(battle);
      if (next) {
        this.app.selectedShipId = next.id;
        this.app._addLog(battle, `Ход боевой единицы: ${next.name}.`);
      } else this.app._addLog(battle, "Все боевые единицы завершили фазу. Можно перейти дальше.");
      this.app.selectedTargetId = null;
    }, { reason: "creature-ai" });
  }

  async manualDamage(sectionId, amount) {
    if (!game.user.isGM) return ui.notifications.warn("Ручной урон доступен только ГМу.");
    await this.app._updateBattleAndRender(battle => {
      const creature = this.getSelectedCreature(battle);
      if (!creature || !creature.sections?.[sectionId]) return false;
      const result = CreatureDamageEngine.applyDamage(creature, Math.max(0, Number(amount ?? 0)), { sectionId });
      if (!result.ok) {
        ui.notifications.warn(result.text ?? "Не удалось применить урон.");
        return false;
      }
      this.app._addLog(battle, `Ручной урон. ${result.text}`);
    }, { reason: `creature-manual-damage-${sectionId}` });
  }

  async recover(mode) {
    await this.app._updateBattleAndRender(battle => {
      const creature = this.getSelectedCreature(battle);
      if (!this.app._requireActivePhase(battle, creature, "crew", "Восстановление существа")) return false;
      const key = `creatureRecover:${mode}`;
      if (!this.app._markTurnAction(battle, creature, key)) {
        ui.notifications.warn(`${creature.name} уже использовал это восстановление или исчерпал ОД.`);
        return false;
      }
      const result = CreatureDamageEngine.recover(creature, mode);
      if (!result.ok) {
        this.app._refundTurnAction(battle, creature, key);
        ui.notifications.warn(result.text ?? "Восстановление не требуется.");
        return false;
      }
      this.app._addLog(battle, result.text);
      const remaining = this.app._getRemainingAP(battle, creature, "crew");
      if (remaining > 0) this.app._addLog(battle, `${creature.name}: осталось ОД восстановления ${remaining}.`);
      else {
        this.app._completeShipActivation(battle, creature, "crew");
        const next = this.app._getActiveShip(battle);
        if (next) {
          this.app.selectedShipId = next.id;
          this.app._addLog(battle, `Ход боевой единицы: ${next.name}.`);
        } else this.app._addLog(battle, "Все боевые единицы завершили фазу. Можно перейти дальше.");
      }
    }, { reason: `creature-recover-${mode}` });
  }
}
