import { MovementPlanController } from "../controllers/movement-plan-controller.js";
import { uid } from "../utils/random.js";
import { BattlePhaseController } from "../controllers/battle-phase-controller.js";
import { BoardInteractionController } from "../controllers/board-interaction-controller.js";
import { BattleSetupController } from "../controllers/battle-setup-controller.js";
import { BattleContextBuilder } from "../context/battle-context-builder.js";
import { EnvironmentController } from "../controllers/environment-controller.js";
import { ShipMovementController } from "../controllers/ship-movement-controller.js";
import { ShipGunneryController } from "../controllers/ship-gunnery-controller.js";
import { ShipCrewController } from "../controllers/ship-crew-controller.js";
import { ShipOrderController } from "../controllers/ship-order-controller.js";
import { BattlePersistenceController } from "../controllers/battle-persistence-controller.js";
import {
  dockBattleHeaderControls,
  getBattleWindowTitle
} from "../context/battle-header-controls-builder.js";
import { BattleLayoutController } from "../controllers/battle-layout-controller.js";
import { BattleAnimationController } from "../controllers/battle-animation-controller.js";
import { CreatureCombatController } from "../controllers/creature-combat-controller.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const BATTLE_RENDER_PARTS = Object.freeze(["fleet", "board", "summary", "controls"]);
export class NavalBattleApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.phase = new BattlePhaseController(this);
    this.board = new BoardInteractionController(this);
    this.movementPlan = new MovementPlanController(this);
    this.setup = new BattleSetupController(this);
    this.environment = new EnvironmentController(this);
    this.movement = new ShipMovementController(this);
    this.gunnery = new ShipGunneryController(this);
    this.crew = new ShipCrewController(this);
    this.orders = new ShipOrderController(this);
    this.persistence = new BattlePersistenceController(this);
    this.layout = new BattleLayoutController(this);
    this.animation = new BattleAnimationController(this);
    this.creatures = new CreatureCombatController(this);
    this.selectedShipId = null;
    this.selectedTargetId = null;
    this.aimSection = null;
    this.deployMode = false;
    this.terrainMode = null;
    this.boardCamera = { x: 0, y: 0, zoom: 1 };
    this.contextBuilder = new BattleContextBuilder(this);
    this.renderBattleSnapshot = null;
    this._queuedRenderParts = new Set();
    this._renderDrainPromise = null;
  }
  static DEFAULT_OPTIONS = {
    id: "sailships-combat-app",
    classes: ["sailships-combat", "sailships-battle-app"],
    tag: "section",
    window: {
      title: "SAILSHIPS.AppTitle",
      icon: "fa-solid fa-anchor",
      contentClasses: ["ssc-shell", "ssc-main-grid"],
      resizable: true
    },
    position: {
      width: 1500,
      height: 900
    },
    actions: {
      resetDemo: this._onResetDemo,
      confirmSetup: this._onConfirmSetup,
      returnToSetup: this._onReturnToSetup,
      openShipyard: this._onOpenShipyard,
      openBattleSetup: this._onOpenBattleSetup,
      openSoundSettings: this._onOpenSoundSettings,
      openBoardSettings: this._onOpenBoardSettings,
      saveBattleSnapshot: this._onSaveBattleSnapshot,
      loadBattleSnapshot: this._onLoadBattleSnapshot,
      deleteBattleSnapshot: this._onDeleteBattleSnapshot,
      exportBattle: this._onExportBattle,
      importBattle: this._onImportBattle,
      clearBattleLog: this._onClearBattleLog,
      showLayoutPane: this._onShowLayoutPane,
      nextPhase: this._onNextPhase,
      advanceToDecision: this._onAdvanceToDecision,
      selectTurnUnit: this._onSelectTurnUnit,
      continueBattle: this._onContinueBattle,
      passTurn: this._onPassTurn,
      confirmMovementPlan: this._onConfirmMovementPlan,
      cancelMovementPlan: this._onCancelMovementPlan,
      rotateWindLeft: this._onRotateWindLeft,
      rotateWindRight: this._onRotateWindRight,
      fullSail: this._onFullSail,
      reduceSail: this._onReduceSail,
      turnLeft: this._onTurnLeft,
      turnRight: this._onTurnRight,
      creatureClimb: this._onCreatureClimb,
      creatureDive: this._onCreatureDive,
      creatureRecoverFall: this._onCreatureRecoverFall,
      coreClimb: this._onCoreClimb,
      coreDescend: this._onCoreDescend,
      coreEmergencyDescend: this._onCoreEmergencyDescend,
      coreImpulse: this._onCoreImpulse,
      coreShift0: this._onCoreShift0,
      coreShift60: this._onCoreShift60,
      coreShift120: this._onCoreShift120,
      coreShift180: this._onCoreShift180,
      coreShift240: this._onCoreShift240,
      coreShift300: this._onCoreShift300,
      coreModeNormal: this._onCoreModeNormal,
      coreModeBoosted: this._onCoreModeBoosted,
      coreModeEmergency: this._onCoreModeEmergency,
      coreModeShutdown: this._onCoreModeShutdown,
      selectBatteryArc: this._onSelectBatteryArc,
      showBattleReport: this._onShowBattleReport,
      dismissBattleReport: this._onDismissBattleReport,
      firePort: this._onFirePort,
      fireStarboard: this._onFireStarboard,
      fireBow: this._onFireBow,
      fireStern: this._onFireStern,
      fireMortar: this._onFireMortar,
      fireSwivel: this._onFireSwivel,
      creatureAttack: this._onCreatureAttack,
      creatureAbility: this._onCreatureAbility,
      creatureDetach: this._onCreatureDetach,
      creatureAI: this._onCreatureAI,
      creatureStopBleeding: this._onCreatureStopBleeding,
      creatureShakeOff: this._onCreatureShakeOff,
      creatureExtinguish: this._onCreatureExtinguish,
      creatureRally: this._onCreatureRally,
      creatureManualDamage: this._onCreatureManualDamage,
      crewTask: this._onCrewTask,
      repair: this._onRepair,
      repairFire: this._onRepairFire,
      repairFlooding: this._onRepairFlooding,
      repairSystem: this._onRepairSystem,
      coolCrystalCore: this._onCoolCrystalCore,
      rallyCrew: this._onRallyCrew,
      abandonShip: this._onAbandonShip,
      manualDamage: this._onManualDamage,
      manualFire: this._onManualFire,
      manualFlooding: this._onManualFlooding,
      grapple: this._onGrapple,
      boarding: this._onBoarding,
      releaseGrapple: this._onReleaseGrapple,
      repelCreature: this._onRepelCreature,
      cycleBoardSize: this._onCycleBoardSize,
      setAmmo: this._onSetAmmo,
      setFireMode: this._onSetFireMode,
      clearTarget: this._onClearTarget,
      selectActiveShip: this._onSelectActiveShip,
      toggleDeployMode: this._onToggleDeployMode,
      setTerrainMode: this._onSetTerrainMode,
      cancelTerrainMode: this._onCancelTerrainMode,
      clearAllTerrain: this._onClearAllTerrain,
      applyBoardEdits: this._onApplyBoardEdits,
      pickBoardBackground: this._onPickBoardBackground,
      clearBoardBackground: this._onClearBoardBackground,
      cycleWindStrength: this._onCycleWindStrength,
      cycleSea: this._onCycleSea,
      cycleVisibility: this._onCycleVisibility,
      orderBattleSail: this._onOrderBattleSail,
      orderPressSail: this._onOrderPressSail,
      orderSteadyGunnery: this._onOrderSteadyGunnery,
      orderDamageControl: this._onOrderDamageControl,
      orderBoarding: this._onOrderBoarding,
      orderBrace: this._onOrderBrace,
      assignSelectedShipToPlayer: this._onAssignSelectedShipToPlayer,
      unassignSelectedShip: this._onUnassignSelectedShip,
      approvePendingOrder: this._onApprovePendingOrder,
      rejectPendingOrder: this._onRejectPendingOrder,
      aimAuto: this._onAimAuto,
      aimBow: this._onAimBow,
      aimMidship: this._onAimMidship,
      aimStern: this._onAimStern,
      aimCrystalCore: this._onAimCrystalCore
    }
  };
  static PARTS = {
    navigation: { template: "modules/sailships-combat/templates/naval/parts/naval-navigation.hbs" },
    fleet: { template: "modules/sailships-combat/templates/naval/parts/naval-left-panel.hbs" },
    board: { template: "modules/sailships-combat/templates/naval/parts/naval-board-part.hbs" },
    summary: { template: "modules/sailships-combat/templates/naval/parts/naval-selected-summary.hbs" },
    controls: { template: "modules/sailships-combat/templates/naval/parts/naval-right-panel.hbs" }
  };
  static async _onConfirmMovementPlan() { return this.movementPlan.confirm(); }
  static async _onCancelMovementPlan() { return this.movementPlan.cancel(); }
  get title() {
    return getBattleWindowTitle(this);
  }
  get battle() {
    return game.sailshipsCombat.storage.getBattleForUser(game.user);
  }
  _getActiveShip(battle) { return this.phase.getActiveShip(battle); }
  _isActivationPhase(phase) { return this.phase.isActivationPhase(phase); }
  _eligibleShips(battle) { return this.phase.eligibleShips(battle); }
  _isShipDoneForPhase(battle, shipId, phase) { return this.phase.isShipDoneForPhase(battle, shipId, phase); }
  _getTurnOrder(battle) { return this.phase.getTurnOrder(battle); }
  _getShipsInPhaseOrder(battle, phase = battle.phase) { return this.phase.getShipsInPhaseOrder(battle, phase); }
  _buildPhaseOrder(battle, phase = battle.phase) { return this.phase.buildPhaseOrder(battle, phase); }
  _getInitiativeScore(battle, ship, phase = battle.phase) { return this.phase.getInitiativeScore(battle, ship, phase); }
  _getShipTurnActions(battle, ship) { return this.phase.getShipTurnActions(battle, ship); }
  _getActionState(battle, ship) { return this.phase.getActionState(battle, ship); }
  _canShowMovement(battle, ship) { return this.phase.canShowMovement(battle, ship); }
  _requireActivePhase(battle, ship, phase, label) { return this.phase.requireActivePhase(battle, ship, phase, label); }
  _getPhaseBudget(battle, ship, phase = battle.phase) { return this.phase.getPhaseBudget(battle, ship, phase); }
  _getSpentAP(battle, ship, phase = battle.phase) { return this.phase.getSpentAP(battle, ship, phase); }
  _getRemainingAP(battle, ship, phase = battle.phase) { return this.phase.getRemainingAP(battle, ship, phase); }
  _canSpendMovementPreparation(battle, ship, options = {}) { return this.phase.canSpendMovementPreparation(battle, ship, options); }
  _markTurnAction(battle, ship, action, cost = 1) { return this.phase.markTurnAction(battle, ship, action, cost); }
  _refundTurnAction(battle, ship, action, cost = 1) { return this.phase.refundTurnAction(battle, ship, action, cost); }
  async _completeIfNoAP(battle, ship, phase = battle.phase) { return this.phase.completeIfNoAP(battle, ship, phase); }
  _completeShipActivation(battle, ship, phase = battle.phase) { return this.phase.completeShipActivation(battle, ship, phase); }
  _advanceActiveShip(battle, phase = battle.phase) { return this.phase.advanceActiveShip(battle, phase); }
  _startPhase(battle, phase) { return this.phase.startPhase(battle, phase); }
  _getPhaseFlags(battle) { return this.phase.getPhaseFlags(battle); }
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const battle = this.renderBattleSnapshot ?? this.battle;
    this.renderBattleSnapshot = battle;
    return foundry.utils.mergeObject(context, { battle }, { inplace: false });
  }
  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    const battle = this.renderBattleSnapshot ?? this.battle;
    return this.contextBuilder.buildPart(partId, partContext, battle);
  }
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (!this.hasFrame) return;
    options.window ??= {};
    options.window.title = this.title.replace(/\s+/g, " ").trim();
    options.window.controls = true;
  }
  _getHeaderControls() {
    return super._getHeaderControls();
  }
  _getBoardCamera(pixelWidth, pixelHeight) { return this.board.getBoardCamera(pixelWidth, pixelHeight); }
  _applyBoardViewBox(svg = this.element?.querySelector?.(".ssc-board-svg")) { return this.board.applyBoardViewBox(svg); }
  _eventToBoardPoint(svg, event) { return this.board.eventToBoardPoint(svg, event); }
  _eventToBoardCell(svg, event) { return this.board.eventToBoardCell(svg, event); }
  _onRender(context, options) {
    super._onRender(context, options);
    dockBattleHeaderControls(this);
    this.board.bindEvents();
    this.layout.bind();
    this.animation.onRender(context?.battle ?? this.battle);
  }
  _onClose(options) {
    this.layout.destroy();
    this.board.destroy();
    this.movementPlan.pending = null;
    this.animation.destroy();
    this.renderBattleSnapshot = null;
    this._queuedRenderParts.clear();
    this._renderDrainPromise = null;
    this.contextBuilder.invalidate();
    if (game.sailshipsCombat?.app === this) game.sailshipsCombat.app = null;
    if (super._onClose) super._onClose(options);
  }
  _selectShip(shipId) { return this.board.selectShip(shipId); }
  _selectShipOrTarget(shipId) { return this.board.selectShipOrTarget(shipId); }
  async _moveSelectedShip(x, y) { return this.board.moveSelectedShip(x, y); }
  async _placeSelectedShip(battle, ship, x, y) { return this.board.placeSelectedShip(battle, ship, x, y); }
  async _paintTerrainCell(battle, x, y) { return this.board.paintTerrainCell(battle, x, y); }
  async _saveAndRender(battle, options = {}) {
    const preserveRightPanelScroll = Boolean(options.preserveRightPanelScroll);
    const rightPanel = this.element?.querySelector?.(".ssc-right-panel");
    const rightPanelScrollTop = preserveRightPanelScroll ? Number(rightPanel?.scrollTop ?? 0) : null;
    const savedBattle = await game.sailshipsCombat.storage.saveBattle(battle, {
      reason: options.reason ?? "full-save",
      renderParts: options.renderParts ?? null,
      fullReplace: options.fullReplace !== false
    });
    this.renderBattleSnapshot = savedBattle;
    const renderParts = options.renderParts ?? game.sailshipsCombat.storage.getLastChange?.().renderParts ?? BATTLE_RENDER_PARTS;
    if (renderParts.length) await this.renderBattleState(this.movementPlan.pending ? [...new Set([...renderParts, "board"])] : renderParts);
    if (preserveRightPanelScroll) {
      setTimeout(() => {
        const panel = this.element?.querySelector?.(".ssc-right-panel");
        if (panel) panel.scrollTop = rightPanelScrollTop;
      }, 0);
    }
  }
  async _updateBattleAndRender(mutator, options = {}) {
    const preserveRightPanelScroll = Boolean(options.preserveRightPanelScroll);
    const rightPanel = this.element?.querySelector?.(".ssc-right-panel");
    const rightPanelScrollTop = preserveRightPanelScroll ? Number(rightPanel?.scrollTop ?? 0) : null;
    const battle = await game.sailshipsCombat.storage.updateBattle(mutator, { reason: options.reason ?? "" });
    this.renderBattleSnapshot = battle;
    const renderParts = options.renderParts ?? game.sailshipsCombat.storage.getLastChange?.().renderParts ?? BATTLE_RENDER_PARTS;
    if (renderParts.length) await this.renderBattleState(renderParts);
    if (preserveRightPanelScroll) {
      setTimeout(() => {
        const panel = this.element?.querySelector?.(".ssc-right-panel");
        if (panel) panel.scrollTop = rightPanelScrollTop;
      }, 0);
    }
    return battle;
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
  renderBattleState(parts = BATTLE_RENDER_PARTS) {
    for (const part of parts ?? BATTLE_RENDER_PARTS) this._queuedRenderParts.add(part);
    if (this._renderDrainPromise) return this._renderDrainPromise;

    this._renderDrainPromise = (async () => {
      // Collapse rapid header/environment clicks into ordered render batches.
      await Promise.resolve();
      while (this._queuedRenderParts.size) {
        const nextParts = [...this._queuedRenderParts];
        this._queuedRenderParts.clear();
        const parts = nextParts;
        await this.render({ force: true, parts: [...parts] });
      }
    })().finally(() => {
      this._renderDrainPromise = null;
      if (this._queuedRenderParts.size) this.renderBattleState();
    });
    return this._renderDrainPromise;
  }
  getSelectedShip(battle) {
    return battle.ships.find(s => s.id === this.selectedShipId) ?? null;
  }
  static async _onAdvanceToDecision(event, target) {
    event.preventDefault();
    return this.phase.advanceToDecision(target ?? event.target?.closest("[data-action]"));
  }
  static _onSelectTurnUnit(event, target) {
    event.preventDefault();
    const id = (target ?? event.target?.closest("[data-action]"))?.dataset.shipId;
    if (id) return this._selectShip(id);
  }
  static _onSelectActiveShip(event) {
    event.preventDefault();
    const active = this._getActiveShip(this.battle);
    if (active) this._selectShip(active.id);
  }
  static async _onOpenShipyard(event) {
    event.preventDefault();
    game.sailshipsCombat?.openShipyard?.(this.selectedShipId);
  }
  static async _onOpenBattleSetup(event) {
    event.preventDefault();
    game.sailshipsCombat?.openBattleSetup?.();
  }
  static async _onOpenBoardSettings(event) { event.preventDefault(); return game.sailshipsCombat.openBoardSettings(); }

  static async _onOpenSoundSettings(event) {
    event.preventDefault();
    game.sailshipsCombat?.openSoundSettings?.();
  }
  static async _onResetDemo(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Сброс демо-боя доступен только ГМу.");
    const battle = await game.sailshipsCombat.storage.resetBattle();
    this.selectedShipId = battle.ships[0]?.id ?? null;
    this.selectedTargetId = null;
    this.renderBattleState();
  }
  static async _onConfirmSetup(event) { return this.setup.confirmSetup(event); }
  static async _onReturnToSetup(event) { return this.setup.returnToSetup(event); }
  static async _onSaveBattleSnapshot(event) { event.preventDefault(); return this.persistence.saveSnapshot(); }
  static async _onLoadBattleSnapshot(event) { event.preventDefault(); return this.persistence.loadSnapshot(); }
  static async _onDeleteBattleSnapshot(event) { event.preventDefault(); return this.persistence.deleteSnapshot(); }
  static async _onExportBattle(event) { event.preventDefault(); return this.persistence.exportBattle(); }
  static async _onImportBattle(event) { event.preventDefault(); return this.persistence.importBattle(); }
  static async _onClearBattleLog(event) { event.preventDefault(); return this.persistence.clearLog(); }
  static async _onSelectBatteryArc(event, target) {
    event.preventDefault();
    this.selectedBatteryArc = (target ?? event.currentTarget)?.dataset?.arc;
    return this.renderBattleState(["board", "controls"]);
  }
  static _onShowBattleReport(event) {
    event.preventDefault();
    this.layout.showPane("controls");
    const card = this.element?.querySelector(".ssc-battle-report");
    const details = card?.querySelector("details");
    if (details) details.open = true;
    card?.scrollIntoView({ block: "start" });
    card?.focus({ preventScroll: true });
  }
  static _onDismissBattleReport(event) {
    event.preventDefault();
    this.dismissedReportId = (this.renderBattleSnapshot ?? this.battle).lastReport?.id;
    return this.renderBattleState(["board"]);
  }
  static _onShowLayoutPane(event, target) {
    event.preventDefault();
    this.layout.showPane((target ?? event.currentTarget)?.dataset?.pane);
  }
  static async _onNextPhase(event) { event.preventDefault(); return this.phase.nextPhase(); }
  static async _onContinueBattle(event) { event.preventDefault(); return this.phase.continueBattle(); }
  static async _onPassTurn(event) { event.preventDefault(); return this.phase.passTurn(); }
  _clearRoundShipActions(battle) { return this.phase.clearRoundShipActions(battle); }
  _tickReloads(battle) { return this.phase.tickReloads(battle); }
  static async _onOrderBattleSail(event) { event.preventDefault(); return this.orders.setOrder("battleSail"); }
  static async _onOrderPressSail(event) { event.preventDefault(); return this.orders.setOrder("pressSail"); }
  static async _onOrderSteadyGunnery(event) { event.preventDefault(); return this.orders.setOrder("steadyGunnery"); }
  static async _onOrderDamageControl(event) { event.preventDefault(); return this.orders.setOrder("damageControl"); }
  static async _onOrderBoarding(event) { event.preventDefault(); return this.orders.setOrder("boarding"); }
  static async _onOrderBrace(event) { event.preventDefault(); return this.orders.setOrder("brace"); }
  static async _onAssignSelectedShipToPlayer(event, target) { event.preventDefault(); return this.orders.assignSelectedShipToPlayer((target ?? event.currentTarget)?.dataset?.userId); }
  static async _onUnassignSelectedShip(event) { event.preventDefault(); return this.orders.unassignSelectedShip(); }
  static async _onApprovePendingOrder(event, target) { event.preventDefault(); return this.orders.approvePendingOrder((target ?? event.currentTarget)?.dataset?.shipId); }
  static async _onRejectPendingOrder(event, target) { event.preventDefault(); return this.orders.rejectPendingOrder((target ?? event.currentTarget)?.dataset?.shipId); }
  static async _onSetTerrainMode(event, target) { event.preventDefault(); this.setup.setTerrainMode((target ?? event.currentTarget)?.dataset?.terrain); }
  static async _onCancelTerrainMode(event) { return this.setup.cancelTerrainMode(event); }
  static async _onClearAllTerrain(event) { return this.setup.clearAllTerrain(event); }
  static async _onApplyBoardEdits(event) { return this.setup.applyBoardEdits(event); }
  static async _onPickBoardBackground(event) { return this.setup.pickBoardBackground(event); }
  static async _onClearBoardBackground(event) { return this.setup.clearBoardBackground(event); }
  static async _onCycleWindStrength(event) { event.preventDefault(); return this.environment.cycleWindStrength(); }
  static async _onCycleSea(event) { event.preventDefault(); return this.environment.cycleSea(); }
  static async _onCycleVisibility(event) { event.preventDefault(); return this.environment.cycleVisibility(); }
  static async _onRotateWindLeft(event) { event.preventDefault(); return this.environment.rotateWind(-1); }
  static async _onRotateWindRight(event) { event.preventDefault(); return this.environment.rotateWind(1); }
  static async _onFullSail(event) { event.preventDefault(); return this.movement.fullSail(); }
  static async _onReduceSail(event) { event.preventDefault(); return this.movement.reduceSail(); }
  static async _onTurnLeft(event) { event.preventDefault(); return this.movement.turn(-1); }
  static async _onTurnRight(event) { event.preventDefault(); return this.movement.turn(1); }
  static async _onCreatureClimb(event) { event.preventDefault(); return this.creatures.vertical("climb"); }
  static async _onCreatureDive(event) { event.preventDefault(); return this.creatures.vertical("dive"); }
  static async _onCreatureRecoverFall(event) { event.preventDefault(); return this.creatures.recoverFall(); }
  static async _onCoreClimb(event) { event.preventDefault(); return this.movement.coreManeuver("climb"); }
  static async _onCoreDescend(event) { event.preventDefault(); return this.movement.coreManeuver("descend"); }
  static async _onCoreEmergencyDescend(event) { event.preventDefault(); return this.movement.coreManeuver("emergencyDescend"); }
  static async _onCoreImpulse(event) { event.preventDefault(); return this.movement.coreManeuver("impulse"); }
  static async _onCoreShift0(event) { event.preventDefault(); return this.movement.coreManeuver("shift0"); }
  static async _onCoreShift60(event) { event.preventDefault(); return this.movement.coreManeuver("shift60"); }
  static async _onCoreShift120(event) { event.preventDefault(); return this.movement.coreManeuver("shift120"); }
  static async _onCoreShift180(event) { event.preventDefault(); return this.movement.coreManeuver("shift180"); }
  static async _onCoreShift240(event) { event.preventDefault(); return this.movement.coreManeuver("shift240"); }
  static async _onCoreShift300(event) { event.preventDefault(); return this.movement.coreManeuver("shift300"); }
  static async _onCoreModeNormal(event) { event.preventDefault(); return this.movement.setCoreMode("normal"); }
  static async _onCoreModeBoosted(event) { event.preventDefault(); return this.movement.setCoreMode("boosted"); }
  static async _onCoreModeEmergency(event) { event.preventDefault(); return this.movement.setCoreMode("emergency"); }
  static async _onCoreModeShutdown(event) { event.preventDefault(); return this.movement.setCoreMode("shutdown"); }
  static async _onFirePort(event, target) { event.preventDefault(); return this.gunnery.fireArc("port", target ?? event.target?.closest?.("[data-action]")); }
  static async _onFireStarboard(event, target) { event.preventDefault(); return this.gunnery.fireArc("starboard", target ?? event.target?.closest?.("[data-action]")); }
  static async _onFireBow(event, target) { event.preventDefault(); return this.gunnery.fireArc("bow", target ?? event.target?.closest?.("[data-action]")); }
  static async _onFireStern(event, target) { event.preventDefault(); return this.gunnery.fireArc("stern", target ?? event.target?.closest?.("[data-action]")); }
  static async _onFireMortar(event, target) { event.preventDefault(); return this.gunnery.fireArc("mortar", target ?? event.target?.closest?.("[data-action]")); }
  static async _onFireSwivel(event, target) { event.preventDefault(); return this.gunnery.fireArc("swivel", target ?? event.target?.closest?.("[data-action]")); }
  static async _onCreatureAttack(event, target) {
    event.preventDefault();
    return this.creatures.attack((target ?? event.currentTarget)?.dataset?.attackId);
  }
  static async _onCreatureAbility(event, target) { event.preventDefault(); return this.creatures.ability((target ?? event.currentTarget)?.dataset?.abilityId); }
  static async _onCreatureDetach(event) { event.preventDefault(); return this.creatures.detach(); }
  static async _onCreatureAI(event) { event.preventDefault(); return this.creatures.runAI(); }
  static async _onCreatureStopBleeding(event) { event.preventDefault(); return this.creatures.recover("stopBleeding"); }
  static async _onCreatureShakeOff(event) { event.preventDefault(); return this.creatures.recover("shakeOff"); }
  static async _onCreatureExtinguish(event) { event.preventDefault(); return this.creatures.recover("extinguish"); }
  static async _onCreatureRally(event) { event.preventDefault(); return this.creatures.recover("steady"); }
  static async _onCreatureManualDamage(event, target) { event.preventDefault(); const button = target ?? event.currentTarget; return this.creatures.manualDamage(button?.dataset?.sectionId, Number(button?.dataset?.damage ?? 0)); }
  static async _onCrewTask(event, target) {
    event.preventDefault();
    const button = target ?? event.target?.closest?.("[data-action]");
    return this.crew.performTask(button?.dataset?.taskId, button);
  }
  static async _onRepair(event) { event.preventDefault(); return this.crew.repair("auto"); }
  static async _onRepairFire(event) { event.preventDefault(); return this.crew.repair("fire"); }
  static async _onRepairFlooding(event) { event.preventDefault(); return this.crew.repair("flooding"); }
  static async _onRepairSystem(event) { event.preventDefault(); return this.crew.repair("system"); }
  static async _onCoolCrystalCore(event) { event.preventDefault(); return this.crew.repair("crystal"); }
  static async _onRallyCrew(event) { event.preventDefault(); return this.crew.repair("rally"); }
  static async _onAbandonShip(event, target) {
    event.preventDefault();
    const button = target ?? event.target?.closest?.("[data-action]");
    return this.crew.abandonShip(button);
  }
  static async _onManualDamage(event) { event.preventDefault(); return this.crew.manualDamage("damage"); }
  static async _onManualFire(event) { event.preventDefault(); return this.crew.manualDamage("fire"); }
  static async _onManualFlooding(event) { event.preventDefault(); return this.crew.manualDamage("flooding"); }
  static async _onGrapple(event, target) {
    event.preventDefault();
    const button = target ?? event.target?.closest?.("[data-action]");
    return this.crew.boarding("Сцепка", "grapple", button);
  }
  static async _onBoarding(event, target) {
    event.preventDefault();
    const button = target ?? event.target?.closest?.("[data-action]");
    return this.crew.boarding("Абордаж", "board", button);
  }
  static async _onReleaseGrapple(event, target) {
    event.preventDefault();
    const button = target ?? event.target?.closest?.("[data-action]");
    return this.crew.boarding("Разрыв сцепки", "release", button);
  }
  static async _onRepelCreature(event, target) {
    event.preventDefault();
    const button = target ?? event.target?.closest?.("[data-action]");
    return this.crew.repelCreature(button);
  }
  static async _onCycleBoardSize(event) { return this.setup.cycleBoardSize(event); }
  static async _onSetAmmo(event, target) { event.preventDefault(); return this.gunnery.setAmmo(event, target); }
  static async _onSetFireMode(event, target) { event.preventDefault(); return this.gunnery.setFireMode(event, target); }
  static async _onToggleDeployMode(event) { return this.setup.toggleDeployMode(event); }
  static async _onClearTarget(event) { event.preventDefault(); return this.gunnery.clearTarget(); }
  static async _onAimAuto(event) { event.preventDefault(); return this.gunnery.setAim(null); }
  static async _onAimBow(event) { event.preventDefault(); return this.gunnery.setAim("bow"); }
  static async _onAimMidship(event) { event.preventDefault(); return this.gunnery.setAim("midship"); }
  static async _onAimStern(event) { event.preventDefault(); return this.gunnery.setAim("stern"); }
  static async _onAimCrystalCore(event) { event.preventDefault(); return this.gunnery.setAim("crystalCore"); }
  onExternalBattleUpdate({ renderParts = null } = {}) {
    this.renderBattleSnapshot = null;
    this.contextBuilder.invalidate();
    const parts = renderParts?.length ? renderParts : BATTLE_RENDER_PARTS;
    this.renderBattleState(this.movementPlan.pending ? [...new Set([...parts, "board"])] : parts);
  }
}
