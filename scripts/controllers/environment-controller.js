import { SEA_STATE_SEQUENCE, VISIBILITY_SEQUENCE, WIND_STRENGTH_LABELS, WIND_STRENGTH_RATINGS, WIND_STRENGTH_SEQUENCE } from "../utils/constants.js";
import { WindEngine } from "../engine/wind-engine.js";

export class EnvironmentController {
  constructor(app) {
    this.app = app;
  }

  cycleValue(sequence, current) {
    const index = sequence.indexOf(current);
    return sequence[(index + 1 + sequence.length) % sequence.length];
  }

  syncFleetToWind(battle) {
    for (const ship of battle.ships ?? []) WindEngine.syncInIronsFlag(ship, battle.wind ?? {});
  }

  async rotateWind(delta) {
    if (!game.user.isGM) return ui.notifications.warn("Ветер пока меняет ГМ.");
    await this.app._updateBattleAndRender(battle => {
      battle.wind = WindEngine.rotate(battle.wind, delta);
      this.syncFleetToWind(battle);
      this.app._addLog(battle, `Ветер меняется: ${battle.wind.direction}°.`);
    }, { reason: "rotate-wind" });
  }

  async cycleWindStrength() {
    if (!game.user.isGM) return ui.notifications.warn("Параметры боя меняет ГМ.");
    await this.app._updateBattleAndRender(battle => {
      battle.wind.strength = this.cycleValue(WIND_STRENGTH_SEQUENCE, battle.wind.strength);
      this.syncFleetToWind(battle);
      const label = WIND_STRENGTH_LABELS[battle.wind.strength] ?? battle.wind.strength;
      const rating = WIND_STRENGTH_RATINGS[battle.wind.strength] ?? "?";
      this.app._addLog(battle, `Сила ветра: Б${rating} (${label}).`);
    }, { reason: "cycle-wind-strength" });
  }

  async cycleSea() {
    if (!game.user.isGM) return ui.notifications.warn("Параметры боя меняет ГМ.");
    await this.app._updateBattleAndRender(battle => {
      battle.sea.state = this.cycleValue(SEA_STATE_SEQUENCE, battle.sea.state);
      this.app._addLog(battle, `Состояние моря: ${battle.sea.state}.`);
    }, { reason: "cycle-sea" });
  }

  async cycleVisibility() {
    if (!game.user.isGM) return ui.notifications.warn("Параметры боя меняет ГМ.");
    await this.app._updateBattleAndRender(battle => {
      battle.sea.visibility = this.cycleValue(VISIBILITY_SEQUENCE, battle.sea.visibility);
      this.app._addLog(battle, `Видимость: ${battle.sea.visibility}.`);
    }, { reason: "cycle-visibility" });
  }
}
