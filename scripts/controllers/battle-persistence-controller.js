import { ImportValidationService } from "../services/import-validation-service.js";
import { DialogService } from "../services/dialog-service.js";

export class BattlePersistenceController {
  constructor(app) {
    this.app = app;
  }

  async saveSnapshot() {
    if (!game.user.isGM) return ui.notifications.warn("Сохранение боя доступно только ГМу.");
    const battle = game.sailshipsCombat.storage.getBattle();
    const fallback = `${battle.name} R${battle.round}`;
    const name = await DialogService.text({ title: "Сохранение боя", label: "Название сохранения", value: fallback, okLabel: "Сохранить" });
    if (name === null) return;
    const entry = await game.sailshipsCombat.storage.saveSnapshot(name.trim() || fallback);
    await this.app._updateBattleAndRender(nextBattle => {
      this.app._addLog(nextBattle, `Сохранение боя создано: ${entry.name}.`);
    }, { reason: "save-battle-snapshot-log" });
  }

  async loadSnapshot() {
    if (!game.user.isGM) return ui.notifications.warn("Загрузка боя доступна только ГМу.");
    const saved = game.sailshipsCombat.storage.getSavedBattles?.() ?? [];
    if (!saved.length) return ui.notifications.warn("Нет сохраненных боев.");
    const id = await DialogService.select({
      title: "Загрузка боя",
      label: "Сохранение",
      choices: saved.map(entry => ({ value: entry.id, label: `${entry.name} (${new Date(entry.saved).toLocaleString()})` })),
      value: saved.at(-1)?.id,
      okLabel: "Загрузить"
    });
    if (id === null) return;
    const loaded = await game.sailshipsCombat.storage.loadSnapshot(id);
    if (!loaded) return ui.notifications.warn("Сохранение не найдено.");
    this.app.selectedShipId = loaded.battle.ships[0]?.id ?? null;
    this.app.selectedTargetId = null;
    this.app.aimSection = null;
    ui.notifications.info(`Загружен бой: ${loaded.entry.name}.`);
    this.app.renderBattleState();
  }

  async deleteSnapshot() {
    if (!game.user.isGM) return ui.notifications.warn("Удаление сохранения доступно только ГМу.");
    const saved = game.sailshipsCombat.storage.getSavedBattles?.() ?? [];
    if (!saved.length) return ui.notifications.warn("Нет сохраненных боев.");
    const id = await DialogService.select({
      title: "Удаление сохранения",
      label: "Сохранение",
      choices: saved.map(entry => ({ value: entry.id, label: `${entry.name} (${new Date(entry.saved).toLocaleString()})` })),
      value: saved.at(-1)?.id,
      okLabel: "Удалить"
    });
    if (id === null) return;
    const confirmed = await DialogService.confirm({ title: "Удаление сохранения", content: "Удалить выбранное сохранение боя?", yesLabel: "Удалить", danger: true });
    if (!confirmed) return;
    const removed = await game.sailshipsCombat.storage.deleteSnapshot(id);
    if (!removed) return ui.notifications.warn("Сохранение не найдено.");
    ui.notifications.info(`Удалено сохранение: ${removed.name}.`);
    this.app.renderBattleState();
  }

  async exportBattle() {
    const battle = foundry.utils.deepClone(this.app.battle);
    delete battle.lastMovement;
    delete battle.lastAudioEvent;
    const json = JSON.stringify(battle, null, 2);
    await DialogService.copyOrShow({ title: "Экспорт боя", label: "JSON боя", text: json, copiedMessage: "JSON боя скопирован в буфер обмена." });
  }

  async importBattle() {
    if (!game.user.isGM) return ui.notifications.warn("Импорт боя доступен только ГМу.");
    const raw = await DialogService.multiline({ title: "Импорт боя", label: "Вставьте JSON боя", okLabel: "Импортировать", required: true });
    if (!raw) return;
    let battle;
    let schemaWarning = null;
    try {
      battle = ImportValidationService.parseJson(raw, "Бой");
      ImportValidationService.validateBattle(battle);
      schemaWarning = ImportValidationService.getSchemaWarning(battle, { label: "Бой" });
    } catch (err) {
      console.error(err);
      return ui.notifications.error(err.message ?? "Не удалось импортировать бой.");
    }
    if (schemaWarning) ui.notifications.warn(schemaWarning);
    battle = game.sailshipsCombat.storage.normalizeBattle(battle);
    delete battle.lastMovement;
    delete battle.lastAudioEvent;
    this.app.selectedShipId = battle.ships[0]?.id ?? null;
    this.app.selectedTargetId = null;
    this.app.aimSection = null;
    this.app._addLog(battle, "Бой импортирован из JSON.");
    await this.app._saveAndRender(battle);
  }

  async clearLog() {
    if (!game.user.isGM) return ui.notifications.warn("Журнал очищает ГМ.");
    await this.app._updateBattleAndRender(battle => {
      battle.log = [];
      this.app._addLog(battle, "Журнал боя очищен.");
    }, { reason: "clear-battle-log" });
  }
}
