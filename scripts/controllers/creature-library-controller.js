import { ImportValidationService } from "../services/import-validation-service.js";
import { CreatureLibraryService } from "../services/creature-library-service.js";
import { DialogService } from "../services/dialog-service.js";

export class CreatureLibraryController {
  constructor(app) {
    this.app = app;
  }

  async saveSelectedCreatureToLibrary() {
    if (!this.app._assertGm()) return;
    const battle = this.app.battle;
    const creature = this.app.getSelectedShip(battle);
    if (!creature || creature.unitType !== "creature") return ui.notifications.warn("Летающее существо не выбрано.");
    const input = this.app.element.querySelector("[data-creature-library-name]");
    const name = String(input?.value ?? creature.name ?? "Шаблон существа").trim() || creature.name || "Шаблон существа";
    try {
      const entry = await CreatureLibraryService.saveTemplate(name, creature);
      ui.notifications.info(`Существо сохранено в бестиарий: ${entry.name}.`);
      this.app.activeTab = "creatureLibrary";
      this.app.render({ force: true });
    } catch (error) {
      console.error(error);
      ui.notifications.error(error.message ?? "Не удалось сохранить существо в бестиарий.");
    }
  }

  async addCreatureFromLibrary(libraryId = null) {
    if (!this.app._assertSetup("Добавление существа из бестиария")) return;
    const library = CreatureLibraryService.getLibrary();
    if (!library.length) return ui.notifications.warn("Бестиарий пуст.");
    const entry = libraryId ? library.find(item => item.id === libraryId) : library.at(-1);
    if (!entry) return ui.notifications.warn("Шаблон существа не найден.");
    await this.app._updateBattleAndRender(battle => {
      const side = this.app.getActiveSideId(battle);
      const creature = CreatureLibraryService.cloneCreatureForBattle(entry.creature, battle, { side });
      battle.ships.push(creature);
      this.app.selectedShipId = creature.id;
      this.app.activeTab = "editor";
      this.app._addLog(battle, `Бестиарий: в бой добавлено существо ${creature.name}.`);
    }, { reason: "bestiary-add-library-creature" });
  }

  async deleteCreatureFromLibrary(libraryId = null) {
    if (!this.app._assertGm()) return;
    if (!libraryId) return ui.notifications.warn("Шаблон существа не выбран.");
    const removed = await CreatureLibraryService.deleteTemplate(libraryId);
    if (!removed) return ui.notifications.warn("Шаблон существа не найден.");
    ui.notifications.info(`Удален шаблон существа: ${removed.name}.`);
    this.app.render({ force: true });
  }

  async exportSelectedCreature() {
    const creature = this.app.getSelectedShip(this.app.battle);
    if (!creature || creature.unitType !== "creature") return ui.notifications.warn("Летающее существо не выбрано.");
    const clean = CreatureLibraryService.cleanCreatureForLibrary(creature);
    await DialogService.copyOrShow({
      title: "Экспорт существа",
      label: "JSON существа",
      text: JSON.stringify(clean, null, 2),
      copiedMessage: "JSON существа скопирован в буфер обмена."
    });
  }

  async importCreatureFromPrompt() {
    if (!this.app._assertSetup("Импорт существа")) return;
    const raw = await DialogService.multiline({ title: "Импорт существа", label: "Вставьте JSON существа", okLabel: "Импортировать", required: true });
    if (!raw) return;
    let source;
    try {
      const parsed = ImportValidationService.parseJson(raw, "Существо");
      source = parsed?.creature ?? parsed;
      ImportValidationService.validateCreature(source);
      const warning = ImportValidationService.getSchemaWarning(source, { label: "Существо" });
      if (warning) ui.notifications.warn(warning);
    } catch (error) {
      console.error(error);
      return ui.notifications.error(error.message ?? "Не удалось импортировать существо.");
    }
    await this.app._updateBattleAndRender(battle => {
      const side = this.app.getActiveSideId(battle);
      const creature = CreatureLibraryService.cloneCreatureForBattle(source, battle, { side });
      battle.ships.push(creature);
      this.app.selectedShipId = creature.id;
      this.app.activeTab = "editor";
      this.app._addLog(battle, `Бестиарий: импортировано существо ${creature.name}.`);
    }, { reason: "bestiary-import-creature" });
  }
}
