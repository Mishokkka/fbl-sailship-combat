import { WorkbenchController } from "../controllers/workbench-controller.js";
import { ShipyardContextBuilder } from "../context/shipyard-context-builder.js";
import { ShipEditorController } from "../controllers/ship-editor-controller.js";
import { ShipyardBattleController } from "../controllers/shipyard-battle-controller.js";
import { ShipyardLibraryController } from "../controllers/shipyard-library-controller.js";
import { CreatureLibraryController } from "../controllers/creature-library-controller.js";
import { CreatureEditorActions } from "../controllers/creature-editor-actions.js";
import { uid } from "../utils/random.js";
import { BattleScenarioService } from "../services/battle-scenario-service.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TAB_IDS = new Set(["battle", "templates", "bestiary", "library", "creatureLibrary", "editor"]);

function getActionTarget(event, target = null) {
  return target ?? event?.target?.closest?.("[data-action]") ?? event?.currentTarget ?? null;
}

export class ShipyardApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.selectedShipId = options.selectedShipId ?? null;
    this.activeSideId = options.activeSideId ?? null;
    this.activeTab = options.activeTab ?? "battle";
    this.battleController = new ShipyardBattleController(this);
    this.libraryController = new ShipyardLibraryController(this);
    this.creatureLibraryController = new CreatureLibraryController(this);
    this.creatureEditorActions = new CreatureEditorActions(this);
    this._needsMainRefresh = false;
    this.workbench = new WorkbenchController(this, (group, id) => { if (group === "yard") this.activeTab = id; });
  }

  static DEFAULT_OPTIONS = {
    id: "sailships-combat-shipyard-app",
    classes: ["sailships-combat", "sailships-shipyard-app"],
    tag: "section",
    window: {
      title: "SAILSHIPS.ShipyardTitle",
      icon: "fa-solid fa-warehouse",
      resizable: true
    },
    position: {
      width: 1220,
      height: 860
    },
    actions: {
      switchShipyardTab: this._onSwitchShipyardTab,
      addTemplateShip: this._onAddTemplateShip,
      addTemplateCreature: this._onAddTemplateCreature,
      duplicateShip: this._onDuplicateShip,
      removeShip: this._onRemoveShip,
      toggleSide: this._onToggleSide,
      addBattleSide: this._onAddBattleSide,
      setActiveSide: this._onSetActiveSide,
      openBattleSetup: this._onOpenBattleSetup,
      openBattle: this._onOpenBattle,
      applyShipEdits: this._onApplyShipEdits,
      applyCreatureEdits: CreatureEditorActions.applyEdits,
      resetSelectedShip: this._onResetSelectedShip,
      strikeShip: this._onStrikeShip,
      unstrikeShip: this._onUnstrikeShip,
      saveShipToLibrary: this._onSaveShipToLibrary,
      addShipFromLibrary: this._onAddShipFromLibrary,
      deleteShipFromLibrary: this._onDeleteShipFromLibrary,
      exportShip: this._onExportShip,
      importShip: this._onImportShip,
      saveCreatureToLibrary: this._onSaveCreatureToLibrary,
      addCreatureFromLibrary: this._onAddCreatureFromLibrary,
      deleteCreatureFromLibrary: this._onDeleteCreatureFromLibrary,
      exportCreature: this._onExportCreature,
      importCreature: this._onImportCreature,
      addCreatureSection: CreatureEditorActions.addSection,
      removeCreatureSection: CreatureEditorActions.removeSection,
      addCreatureAttack: CreatureEditorActions.addAttack,
      removeCreatureAttack: CreatureEditorActions.removeAttack,
      addCreatureAbility: CreatureEditorActions.addAbility,
      removeCreatureAbility: CreatureEditorActions.removeAbility,
      chooseCreatureToken: CreatureEditorActions.chooseToken,
      refreshShipyard: this._onRefreshShipyard
    }
  };

  static PARTS = {
    main: {
      template: "modules/sailships-combat/templates/shipyard-app.hbs"
    }
  };

  get title() {
    return game.i18n.localize("SAILSHIPS.ShipyardTitle");
  }

  get battle() {
    return game.sailshipsCombat.storage.getBattle();
  }

  getSelectedShip(battle = this.battle) {
    const ships = battle.ships ?? [];
    if (this.selectedShipId != null) return ships.find(ship => ship.id === this.selectedShipId) ?? null;
    return ships[0] ?? null;
  }

  getActiveSideId(battle = this.battle) {
    const sideIds = BattleScenarioService.getSideIds(battle);
    if (sideIds.includes(this.activeSideId)) return this.activeSideId;
    const selectedSide = this.getSelectedShip(battle)?.side;
    this.activeSideId = sideIds.includes(selectedSide) ? selectedSide : sideIds[0] ?? null;
    return this.activeSideId;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const battle = this.battle;
    const selectedShip = this.getSelectedShip(battle);
    const resolvedShipId = selectedShip?.id ?? null;
    if (this.selectedShipId == null && resolvedShipId != null) this.selectedShipId = resolvedShipId;
    if (!TAB_IDS.has(this.activeTab)) this.activeTab = "battle";

    const activeSideId = this.getActiveSideId(battle);
    return ShipyardContextBuilder.build({
      baseContext: context,
      battle,
      selectedShip,
      activeSideId,
      activeTab: this.activeTab,
      tabIds: TAB_IDS
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.workbench.bind();
    this.element.querySelectorAll(".ssc-yard-ship-row[data-ship-id]").forEach(node => {
      node.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        this._selectShip(event.currentTarget.dataset.shipId, { render: true });
      });
    });

    // ApplicationV2 actions are click-oriented. Native select controls need an
    // explicit change listener, otherwise changing a team appears to do nothing.
    this.element.querySelectorAll('[data-shipyard-side-select="selected"]').forEach(select => {
      select.addEventListener("change", async event => {
        event.preventDefault();
        if (event.currentTarget.disabled) return;
        await this.battleController.setSelectedShipSide(event.currentTarget.value);
      });
    });
    this.element.querySelectorAll('[data-shipyard-side-select="active"]').forEach(select => {
      select.addEventListener("change", event => {
        event.preventDefault();
        this.activeSideId = event.currentTarget.value;
        this.render({ force: true });
      });
    });
  }

  _selectShip(shipId, { render = false } = {}) {
    if (!shipId) return;
    this.selectedShipId = shipId;
    const selected = this.getSelectedShip(this.battle);
    if (selected?.side) this.activeSideId = selected.side;
    if (game.sailshipsCombat.app) {
      game.sailshipsCombat.app.selectedShipId = shipId;
      game.sailshipsCombat.app.selectedTargetId = null;
      this._needsMainRefresh = true;
    }
    if (render) this.render({ force: true });
  }

  _addLog(battle, text) {
    battle.log ??= [];
    battle.log.push({
      id: uid("log"),
      round: battle.round,
      phase: battle.phase,
      text,
      ts: new Date().toISOString()
    });
    if (battle.log.length > 200) battle.log.splice(0, battle.log.length - 200);
  }

  async _updateBattleAndRender(mutator, options = {}) {
    let applied = false;
    const battle = await game.sailshipsCombat.storage.updateBattle(async current => {
      const result = await mutator(current);
      applied = result !== false;
      return result;
    }, { reason: options.reason ?? "" });
    if (applied && (options.reason === "shipyard-apply-edits" || /^bestiary-(apply-edits|add-section|remove-section|add-attack|remove-attack|add-ability|remove-ability)$/.test(options.reason ?? ""))) this.workbench.accept();
    const main = game.sailshipsCombat.app;
    if (main) {
      main.selectedShipId = this.selectedShipId;
      main.selectedTargetId = null;
      main.aimSection = null;
      main.renderBattleSnapshot = null;
      main.contextBuilder?.invalidate?.();
    }
    this._needsMainRefresh = true;
    this.render({ force: true });
    return battle;
  }

  _assertGm() {
    if (game.user.isGM) return true;
    ui.notifications.warn("Верфь доступна только ГМу.");
    return false;
  }

  _assertSetup(label = "Редактирование кораблей") {
    if (!this._assertGm()) return false;
    if (!this.battle.setupConfirmed) return true;
    ui.notifications.warn(`${label}: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.`);
    return false;
  }

  static async _onSwitchShipyardTab(event, target) {
    event.preventDefault();
    const tab = getActionTarget(event, target)?.dataset?.tab;
    if (!TAB_IDS.has(tab)) return;
    this.activeTab = tab;
    this.workbench.show(this.element.querySelector('[data-workspace="yard"]'), tab);
  }
  static async _onRefreshShipyard(event) {
    event.preventDefault();
    this.render({ force: true });
  }
  static async _onAddTemplateShip(event, target) {
    event.preventDefault();
    const template = getActionTarget(event, target)?.dataset?.template ?? "frigate";
    await this.battleController.addTemplateShip(template);
  }

  static async _onAddTemplateCreature(event, target) {
    event.preventDefault();
    const template = getActionTarget(event, target)?.dataset?.template ?? "skyRay";
    await this.battleController.addTemplateCreature(template);
  }

  static async _onDuplicateShip(event) {
    event.preventDefault();
    await this.battleController.duplicateSelectedShip();
  }

  static async _onRemoveShip(event) {
    event.preventDefault();
    await this.battleController.removeSelectedShip();
  }

  static async _onToggleSide(event) {
    event.preventDefault();
    await this.battleController.toggleSelectedShipSide();
  }

  static async _onAddBattleSide(event) {
    event.preventDefault();
    await this.battleController.addSide();
  }

  static async _onSetActiveSide(event, target) {
    event.preventDefault();
    const sideId = getActionTarget(event, target)?.dataset?.side;
    if (!sideId) return;
    this.activeSideId = sideId;
    this.render({ force: true });
  }

  static _onOpenBattle(event) {
    event.preventDefault();
    game.sailshipsCombat?.open?.();
  }

  static async _onOpenBattleSetup(event) {
    event.preventDefault();
    game.sailshipsCombat?.openBattleSetup?.();
  }


  static async _onSaveShipToLibrary(event) {
    event.preventDefault();
    await this.libraryController.saveSelectedShipToLibrary();
  }

  static async _onAddShipFromLibrary(event, target) {
    event.preventDefault();
    const libraryId = getActionTarget(event, target)?.dataset?.libraryId ?? null;
    await this.libraryController.addShipFromLibrary(libraryId);
  }

  static async _onDeleteShipFromLibrary(event, target) {
    event.preventDefault();
    const libraryId = getActionTarget(event, target)?.dataset?.libraryId ?? null;
    await this.libraryController.deleteShipFromLibrary(libraryId);
  }

  static async _onExportShip(event) {
    event.preventDefault();
    await this.libraryController.exportSelectedShip();
  }

  static async _onImportShip(event) {
    event.preventDefault();
    await this.libraryController.importShipFromPrompt();
  }

  static async _onSaveCreatureToLibrary(event) {
    event.preventDefault();
    await this.creatureLibraryController.saveSelectedCreatureToLibrary();
  }

  static async _onAddCreatureFromLibrary(event, target) {
    event.preventDefault();
    await this.creatureLibraryController.addCreatureFromLibrary(getActionTarget(event, target)?.dataset?.libraryId ?? null);
  }

  static async _onDeleteCreatureFromLibrary(event, target) {
    event.preventDefault();
    await this.creatureLibraryController.deleteCreatureFromLibrary(getActionTarget(event, target)?.dataset?.libraryId ?? null);
  }

  static async _onExportCreature(event) {
    event.preventDefault();
    await this.creatureLibraryController.exportSelectedCreature();
  }

  static async _onImportCreature(event) {
    event.preventDefault();
    await this.creatureLibraryController.importCreatureFromPrompt();
  }

  static async _onApplyShipEdits(event) {
    event.preventDefault();
    if (!this._assertSetup("Редактор корабля")) return;
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Редактор корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const ship = this.getSelectedShip(battle);
      if (!ship || ship.unitType === "creature") return false;
      const result = new ShipEditorController(this.element).applyEdits(ship);
      this._addLog(battle, `Верфь: ${result.oldName}: параметры корабля, секций, систем и батарей обновлены${result.renamed ? `, новое имя ${result.newName}` : ""}.`);
    }, { reason: "shipyard-apply-edits" });
  }

  static async _onResetSelectedShip(event) {
    event.preventDefault();
    if (!this._assertSetup("Сброс корабля")) return;
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Сброс корабля: бой уже подтвержден. Нажмите «К подготовке» в окне боя, чтобы менять корабли.");
        return false;
      }
      const ship = this.getSelectedShip(battle);
      if (!ship) return false;
      if (ship.unitType === "creature") {
        this.creatureEditorActions.resetCombatState(ship);
        this._addLog(battle, `Бестиарий: ${ship.name}: состояние существа восстановлено.`);
      } else {
        new ShipEditorController(this.element).resetCombatState(ship);
        this._addLog(battle, `Верфь: ${ship.name}: корабль восстановлен до боевого состояния.`);
      }
    }, { reason: "shipyard-reset-ship" });
  }

  static async _onStrikeShip(event) {
    event.preventDefault();
    await this.battleController.strikeSelectedShip();
  }

  static async _onUnstrikeShip(event) {
    event.preventDefault();
    await this.battleController.unstrikeSelectedShip();
  }

  _onClose(options) {
    this.workbench.destroy();
    if (this._needsMainRefresh) game.sailshipsCombat.app?.onExternalBattleUpdate?.();
    if (game.sailshipsCombat?.shipyardApp === this) game.sailshipsCombat.shipyardApp = null;
    if (super._onClose) super._onClose(options);
  }

  onExternalBattleUpdate() {
    this.render({ force: true });
  }
}
