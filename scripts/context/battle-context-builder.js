import { BattleReportService } from "../services/battle-report-service.js";
import { AIR_ONLY_TERRAIN_TYPES, DECISION_PHASES, SEA_ONLY_TERRAIN_TYPES, TERRAIN_LABELS } from "../utils/constants.js";
import { BoardContextBuilder } from "./board-context-builder.js";
import { ShipViewModelBuilder } from "./ship-view-model-builder.js";
import { CombatPanelContextBuilder } from "./combat-panel-context-builder.js";
import { BattleScenarioService } from "../services/battle-scenario-service.js";
import { PlayerControlContextBuilder } from "./player-control-context-builder.js";
import { GunneryEngine } from "../engine/gunnery-engine.js";
import { RenderContextCache } from "./render-context-cache.js";
import { VictoryContextBuilder } from "./victory-context-builder.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { BattleGuidanceBuilder } from "./battle-guidance-builder.js";

const ALL_PARTS = Object.freeze(["fleet", "board", "summary", "controls"]);

export class BattleContextBuilder {
  constructor(app) {
    this.app = app;
    this.renderCache = new RenderContextCache();
    this.board = new BoardContextBuilder(app, this.renderCache);
    this.shipView = new ShipViewModelBuilder(app);
    this.combatPanels = new CombatPanelContextBuilder(app, this.renderCache);
  }

  static build({ app, baseContext, battle }) {
    return new BattleContextBuilder(app).build(baseContext, battle);
  }

  invalidate() {
    this.renderCache.clear();
  }

  build(baseContext, battle) {
    this.setScope(battle);
    const state = this.getState(battle);
    const full = {
      ...this.getCommonFields(battle, state),
      ...this.getFleetFields(battle, state),
      ...this.getBoardFields(battle, state),
      ...this.getSummaryFields(battle, state),
      ...this.getControlFields(battle, state)
    };
    return foundry.utils.mergeObject(baseContext, full, { inplace: false });
  }

  buildPart(partId, baseContext, battle) {
    this.setScope(battle);
    const state = this.getState(battle);
    const common = this.getCommonFields(battle, state);
    let partFields = {};

    if (partId === "fleet") partFields = this.getFleetFields(battle, state);
    else if (partId === "board") partFields = this.getBoardFields(battle, state);
    else if (partId === "summary") partFields = this.getSummaryFields(battle, state);
    else if (partId === "controls") partFields = this.getControlFields(battle, state);

    return foundry.utils.mergeObject(baseContext, { ...common, ...partFields }, { inplace: false });
  }

  setScope(battle) {
    this.renderCache.setScope(`${battle.id}:${battle.revision}`);
  }

  getState(battle) {
    const app = this.app;
    const key = [
      "state",
      app.selectedShipId ?? "none",
      app.selectedTargetId ?? "none",
      app.aimSection ?? "auto",
      app.terrainMode ?? "none",
      app.deployMode ? "deploy" : "normal"
    ].join(":");

    return this.renderCache.memo(key, () => {
      const selectedShip = battle.ships.find(ship => ship.id === app.selectedShipId) ?? battle.ships[0] ?? null;
      const resolvedShipId = selectedShip?.id ?? null;
      if (app.selectedShipId !== resolvedShipId) app.selectedShipId = resolvedShipId;
      const selectedSide = selectedShip
        ? battle.setup?.sides?.[selectedShip.side] ?? { name: selectedShip.side, color: "#777777" }
        : null;
      const selectedIsCreature = selectedShip?.unitType === "creature";
      const selectedOperational = selectedShip ? CombatantRules.isOperational(selectedShip) : false;
      let selectedTarget = battle.ships.find(ship => ship.id === app.selectedTargetId) ?? null;
      if (!selectedTarget || selectedTarget.id === selectedShip?.id) {
        selectedTarget = null;
        if (app.selectedTargetId != null) app.selectedTargetId = null;
        if (app.aimSection != null) app.aimSection = null;
      }

      const activeShip = app._getActiveShip(battle);
      const battleMode = BattleScenarioService.getModeFlags(battle);
      if (!battleMode.usesCrystal && app.aimSection === "crystalCore") app.aimSection = null;
      if (selectedShip
        && !selectedIsCreature
        && app.aimSection === "crystalCore"
        && !GunneryEngine.canAttackerTargetCrystalCore(battle, selectedShip)) app.aimSection = null;
      if (!battleMode.usesWater && SEA_ONLY_TERRAIN_TYPES.includes(app.terrainMode)) app.terrainMode = null;
      if (!battleMode.usesAltitude && AIR_ONLY_TERRAIN_TYPES.includes(app.terrainMode)) app.terrainMode = null;

      return {
        selectedShip,
        selectedSide,
        selectedIsCreature,
        selectedOperational,
        selectedTarget,
        activeShip,
        battleMode
      };
    });
  }

  getCommonFields(battle, state) {
    return {
      isGM: game.user.isGM,
      setupConfirmed: Boolean(battle.setupConfirmed),
      canConfirmSetup: Boolean(game.user.isGM && !battle.setupConfirmed),
      canReturnToSetup: Boolean(game.user.isGM && battle.setupConfirmed),
      canNextPhase: Boolean(game.user.isGM && battle.setupConfirmed && !battle.outcome?.resolved
        && !this.app.phase?.busy && (!this.app._isActivationPhase(battle.phase) || !state.activeShip)),
      battle,
      battleReport: BattleReportService.context(battle.lastReport),
      reportOnBoard: Boolean(battle.lastReport && this.app.dismissedReportId !== battle.lastReport.id && !battle.outcome?.resolved),
      battleMode: state.battleMode,
      deployMode: this.app.deployMode,
      terrainMode: this.app.terrainMode,
      terrainModeLabel: TERRAIN_LABELS[this.app.terrainMode] ?? (this.app.terrainMode === "clear" ? "очистка" : "нет"),
      terrainTools: Object.entries(TERRAIN_LABELS)
        .filter(([id]) => state.battleMode.usesWater || !SEA_ONLY_TERRAIN_TYPES.includes(id))
        .filter(([id]) => state.battleMode.usesAltitude || !AIR_ONLY_TERRAIN_TYPES.includes(id))
        .map(([id, label]) => ({ id, label, active: this.app.terrainMode === id })),
      selectedShip: state.selectedShip,
      selectedUnit: state.selectedShip,
      selectedIsCreature: state.selectedIsCreature,
      selectedIsShip: Boolean(state.selectedShip && !state.selectedIsCreature),
      selectedOperational: state.selectedOperational,
      selectedSide: state.selectedSide,
      selectedTarget: state.selectedTarget,
      selectedTargetId: this.app.selectedTargetId,
      activeShip: state.activeShip
    };
  }

  getFleetFields(battle, state) {
    return {
      board: this.board.buildFleetContext(battle, state.selectedShip),
      log: [...(battle.log ?? [])].reverse().slice(0, 80)
    };
  }

  getTurnFields(battle, state) {
    const activeActionState = state.activeShip && CombatantRules.isOperational(state.activeShip)
      ? this.app._getActionState(battle, state.activeShip)
      : { canPass: false };
    const passTurnTitle = battle.phase === "movement" && state.activeShip && !activeActionState.canPass
      ? `Инерция требует движения: выберите подсвеченную клетку (минимум ${activeActionState.movementState?.requiredAdvance ?? 1} гекс.).`
      : "Завершить активацию текущей боевой единицы в этой фазе.";
    return {
      canPassTurn: Boolean(game.user.isGM
        && battle.setupConfirmed
        && this.app._isActivationPhase(battle.phase)
        && state.activeShip
        && activeActionState.canPass),
      passTurnTitle,
      nextPhaseLabel: ({ orders: "К манёврам", movement: "К стрельбе", gunnery: "К экипажу", damage: "К экипажу", crew: "Завершить раунд", end: "Завершить раунд" })[battle.phase],
      nextPhaseTitle: this.app._isActivationPhase(battle.phase) && state.activeShip
        ? "Сначала завершите активации всех участников этой фазы."
        : ["crew", "end"].includes(battle.phase) ? "Обработать перезарядку, движение по инерции и длительные эффекты, затем начать приказы нового раунда." : "Перейти к следующему этапу.",
      turnOrder: this.app._getTurnOrder(battle),
      phases: DECISION_PHASES.map((id, index) => ({ id, number: index + 1, active: id === battle.phase || (id === "crew" && ["damage", "end"].includes(battle.phase)), done: index < DECISION_PHASES.indexOf(battle.phase) }))
    };
  }

  getBoardFields(battle, state) {
    return {
      board: this.board.build(battle, state.selectedShip),
      battleOutcome: VictoryContextBuilder.build(battle),
      ...this.getTurnFields(battle, state)
    };
  }

  getDetailState(battle, state) {
    const key = `details:${state.selectedShip?.id ?? "none"}:${state.selectedTarget?.id ?? "none"}:${this.app.aimSection ?? "auto"}`;
    return this.renderCache.memo(key, () => {
      const rawActionState = state.selectedShip && state.selectedOperational
        ? this.app._getActionState(battle, state.selectedShip)
        : { isActive: false };
      const playerControl = PlayerControlContextBuilder.build(battle, state.selectedShip);
      const canViewSelectedShipDetails = Boolean(playerControl.selectedCanViewDetails);
      const detailUnit = canViewSelectedShipDetails ? state.selectedShip : null;
      const detailShip = detailUnit && !state.selectedIsCreature ? state.selectedShip : null;
      const detailCreature = detailUnit && state.selectedIsCreature ? state.selectedShip : null;
      const actionState = canViewSelectedShipDetails ? rawActionState : { isActive: rawActionState.isActive };
      const phaseFlags = this.app._getPhaseFlags(battle);

      if (state.selectedShip && (!canViewSelectedShipDetails || !state.selectedOperational)) {
        phaseFlags.orders = false;
        phaseFlags.movement = false;
        phaseFlags.gunnery = false;
        phaseFlags.damage = false;
        phaseFlags.crew = false;
        phaseFlags.showTargets = false;
        phaseFlags.showSections = false;
        phaseFlags.showWeapons = false;
      } else if (state.selectedIsCreature) {
        phaseFlags.orders = false;
        phaseFlags.showWeapons = false;
        phaseFlags.showTargets = phaseFlags.gunnery;
      }

      return {
        rawActionState,
        playerControl,
        canViewSelectedShipDetails,
        detailShip,
        detailCreature,
        actionState,
        phaseFlags,
        orderControls: {
          canUse: Boolean(game.user.isGM ? rawActionState.canOrder : playerControl.canSubmitOrder)
        }
      };
    });
  }

  getSummaryFields(battle, state) {
    const detail = this.getDetailState(battle, state);
    return {
      actionState: detail.actionState,
      canViewSelectedShipDetails: detail.canViewSelectedShipDetails,
      selectedShipDone: state.selectedShip
        ? this.app._isShipDoneForPhase(battle, state.selectedShip.id, battle.phase)
        : false,
      selectedInfo: detail.detailShip
        ? this.combatPanels.getSelectedInfo(battle, detail.detailShip)
        : detail.detailCreature
          ? this.combatPanels.getCreatureSelectedInfo(battle, detail.detailCreature)
          : null,
      creatureGrappleInfo: detail.detailCreature
        ? this.combatPanels.getCreatureGrappleInfo(battle, detail.detailCreature)
        : null,
      boardingInfo: detail.detailShip
        ? this.combatPanels.getBoardingInfo(battle, detail.detailShip, state.selectedTarget)
        : null,
      selectedStatus: state.selectedShip && detail.canViewSelectedShipDetails
        ? this.shipView.getShipStatus(state.selectedShip)
        : null
    };
  }

  getControlFields(battle, state) {
    const detail = this.getDetailState(battle, state);
    const savedBattles = game.user.isGM
      ? game.sailshipsCombat.storage.getSavedBattleMetadata?.() ?? []
      : [];
    const shotPreviews = detail.detailShip
      ? this.combatPanels.getShotPreviews(battle, detail.detailShip, state.selectedTarget)
      : [];

    return {
      ...this.getTurnFields(battle, state),
      actionState: detail.actionState,
      guidance: BattleGuidanceBuilder.build({
        battle, selectedShip: state.selectedShip, activeShip: state.activeShip,
        actionState: detail.actionState, canViewDetails: detail.canViewSelectedShipDetails,
        isGM: game.user.isGM, canSubmitOrder: detail.playerControl.canSubmitOrder,
        pendingOrder: Boolean(detail.playerControl.selectedPendingOrder),
        hasSelectedTarget: Boolean(state.selectedTarget),
        hasShotPreview: shotPreviews.some(shot => shot.canFireNow)
      }),
      playerControl: detail.playerControl,
      orderControls: detail.orderControls,
      canViewSelectedShipDetails: detail.canViewSelectedShipDetails,
      selectedShipDone: state.selectedShip
        ? this.app._isShipDoneForPhase(battle, state.selectedShip.id, battle.phase)
        : false,
      selectedInfo: detail.detailShip
        ? this.combatPanels.getSelectedInfo(battle, detail.detailShip)
        : detail.detailCreature
          ? this.combatPanels.getCreatureSelectedInfo(battle, detail.detailCreature)
          : null,
      creatureAttacks: detail.detailCreature
        ? this.combatPanels.getCreatureAttacks(battle, detail.detailCreature, state.selectedTarget)
        : [],
      creatureAbilities: detail.detailCreature
        ? this.combatPanels.getCreatureAbilities(battle, detail.detailCreature)
        : [],
      creatureGrappleInfo: detail.detailCreature
        ? this.combatPanels.getCreatureGrappleInfo(battle, detail.detailCreature)
        : null,
      boardingInfo: detail.detailShip
        ? this.combatPanels.getBoardingInfo(battle, detail.detailShip, state.selectedTarget)
        : null,
      selectedStatus: state.selectedShip && detail.canViewSelectedShipDetails
        ? this.shipView.getShipStatus(state.selectedShip)
        : null,
      weaponControls: detail.detailShip
        ? this.combatPanels.getWeaponControls(battle, detail.detailShip)
        : [],
      phaseFlags: detail.phaseFlags,
      targets: detail.detailShip
        ? this.combatPanels.getAvailableTargets(battle, detail.detailShip)
        : detail.detailCreature
          ? this.combatPanels.getCreatureTargets(battle, detail.detailCreature)
          : [],
      gunneryTargets: detail.detailShip ? battle.ships.filter(unit => unit.side !== detail.detailShip.side && CombatantRules.isActive(unit) && CombatantRules.supports(unit, "targetable")).map(unit => ({ id: unit.id, name: unit.name, selected: unit.id === state.selectedTarget?.id })) : [],
      shotPreviews,
      shotPreviewEmptyText: this.combatPanels.getShotPreviewEmptyText(state.selectedTarget),
      aimSection: this.app.aimSection,
      aimButtons: this.combatPanels.getAimButtons(battle),
      savedBattles: savedBattles.map((entry, index) => ({ ...entry, index: index + 1 })),
      savedBattleCount: savedBattles.length
    };
  }
}
