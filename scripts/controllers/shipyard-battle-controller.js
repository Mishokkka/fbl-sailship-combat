import { ShipLibraryService } from "../services/ship-library-service.js";
import { ShipTemplateService } from "../services/ship-template-service.js";
import { BattleScenarioService } from "../services/battle-scenario-service.js";
import { CreatureTemplateService } from "../services/creature-template-service.js";
import { CreatureLibraryService } from "../services/creature-library-service.js";

export class ShipyardBattleController {
  constructor(app) {
    this.app = app;
  }

  async addTemplateShip(template) {
    if (!this.app._assertSetup("Добавление корабля")) return;
    if (!ShipTemplateService.hasTemplate(template)) return ui.notifications.warn("Неизвестный шаблон корабля.");
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Добавление корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const side = this.app.getActiveSideId(battle);
      const ship = ShipTemplateService.createShipFromTemplate(template, { battle, side });
      if (!ship) {
        ui.notifications.warn("Не удалось создать корабль из шаблона.");
        return false;
      }
      const label = ShipTemplateService.getTemplate(template)?.label ?? "Корабль";
      battle.ships.push(ship);
      this.app.selectedShipId = ship.id;
      this.app.activeTab = "editor";
      this.app._addLog(battle, `Верфь: добавлен корабль из шаблона «${label}»: ${ship.name}.`);
    }, { reason: "shipyard-add-template" });
  }

  async addTemplateCreature(template) {
    if (!this.app._assertSetup("Добавление существа")) return;
    if (!CreatureTemplateService.hasTemplate(template)) return ui.notifications.warn("Неизвестный шаблон существа.");
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) return false;
      const side = this.app.getActiveSideId(battle);
      const creature = CreatureTemplateService.createCreatureFromTemplate(template, { battle, side });
      if (!creature) {
        ui.notifications.warn("Не удалось создать существо из шаблона.");
        return false;
      }
      battle.ships.push(creature);
      this.app.selectedShipId = creature.id;
      this.app.activeTab = "editor";
      this.app._addLog(battle, `Бестиарий: добавлено существо из шаблона «${creature.name}».`);
    }, { reason: "bestiary-add-template" });
  }

  async addSide() {
    if (!this.app._assertSetup("Добавление команды")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) return false;
      const side = BattleScenarioService.addSide(battle);
      this.app.activeSideId = side.id;
      this.app.activeTab = "battle";
      this.app._addLog(battle, `Верфь: добавлена команда ${side.name}.`);
    }, { reason: "shipyard-add-side" });
  }

  async duplicateSelectedShip() {
    if (!this.app._assertSetup("Дублирование корабля")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Дублирование корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const ship = this.app.getSelectedShip(battle);
      if (!ship) {
        ui.notifications.warn("Боевая единица не выбрана.");
        return false;
      }
      const clone = ship.unitType === "creature"
        ? CreatureLibraryService.cloneCreatureForBattle(ship, battle)
        : ShipLibraryService.cloneShipForBattle(ship, battle);
      clone.name = `${ship.name} II`;
      clone.side = ship.side;
      clone.x = Math.min(Number(battle.board.width ?? 24) - 1, Number(ship.x ?? 0) + 1);
      clone.y = Math.min(Number(battle.board.height ?? 16) - 1, Number(ship.y ?? 0) + 1);
      battle.ships.push(clone);
      this.app.selectedShipId = clone.id;
      this.app._addLog(battle, `Редактор: создан дубликат ${ship.unitType === "creature" ? "существа" : "корабля"} ${ship.name}.`);
    }, { reason: "shipyard-duplicate-ship" });
  }

  async removeSelectedShip() {
    if (!this.app._assertSetup("Удаление корабля")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Удаление корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const ship = this.app.getSelectedShip(battle);
      if (!ship || battle.ships.length <= 1) {
        ui.notifications.warn("Нельзя удалить последнюю боевую единицу или единица не выбрана.");
        return false;
      }
      for (const other of battle.ships) {
        if (other.flags?.grappledWith === ship.id) delete other.flags.grappledWith;
      }
      battle.ships = battle.ships.filter(s => s.id !== ship.id);
      this.app.selectedShipId = battle.ships[0]?.id ?? null;
      this.app._addLog(battle, `Редактор: боевая единица убрана из боя: ${ship.name}.`);
    }, { reason: "shipyard-remove-ship" });
  }

  async toggleSelectedShipSide() {
    if (!this.app._assertSetup("Смена стороны")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Смена стороны: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      const side = BattleScenarioService.cycleShipSide(battle, ship);
      this.app.activeSideId = ship.side;
      this.app._addLog(battle, `Верфь: ${ship.name} переведен на сторону ${side?.name ?? ship.side}.`);
    }, { reason: "shipyard-toggle-side" });
  }


  async setSelectedShipSide(sideId) {
    if (!this.app._assertSetup("Смена команды")) return;
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!ship || !battle.setup?.sides?.[sideId]) return false;
      ship.side = sideId;
      const sideOffset = Math.max(0, (battle.ships ?? []).filter(unit => unit.id !== ship.id && unit.side === sideId).length);
      const spawn = BattleScenarioService.getSideSpawnPoint(battle, sideId, sideOffset);
      ship.x = spawn.x;
      ship.y = spawn.y;
      ship.heading = spawn.heading ?? ship.heading;
      this.app.activeSideId = sideId;
      this.app._addLog(battle, `Верфь: ${ship.name} переведен в команду ${BattleScenarioService.getSideName(battle, sideId)} и перемещен в её зону расстановки.`);
    }, { reason: "shipyard-set-side" });
  }

  async strikeSelectedShip() {
    if (!this.app._assertSetup("Вывод корабля")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Вывод корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      ship.flags ??= {};
      ship.flags.struck = true;
      this.app._addLog(battle, `Верфь: ${ship.name}: выведен из боя.`);
    }, { reason: "shipyard-strike-ship" });
  }

  async unstrikeSelectedShip() {
    if (!this.app._assertSetup("Возврат корабля")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Возврат корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      ship.flags ??= {};
      ship.flags.struck = false;
      this.app._addLog(battle, `Верфь: ${ship.name}: возвращен в бой.`);
    }, { reason: "shipyard-unstrike-ship" });
  }
}
