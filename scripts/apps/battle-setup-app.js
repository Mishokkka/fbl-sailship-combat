import { BattleScenarioService } from "../services/battle-scenario-service.js";
import { BattleSetupPreviewBuilder } from "../context/battle-setup-preview-builder.js";
import { ImportValidationService } from "../services/import-validation-service.js";
import { DialogService } from "../services/dialog-service.js";
import { VictoryEngine } from "../engine/victory-engine.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function getActionTarget(event, target = null) {
  return target ?? event?.target?.closest?.("[data-action]") ?? event?.currentTarget ?? null;
}

function formValues(root) {
  const values = {};
  root?.querySelectorAll?.("[data-setup-field]").forEach(input => {
    values[input.dataset.setupField] = input.type === "checkbox" ? input.checked : input.value;
  });
  return values;
}

export class BattleSetupApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.selectedBoardPreset = options.boardPreset ?? "skirmish";
    this.selectedEnvironmentPreset = options.environmentPreset ?? "clearSea";
    this.selectedScenarioPreset = options.scenarioPreset ?? "openDuel";
    this._dirty = false;
  }

  static DEFAULT_OPTIONS = {
    id: "sailships-combat-setup-app",
    classes: ["sailships-combat", "sailships-battle-setup-app"],
    tag: "section",
    window: {
      title: "SAILSHIPS.BattleSetupTitle",
      icon: "fa-solid fa-compass-drafting",
      resizable: true
    },
    position: {
      width: 1500,
      height: 860
    },
    actions: {
      selectBoardPreset: this._onSelectBoardPreset,
      selectEnvironmentPreset: this._onSelectEnvironmentPreset,
      selectScenarioPreset: this._onSelectScenarioPreset,
      createBlankBattle: this._onCreateBlankBattle,
      applyBoardPreset: this._onApplyBoardPreset,
      applyEnvironmentPreset: this._onApplyEnvironmentPreset,
      applyScenarioPreset: this._onApplyScenarioPreset,
      generateScenarioTerrain: this._onGenerateScenarioTerrain,
      applySideSetup: this._onApplySideSetup,
      addSide: this._onAddSide,
      removeSide: this._onRemoveSide,
      deploySide: this._onDeploySide,
      randomDeploySide: this._onRandomDeploySide,
      saveScenario: this._onSaveScenario,
      loadScenario: this._onLoadScenario,
      deleteScenario: this._onDeleteScenario,
      exportScenario: this._onExportScenario,
      importScenario: this._onImportScenario,
      clearCurrentBattle: this._onClearCurrentBattle,
      openShipyard: this._onOpenShipyard,
      openBattle: this._onOpenBattle
    }
  };

  static PARTS = {
    main: {
      template: "modules/sailships-combat/templates/setup/battle-setup-app.hbs"
    }
  };

  get title() {
    return game.i18n.localize("SAILSHIPS.BattleSetupTitle");
  }

  get battle() {
    return game.sailshipsCombat.storage.getBattle();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const battle = this.battle;
    BattleScenarioService.normalizeSetupZones(battle);
    const sideIds = BattleScenarioService.getSideIds(battle);
    const savedScenarios = BattleScenarioService.getSavedScenarios();
    return foundry.utils.mergeObject(context, {
      isGM: game.user.isGM,
      battle,
      setupLocked: Boolean(battle.setupConfirmed),
      boardPresets: BattleScenarioService.boardPresets().map(preset => ({ ...preset, selected: preset.id === this.selectedBoardPreset })),
      environmentPresets: BattleScenarioService.environmentPresets().map(preset => ({ ...preset, selected: preset.id === this.selectedEnvironmentPreset })),
      scenarioPresets: BattleScenarioService.scenarioPresets().map(preset => ({ ...preset, selected: preset.id === this.selectedScenarioPreset })),
      selectedBoardPreset: this.selectedBoardPreset,
      selectedEnvironmentPreset: this.selectedEnvironmentPreset,
      selectedScenarioPreset: this.selectedScenarioPreset,
      sides: sideIds.map(sideId => {
        const units = (battle.ships ?? []).filter(unit => unit.side === sideId);
        const shipCount = units.filter(unit => unit.unitType !== "creature").length;
        const creatureCount = units.filter(unit => unit.unitType === "creature").length;
        return {
          ...battle.setup.sides[sideId],
          coreTargeting: battle.setup.coreTargeting?.[sideId] !== false,
          heatedShot: battle.setup.heatedShot?.[sideId] === true,
          victoryObjective: battle.setup.victory?.objectiveSideId === sideId,
          unitCount: units.length,
          shipCount,
          creatureCount,
          showRemove: sideIds.length > 2,
          canRemove: sideIds.length > 2 && units.length === 0,
          removeTitle: units.length ? "Сначала переведите участников в другие команды через Верфь" : "Удалить команду"
        };
      }),
      victoryDecisionMarginPercent: Math.round(Number(battle.setup.victory?.decisionMargin ?? 0.15) * 100),
      sideCount: sideIds.length,
      savedScenarios: savedScenarios.map((entry, index) => ({ ...entry, index: index + 1, shipCount: entry.scenario?.ships?.length ?? 0 })),
      savedScenarioCount: savedScenarios.length,
      preview: BattleSetupPreviewBuilder.build(battle),
      canEditSetup: Boolean(game.user.isGM && !battle.setupConfirmed)
    }, { inplace: false });
  }

  _syncPresetSelectionsFromForm() {
    const board = this.element?.querySelector?.('[data-preset-select="board"]')?.value;
    const environment = this.element?.querySelector?.('[data-preset-select="environment"]')?.value;
    const scenario = this.element?.querySelector?.('[data-preset-select="scenario"]')?.value;
    if (board) this.selectedBoardPreset = board;
    if (environment) this.selectedEnvironmentPreset = environment;
    if (scenario) this.selectedScenarioPreset = scenario;
  }

  _onRender(context, options) {
    super._onRender(context, options);
  }

  _markMainStale() {
    const main = game.sailshipsCombat?.app;
    if (!main) return;
    main.renderBattleSnapshot = null;
    main.contextBuilder?.invalidate?.();
  }

  async _saveBattleAndRender(battle) {
    await game.sailshipsCombat.storage.saveBattle(battle);
    this._dirty = true;
    this._markMainStale();
    this.render({ force: true });
  }

  async _updateBattleAndRender(mutator, options = {}) {
    const battle = await game.sailshipsCombat.storage.updateBattle(mutator, { reason: options.reason ?? "" });
    this._dirty = true;
    this._markMainStale();
    this.render({ force: true });
    return battle;
  }

  _assertCanEdit(label = "Подготовка боя") {
    if (!game.user.isGM) {
      ui.notifications.warn(`${label}: доступно только ГМу.`);
      return false;
    }
    if (this.battle.setupConfirmed) {
      ui.notifications.warn(`${label}: бой уже подтвержден. Вернитесь к подготовке в главном окне.`);
      return false;
    }
    return true;
  }

  static async _onSelectBoardPreset(event, target) {
    event.preventDefault();
    this.selectedBoardPreset = getActionTarget(event, target)?.dataset?.preset ?? this.selectedBoardPreset;
    this.render({ force: true });
  }

  static async _onSelectEnvironmentPreset(event, target) {
    event.preventDefault();
    this.selectedEnvironmentPreset = getActionTarget(event, target)?.dataset?.preset ?? this.selectedEnvironmentPreset;
    this.render({ force: true });
  }

  static async _onSelectScenarioPreset(event, target) {
    event.preventDefault();
    const preset = getActionTarget(event, target)?.dataset?.preset ?? this.selectedScenarioPreset;
    this.selectedScenarioPreset = preset;
    const scenario = BattleScenarioService.getScenarioPreset(preset);
    this.selectedBoardPreset = scenario.boardPreset ?? this.selectedBoardPreset;
    this.selectedEnvironmentPreset = scenario.environmentPreset ?? this.selectedEnvironmentPreset;
    this.render({ force: true });
  }

  static async _onCreateBlankBattle(event) {
    event.preventDefault();
    this._syncPresetSelectionsFromForm();
    if (!game.user.isGM) return ui.notifications.warn("Новый бой создает только ГМ.");
    const name = String(this.element.querySelector("[data-setup-name]")?.value ?? "Новый бой").trim() || "Новый бой";
    const confirmed = await DialogService.confirm({
      title: "Новый бой",
      content: "Текущий активный бой будет заменен, библиотека кораблей не изменится.",
      yesLabel: "Создать бой"
    });
    if (!confirmed) return;
    const battle = BattleScenarioService.createBlankBattle({ name, boardPreset: this.selectedBoardPreset, environmentPreset: this.selectedEnvironmentPreset });
    await this._saveBattleAndRender(battle);
    ui.notifications.info(`Создан бой: ${battle.name}.`);
  }

  static async _onApplyBoardPreset(event) {
    event.preventDefault();
    this._syncPresetSelectionsFromForm();
    if (!this._assertCanEdit("Пресет поля")) return;
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Пресет поля: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const preset = BattleScenarioService.applyBoardPreset(battle, this.selectedBoardPreset);
      battle.board.terrain = {};
      battle.board.terrainRevision = Math.max(0, Number(battle.board.terrainRevision ?? 0)) + 1;
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Применен пресет поля: ${preset.label}. Террейн очищен.`, ts: new Date().toISOString() });
    }, { reason: "setup-apply-board-preset" });
  }

  static async _onApplyEnvironmentPreset(event) {
    event.preventDefault();
    this._syncPresetSelectionsFromForm();
    if (!this._assertCanEdit("Пресет окружения")) return;
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Пресет окружения: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const preset = BattleScenarioService.applyEnvironmentPreset(battle, this.selectedEnvironmentPreset);
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Применено окружение: ${preset.label}.`, ts: new Date().toISOString() });
    }, { reason: "setup-apply-environment-preset" });
  }

  static async _onApplyScenarioPreset(event) {
    event.preventDefault();
    this._syncPresetSelectionsFromForm();
    if (!this._assertCanEdit("Пресет сценария")) return;
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Пресет сценария: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const preset = BattleScenarioService.applyScenarioPreset(battle, this.selectedScenarioPreset);
      battle.name = String(this.element.querySelector("[data-setup-name]")?.value ?? battle.name ?? preset.label).trim() || preset.label;
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Применен сценарий подготовки: ${preset.label}.`, ts: new Date().toISOString() });
    }, { reason: "setup-apply-scenario-preset" });
  }


  static async _onGenerateScenarioTerrain(event) {
    event.preventDefault();
    this._syncPresetSelectionsFromForm();
    if (!this._assertCanEdit("Генератор поля")) return;
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Генератор поля: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const generated = BattleScenarioService.generateScenarioTerrain(battle, this.selectedScenarioPreset);
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Поле боя сгенерировано заново: ${generated.summary.map(item => `${item.label} ×${item.count}`).join(", ") || "чистое поле"}.`, ts: new Date().toISOString() });
    }, { reason: "setup-generate-terrain" });
  }

  static async _onApplySideSetup(event) {
    event.preventDefault();
    if (!this._assertCanEdit("Команды боя")) return;
    const values = formValues(this.element);
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Команды боя: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const positiveNumber = (raw, fallback) => {
        const value = Number(raw);
        return Number.isFinite(value) && value > 0 ? value : Number(fallback);
      };
      const width = Math.max(8, Math.min(80, positiveNumber(values["board.width"], battle.board.width)));
      const height = Math.max(8, Math.min(80, positiveNumber(values["board.height"], battle.board.height)));
      const cellSize = Math.max(28, Math.min(96, positiveNumber(values["board.cellSize"], battle.board.cellSize)));
      if (width !== battle.board.width || height !== battle.board.height || cellSize !== battle.board.cellSize) BattleScenarioService.resizeBoard(battle, { width, height, cellSize });
      for (const sideId of BattleScenarioService.getSideIds(battle)) {
        BattleScenarioService.updateSideFromForm(battle, sideId, values);
      }
      battle.name = String(values["battle.name"] ?? battle.name ?? "Новый бой").trim() || "Новый бой";
      battle.setup.scenarioName = battle.name;
      battle.setup.mode = BattleScenarioService.normalizeMode(values.mode);
      battle.setup.victory = VictoryEngine.normalizeConfig({
        ...battle.setup.victory,
        enabled: values["victory.enabled"] === true,
        mode: values["victory.mode"],
        roundLimit: values["victory.roundLimit"],
        decisionMargin: Number(values["victory.decisionMarginPercent"] ?? 15) / 100,
        objectiveSideId: values["victory.objectiveSideId"],
        exitEdge: values["victory.exitEdge"],
        requiredShips: values["victory.requiredShips"],
        initialStrength: {},
        initialShipCount: {}
      }, BattleScenarioService.getSideIds(battle));
      delete battle.outcome;
      BattleScenarioService.applyModeToBattle(battle);
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: "Команды боя и зоны расстановки обновлены.", ts: new Date().toISOString() });
    }, { reason: "setup-apply-sides" });
  }

  static async _onAddSide(event) {
    event.preventDefault();
    if (!this._assertCanEdit("Команды боя")) return;
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Команды боя: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const side = BattleScenarioService.addSide(battle);
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Добавлена команда: ${side.name}.`, ts: new Date().toISOString() });
    }, { reason: "setup-add-side" });
  }

  static async _onRemoveSide(event, target) {
    event.preventDefault();
    if (!this._assertCanEdit("Команды боя")) return;
    const sideId = getActionTarget(event, target)?.dataset?.side;
    if (!sideId) return ui.notifications.warn("Команда не выбрана.");
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Команды боя: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const name = BattleScenarioService.getSideName(battle, sideId);
      if (!BattleScenarioService.removeSide(battle, sideId)) {
        const count = (battle.ships ?? []).filter(unit => unit.side === sideId).length;
        ui.notifications.warn(count
          ? "Нельзя удалить команду с участниками. Сначала переведите их в другие команды через Верфь."
          : "Нельзя удалить команду: в бою должно остаться минимум две команды.");
        return false;
      }
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Удалена пустая команда: ${name}.`, ts: new Date().toISOString() });
    }, { reason: "setup-remove-side" });
  }

  static async _onDeploySide(event, target) {
    event.preventDefault();
    if (!this._assertCanEdit("Расстановка стороны")) return;
    const side = getActionTarget(event, target)?.dataset?.side ?? BattleScenarioService.getSideIds(this.battle)[0] ?? "blue";
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Расстановка стороны: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const placed = BattleScenarioService.deploySide(battle, side, { random: false });
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Массовая расстановка стороны ${battle.setup.sides[side]?.name ?? side}: ${placed.length} корабл.`, ts: new Date().toISOString() });
    }, { reason: `setup-deploy-${side}` });
  }

  static async _onRandomDeploySide(event, target) {
    event.preventDefault();
    if (!this._assertCanEdit("Случайная расстановка стороны")) return;
    const side = getActionTarget(event, target)?.dataset?.side ?? BattleScenarioService.getSideIds(this.battle)[0] ?? "blue";
    await this._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Случайная расстановка стороны: бой уже подтвержден. Вернитесь к подготовке в главном окне.");
        return false;
      }
      const placed = BattleScenarioService.deploySide(battle, side, { random: true });
      battle.log ??= [];
      battle.log.push({ id: foundry.utils.randomID?.() ?? String(Date.now()), round: 1, phase: "orders", text: `Случайная расстановка стороны ${battle.setup.sides[side]?.name ?? side}: ${placed.length} корабл.`, ts: new Date().toISOString() });
    }, { reason: `setup-random-deploy-${side}` });
  }

  static async _onSaveScenario(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Сценарии сохраняет только ГМ.");
    const battle = this.battle;
    const fallback = battle.setup?.scenarioName || battle.name || "Сценарий боя";
    const name = await DialogService.text({ title: "Сохранение сценария", label: "Название сценария", value: fallback, okLabel: "Сохранить" });
    if (name === null) return;
    const entry = await BattleScenarioService.saveScenario(name.trim() || fallback, battle);
    ui.notifications.info(`Сценарий сохранен: ${entry.name}.`);
    this.render({ force: true });
  }

  static async _onLoadScenario(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Сценарии загружает только ГМ.");
    const id = getActionTarget(event, target)?.dataset?.scenarioId;
    const entry = BattleScenarioService.getSavedScenarios().find(item => item.id === id);
    if (!entry) return ui.notifications.warn("Сценарий не найден.");
    const confirmed = await DialogService.confirm({
      title: "Загрузка сценария",
      content: `Загрузить сценарий «${entry.name}» как активный бой?`,
      yesLabel: "Загрузить"
    });
    if (!confirmed) return;
    const battle = game.sailshipsCombat.storage.normalizeBattle(BattleScenarioService.scenarioToBattle(entry));
    await this._saveBattleAndRender(battle);
  }

  static async _onDeleteScenario(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Сценарии удаляет только ГМ.");
    const id = getActionTarget(event, target)?.dataset?.scenarioId;
    const removed = await BattleScenarioService.deleteScenario(id);
    if (!removed) return ui.notifications.warn("Сценарий не найден.");
    ui.notifications.info(`Сценарий удален: ${removed.name}.`);
    this.render({ force: true });
  }

  static async _onExportScenario(event, target) {
    event.preventDefault();
    const id = getActionTarget(event, target)?.dataset?.scenarioId;
    const entry = id ? BattleScenarioService.getSavedScenarios().find(item => item.id === id) : BattleScenarioService.cleanScenarioFromBattle(this.battle, this.battle.setup?.scenarioName);
    if (!entry) return ui.notifications.warn("Сценарий не найден.");
    const json = JSON.stringify(entry, null, 2);
    await DialogService.copyOrShow({ title: "Экспорт сценария", label: "JSON сценария", text: json, copiedMessage: "JSON сценария скопирован в буфер обмена." });
  }

  static async _onImportScenario(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Сценарии импортирует только ГМ.");
    const raw = await DialogService.multiline({ title: "Импорт сценария", label: "Вставьте JSON сценария", okLabel: "Импортировать", required: true });
    if (!raw) return;
    let parsed;
    try {
      parsed = ImportValidationService.parseJson(raw, "Сценарий");
      if (!parsed?.scenario && !parsed?.board) throw new Error("JSON не похож на сценарий боя.");
      ImportValidationService.validateScenario(parsed);
    } catch (err) {
      console.error(err);
      return ui.notifications.error(err.message ?? "Не удалось импортировать сценарий.");
    }
    const entry = parsed.scenario ? parsed : BattleScenarioService.cleanScenarioFromBattle(parsed, parsed.name ?? "Импортированный сценарий");
    const scenarios = BattleScenarioService.getSavedScenarios();
    entry.id = foundry.utils.randomID?.() ?? String(Date.now());
    entry.saved = new Date().toISOString();
    scenarios.push(entry);
    await BattleScenarioService.saveSavedScenarios(scenarios);
    ui.notifications.info(`Сценарий импортирован: ${entry.name}.`);
    this.render({ force: true });
  }

  static async _onClearCurrentBattle(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Текущий бой очищает только ГМ.");
    const confirmed = await DialogService.confirm({
      title: "Очистка текущего боя",
      content: "Создать пустую подготовку? Библиотека кораблей и сохраненные сценарии останутся.",
      yesLabel: "Очистить бой",
      danger: true
    });
    if (!confirmed) return;
    const battle = BattleScenarioService.createBlankBattle({ name: "Новый бой", boardPreset: this.selectedBoardPreset, environmentPreset: this.selectedEnvironmentPreset });
    await this._saveBattleAndRender(battle);
  }

  static async _onOpenShipyard(event) {
    event.preventDefault();
    game.sailshipsCombat.openShipyard?.();
  }

  static async _onOpenBattle(event) {
    event.preventDefault();
    game.sailshipsCombat.open?.();
  }

  _onClose(options) {
    if (this._dirty) game.sailshipsCombat.app?.onExternalBattleUpdate?.();
    if (game.sailshipsCombat?.setupApp === this) game.sailshipsCombat.setupApp = null;
    if (super._onClose) super._onClose(options);
  }
}
