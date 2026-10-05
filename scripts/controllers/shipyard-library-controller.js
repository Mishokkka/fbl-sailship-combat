import { ImportValidationService } from "../services/import-validation-service.js";
import { ShipLibraryService } from "../services/ship-library-service.js";
import { DialogService } from "../services/dialog-service.js";

export class ShipyardLibraryController {
  constructor(app) {
    this.app = app;
  }

  async saveSelectedShipToLibrary() {
    if (!this.app._assertGm()) return;
    const battle = this.app.battle;
    const ship = this.app.getSelectedShip(battle);
    if (!ship) return ui.notifications.warn("Корабль не выбран.");
    const shipId = ship.id;
    const input = this.app.element.querySelector("[data-library-name]");
    const name = String(input?.value ?? ship.name ?? "Шаблон корабля").trim() || ship.name || "Шаблон корабля";
    try {
      const entry = await ShipLibraryService.saveTemplate(name, ship);
      await this.app._updateBattleAndRender(nextBattle => {
        const nextShip = nextBattle.ships.find(candidate => candidate.id === shipId);
        if (!nextShip) return false;
        this.app._addLog(nextBattle, `${nextShip.name}: сохранен в библиотеку кораблей как «${entry.name}».`);
      }, { reason: "shipyard-save-ship-library" });
      ui.notifications.info(`Корабль сохранен в библиотеку: ${entry.name}.`);
      this.app.activeTab = "library";
      this.app.render({ force: true });
    } catch (err) {
      console.error(err);
      ui.notifications.error("Не удалось сохранить корабль в библиотеку. Подробности в консоли.");
    }
  }

  async addShipFromLibrary(libraryId = null) {
    if (!this.app._assertSetup("Добавление корабля из библиотеки")) return;
    const library = ShipLibraryService.getLibrary();
    if (!library.length) return ui.notifications.warn("Библиотека кораблей пуста.");
    const entry = libraryId ? library.find(item => item.id === libraryId) : library.at(-1);
    if (!entry) return ui.notifications.warn("Шаблон не найден.");
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Добавление корабля из библиотеки: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const side = this.app.getActiveSideId(battle);
      const ship = ShipLibraryService.cloneShipForBattle(entry.ship, battle, { side });
      ship.name = `${entry.ship?.name ?? entry.name}`;
      battle.ships.push(ship);
      this.app.selectedShipId = ship.id;
      this.app.activeTab = "editor";
      this.app._addLog(battle, `Верфь: из библиотеки добавлен корабль ${ship.name}.`);
    }, { reason: "shipyard-add-library-ship" });
  }

  async deleteShipFromLibrary(libraryId = null) {
    if (!this.app._assertGm()) return;
    if (!libraryId) return ui.notifications.warn("Шаблон для удаления не выбран.");
    const removed = await ShipLibraryService.deleteTemplate(libraryId);
    if (!removed) return ui.notifications.warn("Шаблон не найден.");
    ui.notifications.info(`Удален шаблон корабля: ${removed.name}.`);
    this.app.render({ force: true });
  }

  async exportSelectedShip() {
    const ship = this.app.getSelectedShip(this.app.battle);
    if (!ship) return ui.notifications.warn("Корабль не выбран.");
    const clean = ShipLibraryService.cleanShipForLibrary(ship);
    const json = JSON.stringify(clean, null, 2);
    await DialogService.copyOrShow({ title: "Экспорт корабля", label: "JSON корабля", text: json, copiedMessage: "JSON корабля скопирован в буфер обмена." });
  }

  async importShipFromPrompt() {
    if (!this.app._assertSetup("Импорт корабля")) return;
    const raw = await DialogService.multiline({ title: "Импорт корабля", label: "Вставьте JSON корабля", okLabel: "Импортировать", required: true });
    if (!raw) return;
    let parsed;
    let schemaWarning = null;
    try {
      parsed = ImportValidationService.parseJson(raw, "Корабль");
      const source = parsed?.ship ?? parsed;
      ImportValidationService.validateShip(source);
      schemaWarning = ImportValidationService.getSchemaWarning(source, { label: "Корабль" });
    } catch (err) {
      console.error(err);
      return ui.notifications.error(err.message ?? "Не удалось импортировать корабль.");
    }
    if (schemaWarning) ui.notifications.warn(schemaWarning);
    const source = parsed?.ship ?? parsed;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Импорт корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const side = this.app.getActiveSideId(battle);
      const ship = ShipLibraryService.cloneShipForBattle(source, battle, { side });
      battle.ships.push(ship);
      this.app.selectedShipId = ship.id;
      this.app.activeTab = "editor";
      this.app._addLog(battle, `Верфь: импортирован корабль ${ship.name}.`);
    }, { reason: "shipyard-import-ship" });
  }
}
