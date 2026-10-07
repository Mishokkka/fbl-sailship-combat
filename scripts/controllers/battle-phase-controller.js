import { BattleReportService } from "../services/battle-report-service.js";
import { DECISION_PHASES } from "../utils/constants.js";
import { WindEngine } from "../engine/wind-engine.js";
import { GunneryEngine } from "../engine/gunnery-engine.js";
import { DamageEngine } from "../engine/damage-engine.js";
import { VictoryEngine } from "../engine/victory-engine.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { BoardingEngine } from "../engine/boarding-engine.js";
import { d6 } from "../utils/random.js";
import { BattleScenarioService } from "../services/battle-scenario-service.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { CreatureAttackEngine } from "../engine/creature-attack-engine.js";
import { CreatureAbilityEngine } from "../engine/creature-ability-engine.js";
import { CreatureGrappleEngine } from "../engine/creature-grapple-engine.js";
import { CreatureMovementEngine } from "../engine/creature-movement-engine.js";

export class BattlePhaseController {
  constructor(app) {
    this.app = app;
  }

  getActiveShip(battle) {
    const eligible = this.eligibleShips(battle, battle.phase);
    const active = eligible.find(s => s.id === battle.turn?.activeShipId);
    if (active) return active;
    if (this.isActivationPhase(battle.phase) && battle.turn?.activeShipId === null) return null;
    return eligible[0] ?? null;
  }

  isActivationPhase(phase) {
    return ["orders", "movement", "gunnery", "crew"].includes(phase);
  }

  eligibleShips(battle, phase = battle.phase) {
    return (battle.ships ?? []).filter(unit => CombatantRules.isEligibleForPhase(unit, phase));
  }

  isShipDoneForPhase(battle, shipId, phase) {
    return Boolean(battle.turn?.completed?.[phase]?.includes(shipId));
  }

  getTurnOrder(battle) {
    const phase = battle.phase;
    return this.getShipsInPhaseOrder(battle, phase).map(ship => ({
      id: ship.id,
      name: ship.name,
      side: ship.side,
      sideName: BattleScenarioService.getSideName(battle, ship.side),
      sideColor: BattleScenarioService.getSideColor(battle, ship.side),
      active: battle.turn?.activeShipId === ship.id,
      done: this.isShipDoneForPhase(battle, ship.id, phase),
      initiative: battle.turn?.initiative?.[phase]?.[ship.id] ?? null
    }));
  }

  getShipsInPhaseOrder(battle, phase = battle.phase) {
    const eligible = this.eligibleShips(battle, phase);
    const byId = new Map(eligible.map(s => [s.id, s]));
    const orderedIds = battle.turn?.phaseOrder?.[phase] ?? [];
    const ordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
    const seen = new Set(ordered.map(s => s.id));
    for (const ship of eligible) {
      if (!seen.has(ship.id)) ordered.push(ship);
    }
    return ordered;
  }

  buildPhaseOrder(battle, phase = battle.phase) {
    const initiative = {};
    const ordered = this.eligibleShips(battle, phase)
      .map((ship, index) => {
        const score = this.getInitiativeScore(battle, ship, phase) + d6();
        initiative[ship.id] = score;
        return { ship, index, score };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(entry => entry.ship.id);

    battle.turn ??= {};
    battle.turn.phaseOrder ??= {};
    battle.turn.initiative ??= {};
    battle.turn.phaseOrder[phase] = ordered;
    battle.turn.initiative[phase] = initiative;
    return ordered;
  }

  getInitiativeScore(battle, ship, phase = battle.phase) {
    if (ship?.unitType === "creature") {
      const morale = Number(ship.vitality?.morale ?? 8);
      const moraleMod = morale >= 8 ? 1 : morale <= 3 ? -2 : 0;
      const phaseMod = phase === "movement" ? Number(ship.stats?.handling ?? 0) : phase === "gunnery" ? Math.ceil((ship.attacks?.length ?? 0) / 2) : 0;
      return Number(ship.stats?.handling ?? 0) + Number(ship.stats?.stability ?? 0) + Math.ceil(Number(ship.speed ?? 0) / 2) + moraleMod + phaseMod;
    }
    const point = WindEngine.getPointOfSail(ship, battle.wind);
    const windMod = { inIrons: -4, closeHauled: -1, beamReach: 1, broadReach: 2, running: 0 }[point] ?? 0;
    const order = ship.selectedOrder ?? null;
    const orderMod = phase === "movement" && order === "pressSail" ? 2
      : phase === "gunnery" && order === "steadyGunnery" ? 2
        : phase === "crew" && order === "damageControl" ? 2
          : phase === "crew" && order === "boarding" ? 1
            : 0;
    const morale = Number(ship.crew?.morale ?? 10);
    const moraleMod = morale >= 8 ? 1 : morale <= 3 ? -2 : 0;
    const crystal = ship.crystal ?? {};
    const crystalMod = MovementEngine.usesCore(battle)
      ? (Number(crystal.integrity ?? 1) <= 0 || ship.flags?.falling ? -5 : (Number(crystal.heat ?? 0) >= Number(crystal.maxHeat ?? 10) ? -2 : 0))
      : 0;
    return Number(ship.stats?.crewQuality ?? 0)
      + Number(ship.stats?.handling ?? 0)
      + Math.ceil(Number(ship.speed ?? 0) / 2)
      + windMod
      + orderMod
      + moraleMod
      + crystalMod;
  }

  getShipTurnActions(battle, ship) {
    battle.turn ??= {};
    battle.turn.actions ??= {};
    battle.turn.actions[ship.id] ??= {};
    battle.turn.actions[ship.id][battle.phase] ??= {};
    return battle.turn.actions[ship.id][battle.phase];
  }

  getActionState(battle, ship) {
    const phase = battle.phase;
    const isActive = battle.turn?.activeShipId === ship.id;
    const actions = this.getShipTurnActions(battle, ship);
    const isGM = game.user.isGM;
    const canAct = isGM && Boolean(battle.setupConfirmed) && isActive && !ship.flags?.struck;
    const phaseBudget = this.getPhaseBudget(battle, ship, phase);
    const spentAP = this.getSpentAP(battle, ship, phase);
    const remainingAP = Math.max(0, phaseBudget - spentAP);
    const movementState = phase === "movement"
      ? this.getMovementResolutionState(battle, ship, { checkRoutes: true })
      : { canComplete: true, mustMove: false, needsResolution: false };

    if (ship?.unitType === "creature") {
      const canMovePhase = canAct && phase === "movement" && !ship.flags?.falling && !ship.flags?.attachedTo;
      const inertia = MovementEngine.getInertiaProfile(battle, ship);
      const beforeSpeed = Number(ship.speed ?? 0);
      const increasedSpeed = Math.min(Number(inertia.effectiveMax ?? beforeSpeed), beforeSpeed + Number(inertia.acceleration ?? 1));
      const reducedSpeed = Math.max(0, beforeSpeed - Number(inertia.braking ?? 1));
      const canIncreaseSpeed = canMovePhase && !actions.sail && increasedSpeed > beforeSpeed
        && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: increasedSpeed });
      const canReduceSpeed = canMovePhase && !actions.sail && reducedSpeed < beforeSpeed
        && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: reducedSpeed });
      const canTurn = canMovePhase && !actions.turn && MovementEngine.getTurnLimit(ship) > 0
        && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: beforeSpeed });
      const canVertical = canMovePhase && !actions.vertical
        && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: beforeSpeed });
      const fallRecovery = CreatureMovementEngine.getFallRecoveryProfile(battle, ship);
      const readyAttacks = (ship.attacks ?? []).filter(attack => Number(attack.cooldown ?? 0) <= 0);
      const hasAttackTarget = readyAttacks.some(attack => CreatureAttackEngine.getTargets(battle, ship, attack.id).length > 0);
      const canRecover = canAct && phase === "crew" && remainingAP > 0;
      const activeAbilities = CreatureAbilityEngine.getActiveAbilities(ship, phase)
        .filter(ability => CreatureAbilityEngine.canUse(battle, ship, ability, this.app.selectedTargetId))
        .filter(ability => {
          if (phase !== "movement") return true;
          const resultingSpeed = ability.effect === "dash"
            ? Math.min(Number(ship.maxSpeed ?? beforeSpeed), beforeSpeed + Math.max(1, Number(ability.power ?? 1)))
            : beforeSpeed;
          return this.canSpendMovementPreparation(battle, ship, { resultingSpeed });
        });
      return {
        isActive, phaseBudget, spentAP, remainingAP, movementState, fallRecovery,
        canPass: canAct && this.isActivationPhase(phase) && this.canCompleteActivation(battle, ship, phase),
        canOrder: false,
        canSail: canIncreaseSpeed || canReduceSpeed,
        canIncreaseSpeed,
        canReduceSpeed,
        canTurn,
        canCore: false,
        canMove: canMovePhase && !actions.move && (remainingAP > 0 || movementState.mustMove),
        canCreatureClimb: canVertical && Number(ship.altitude ?? 0) < 8,
        canCreatureDive: canVertical && Number(ship.altitude ?? 0) > 0,
        canCreatureRecoverFall: canAct && phase === "movement" && !actions.recoverFall && remainingAP > 0 && fallRecovery.canAttempt,
        canCreatureAttack: canAct && phase === "gunnery" && !actions.creatureAttack && remainingAP > 0 && hasAttackTarget,
        canCreatureAbility: canAct && remainingAP > 0 && activeAbilities.length > 0,
        canCreatureAI: Boolean(game.user?.isGM && canAct && remainingAP > 0 && ship.behavior?.controlledByAI),
        canCreatureDetach: canAct && phase === "movement" && remainingAP > 0 && CreatureGrappleEngine.isAttached(ship),
        attachedHostId: ship.flags?.attachedTo ?? null,
        canCreatureRecover: canRecover,
        canStopBleeding: canRecover && Number(ship.flags?.bleeding ?? 0) > 0,
        canShakeOff: canRecover && Number(ship.flags?.stunned ?? 0) > 0,
        canExtinguishCreature: canRecover && Boolean(ship.flags?.burning),
        canRallyCreature: canRecover && Number(ship.vitality?.morale ?? 0) > 0 && Number(ship.vitality?.morale ?? 0) < 10,
        canSetup: isGM && !battle.setupConfirmed,
        canManual: isGM,
        actions
      };
    }

    const immobilized = Boolean(ship.flags?.immobilized || DamageEngine.countMastWreckage(ship) >= 2);
    const usesCore = MovementEngine.usesCore(battle);
    const canMovementPrep = canAct && phase === "movement" && !immobilized;
    const inertia = MovementEngine.getInertiaProfile(battle, ship);
    const beforeSpeed = Number(ship.speed ?? 0);
    const increasedSpeed = Math.min(Number(inertia.effectiveMax ?? beforeSpeed), beforeSpeed + Number(inertia.acceleration ?? 1));
    const reducedSpeed = Math.max(0, beforeSpeed - Number(inertia.braking ?? 1));
    const sailAvailable = !ship.flags?.inIrons && WindEngine.getPointOfSail(ship, battle.wind) !== "inIrons";
    const canIncreaseSpeed = canMovementPrep && sailAvailable && !actions.sail && increasedSpeed > beforeSpeed
      && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: increasedSpeed });
    const canReduceSpeed = canMovementPrep && !actions.sail && reducedSpeed < beforeSpeed
      && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: reducedSpeed });
    const canTurn = canMovementPrep && !actions.turn && MovementEngine.getTurnLimit(ship) > 0
      && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: beforeSpeed });
    const canCore = canAct && usesCore && phase === "movement" && !actions.core
      && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: beforeSpeed });
    const modeData = MovementEngine.getCoreModeData(ship);
    const impulseSpeed = Math.min(MovementEngine.getEffectiveMaxSpeed(battle, ship) + Number(modeData.impulseBonus ?? 1), beforeSpeed + Number(modeData.impulseBonus ?? 1));
    const canCoreImpulse = canAct && usesCore && phase === "movement" && !actions.core
      && this.canSpendMovementPreparation(battle, ship, { resultingSpeed: impulseSpeed });
    const canGunnery = canAct && phase === "gunnery" && !actions.gunnery && remainingAP > 0;
    const arcAvailable = arc => canGunnery && GunneryEngine.getTargets(battle, ship, arc, { aimedSection: this.app.aimSection }).length > 0;
    const canCrew = canAct && phase === "crew" && remainingAP > 0;
    const crewActions = this.getCrewActionState(battle, ship, canCrew);
    return {
      isActive,
      phaseBudget,
      spentAP,
      remainingAP,
      movementState,
      canPass: canAct && this.isActivationPhase(phase) && this.canCompleteActivation(battle, ship, phase),
      canOrder: canAct && phase === "orders" && !actions.order && remainingAP > 0,
      canSail: canIncreaseSpeed || canReduceSpeed,
      canIncreaseSpeed,
      canReduceSpeed,
      canTurn,
      canCore,
      canCoreImpulse,
      canMove: canAct && phase === "movement" && !actions.move && !immobilized && (remainingAP > 0 || movementState.mustMove),
      canGunnery,
      canFirePort: arcAvailable("port"),
      canFireStarboard: arcAvailable("starboard"),
      canFireBow: arcAvailable("bow"),
      canFireStern: arcAvailable("stern"),
      canFireMortar: arcAvailable("mortar"),
      canFireSwivel: arcAvailable("swivel"),
      canCrew,
      ...crewActions,
      canSetup: isGM && !battle.setupConfirmed,
      canManual: isGM,
      actions
    };
  }

  getCrewActionState(battle, ship, canCrew) {
    const sections = Object.values(ship?.sections ?? {});
    const fire = sections.reduce((sum, section) => sum + Number(section.fire ?? 0), 0);
    const flooding = sections.reduce((sum, section) => sum + Number(section.flooding ?? 0), 0);
    const breaches = sections.reduce((sum, section) => sum + Number(section.breaches ?? 0), 0);
    const mastWreckage = sections.reduce((sum, section) => sum + Number(section.mastWreckage ?? 0), 0);
    const damagedSystems = sections.flatMap(section => section.systems ?? []).filter(system => system.status === "damaged").length;
    const crystal = ship?.crystal ?? {};
    const crystalHeat = Number(crystal.heat ?? 0);
    const crystalIntegrity = Number(crystal.integrity ?? crystal.maxIntegrity ?? 0);
    const crystalMaxIntegrity = Number(crystal.maxIntegrity ?? crystalIntegrity);
    const crewCurrent = Number(ship?.crew?.current ?? 0);
    const crewRequired = Number(ship?.crew?.required ?? 0);
    const crewPercent = crewRequired > 0 ? Math.round((crewCurrent / crewRequired) * 100) : 100;
    const morale = Number(ship?.crew?.morale ?? 10);
    const usesCore = MovementEngine.usesCore(battle);
    const rescueRatio = ship?.flags?.uncontrolledFire || (DamageEngine.isOnWater(ship) && flooding >= 10) || (usesCore && ship?.flags?.falling) ? 0.45 : 0.75;
    const rescueEstimate = Math.floor(crewCurrent * rescueRatio);
    const repairAmount = ship?.selectedOrder === "damageControl" ? 2 : 1;
    const systemRepair = ship?.selectedOrder === "damageControl" ? 4 : 2;
    const grappledWith = BoardingEngine.getGrappledWith(ship);
    const grappledTarget = grappledWith ? battle.ships.find(s => s.id === grappledWith) : null;
    const selectedTarget = battle.ships.find(s => s.id === this.app.selectedTargetId) ?? null;
    const ownBoardingPower = BoardingEngine.getBoardingPower(ship);
    const grappledTargetPower = grappledTarget ? BoardingEngine.getBoardingPower(grappledTarget) : null;
    const selectedTargetText = selectedTarget
      ? `${selectedTarget.name}, H${Number(selectedTarget.altitude ?? 0)}, сторона ${BattleScenarioService.getSideName(battle, selectedTarget.side)}`
      : "цель не выбрана";
    const grappledTargetText = grappledTarget
      ? `${grappledTarget.name}, сила ${grappledTargetPower}, H${Number(grappledTarget.altitude ?? 0)}`
      : "нет сцепки";
    const canGrappleNow = Boolean(canCrew && BoardingEngine.canGrapple(ship, selectedTarget));
    const canBoardNow = Boolean(canCrew && grappledTarget && grappledTarget.side !== ship.side);
    const canReleaseNow = Boolean(canCrew && grappledTarget);
    const attachedCreatures = CreatureGrappleEngine.getAttachedCreatures(battle, ship);

    return {
      canRepairAuto: Boolean(canCrew && (fire > 0 || flooding > 0 || breaches > 0 || damagedSystems > 0 || mastWreckage > 0)),
      canRepairFire: Boolean(canCrew && fire > 0),
      canRepairFlooding: Boolean(canCrew && (flooding > 0 || breaches > 0)),
      canRepairSystem: Boolean(canCrew && (damagedSystems > 0 || mastWreckage > 0)),
      canCoolCrystalCore: Boolean(canCrew && usesCore && !ship?.flags?.coreExploded && (crystalHeat > 0 || crystalIntegrity < crystalMaxIntegrity)),
      canRallyCrew: Boolean(canCrew && morale > 0 && morale < 10),
      canAbandonShip: Boolean(canCrew && !ship?.flags?.abandoned),
      canGrappleAction: canGrappleNow,
      canBoardAction: canBoardNow,
      canReleaseGrappleAction: canReleaseNow,
      canRepelCreature: Boolean(canCrew && attachedCreatures.length),
      attachedCreatureCount: attachedCreatures.length,
      repairTitle: `Авто-ремонт: тушит пожар на ${repairAmount}, затем помпы/пробоины на ${repairAmount}, затем чинит поврежденную систему или разбирает обломки. Стоимость 1 ОД экипажа. Сейчас: пожар ${fire}, вода ${flooding}, пробоины ${breaches}, системы ${damagedSystems}, завалы ${mastWreckage}.`,
      repairFireTitle: `Тушение пожара: пожар -${repairAmount} в первой горящей секции. Стоимость 1 ОД. Сейчас: пожар ${fire}.`,
      repairFloodingTitle: `Помпы и плотники: затопление или сухие пробоины -${repairAmount}. Стоимость 1 ОД. Сейчас: вода ${flooding}, пробоины ${breaches}; в воздухе пробоины не дают воду до H0.`,
      repairSystemTitle: `Ремонт системы: сначала расчистка обломков рангоута -1, затем HP поврежденной системы +${systemRepair}; при подъеме выше половины HP система снова цела. Стоимость 1 ОД. Сейчас: поврежденных систем ${damagedSystems}, завалов ${mastWreckage}.`,
      coolCrystalTitle: `Охлаждение ядра: нагрев -3, или -4 при приказе «Аварийные партии». Стоимость 1 ОД. Сейчас: нагрев ${crystalHeat}/${crystal.maxHeat ?? "?"}, целостность ${crystalIntegrity}/${crystalMaxIntegrity}.`,
      rallyCrewTitle: `Сбор команды: мораль +1, или +2 при приказе «Аварийные партии» либо если экипаж не ниже 75% штата. Стоимость 1 ОД. Сейчас: мораль ${morale}/10, экипаж ${crewCurrent}/${crewRequired} (${crewPercent}%).`,
      abandonShipTitle: `Оставить корабль: судно сразу выходит из боя, экипаж пытается спастись. Стоимость 1 ОД. Сейчас: прогноз спасенных около ${rescueEstimate}/${crewCurrent}.`,
      grappleTitle: `Сцепка: цель должна быть врагом в соседней клетке, на той же высоте и не уже сцепленной. Стоимость 1 ОД; оба корабля теряют ход. Сейчас: ${selectedTargetText}.`,
      boardingTitle: `Абордаж: нужен уже сцепленный вражеский корабль. Сила = экипаж/25 + мораль-5 + качество экипажа + приказ. Стоимость 1 ОД. Сейчас: ваша сила ${ownBoardingPower}; цель: ${grappledTargetText}.`,
      releaseGrappleTitle: `Разорвать сцепку с текущим сцепленным кораблем. Стоимость 1 ОД экипажа. Сейчас: ${grappledTargetText}.`,
      repelCreatureTitle: attachedCreatures.length ? `Отбить чудовище от корпуса. Стоимость 1 ОД экипажа. На корабле: ${attachedCreatures.map(c => c.name).join(", ")}.` : "На корпусе нет чудовищ."
    };
  }

  canShowMovement(battle, ship) {
    if (!ship || battle.phase !== "movement" || battle.turn?.activeShipId !== ship.id) return false;
    const actions = this.getShipTurnActions(battle, ship);
    if (actions.move) return false;
    const state = this.getMovementResolutionState(battle, ship, { checkRoutes: false });
    return this.getRemainingAP(battle, ship, "movement") > 0 || state.mustMove;
  }

  requireActivePhase(battle, ship, phase, label) {
    if (!game.user.isGM) {
      ui.notifications.warn(`${label} пока доступно только ГМу.`);
      return false;
    }
    if (!ship) return false;
    if (battle.phase !== phase) {
      ui.notifications.warn(`${label}: сейчас фаза «${game.i18n.localize(`SAILSHIPS.PhaseLabels.${battle.phase}`) || battle.phase}».`);
      return false;
    }
    if (battle.turn?.activeShipId !== ship.id) {
      const active = this.getActiveShip(battle);
      ui.notifications.warn(`${label}: сейчас ходит ${active?.name ?? "другая боевая единица"}.`);
      return false;
    }
    if (ship.flags?.struck) {
      ui.notifications.warn(`${ship.name} выбыл из боя.`);
      return false;
    }
    return true;
  }

  getPhaseBudget(battle, ship, phase = battle.phase) {
    if (!this.isActivationPhase(phase)) return 0;
    if (ship?.unitType === "creature") {
      if (phase === "orders") return 0;
      return phase === "movement" ? 2 : 1;
    }
    let budget = phase === "movement" ? 2 : 1;
    const order = ship?.selectedOrder ?? null;
    if (phase === "movement" && order === "pressSail") budget += 1;
    if (phase === "movement" && ["damageControl", "brace", "boarding"].includes(order)) budget -= 1;
    if (phase === "crew" && order === "damageControl") budget += 1;
    if (phase === "crew" && order === "boarding") budget += 1;
    if (ship?.flags?.grappledWith && phase === "movement") budget = 1;
    if (ship?.flags?.inIrons && phase === "movement") budget = Math.min(budget, 1);
    return Math.max(1, budget);
  }

  getSpentAP(battle, ship, phase = battle.phase) {
    const actions = this.getShipTurnActions(battle, ship);
    return Number(actions._apSpent ?? 0);
  }

  getRemainingAP(battle, ship, phase = battle.phase) {
    return Math.max(0, this.getPhaseBudget(battle, ship, phase) - this.getSpentAP(battle, ship, phase));
  }

  getMovementResolutionState(battle, ship, { checkRoutes = false, speed = null } = {}) {
    if (!ship || battle?.phase !== "movement") {
      return { needsResolution: false, mustMove: false, canComplete: true, hasLegalMove: false, requiredAdvance: 0, speed: 0, rawSpeed: 0 };
    }
    return MovementEngine.getHorizontalResolutionState(battle, ship, {
      actions: this.getShipTurnActions(battle, ship),
      checkRoutes,
      speed
    });
  }

  canCompleteActivation(battle, ship, phase = battle.phase) {
    if (!ship || !this.isActivationPhase(phase)) return false;
    if (phase !== "movement") return true;
    return this.getMovementResolutionState(battle, ship, { checkRoutes: true }).canComplete;
  }

  canSpendMovementPreparation(battle, ship, { cost = 1, resultingSpeed = null } = {}) {
    if (!ship || battle?.phase !== "movement") return this.getRemainingAP(battle, ship, battle?.phase) >= cost;
    const remaining = this.getRemainingAP(battle, ship, "movement");
    if (remaining < cost) return false;
    const state = this.getMovementResolutionState(battle, ship, {
      checkRoutes: false,
      speed: resultingSpeed == null ? Number(ship.speed ?? 0) : Number(resultingSpeed)
    });
    return !state.mustMove || remaining - cost >= 1;
  }

  markTurnAction(battle, ship, action, cost = 1) {
    const actions = this.getShipTurnActions(battle, ship);
    if (actions[action]) return false;
    actions._apSpent = Number(actions._apSpent ?? 0);
    const forcedMove = action === "move" && cost === 0 && battle.phase === "movement"
      && this.getMovementResolutionState(battle, ship).mustMove;
    if (!forcedMove && actions._apSpent + cost > this.getPhaseBudget(battle, ship, battle.phase)) return false;
    actions[action] = true;
    actions._apSpent += cost;
    return true;
  }

  refundTurnAction(battle, ship, action, cost = 1) {
    const actions = this.getShipTurnActions(battle, ship);
    if (!actions[action]) return;
    delete actions[action];
    actions._apSpent = Math.max(0, Number(actions._apSpent ?? 0) - cost);
  }

  async completeIfNoAP(battle, ship, phase = battle.phase) {
    if (!this.isActivationPhase(phase) || this.getRemainingAP(battle, ship, phase) > 0) return false;
    if (phase === "movement") {
      const actions = this.getShipTurnActions(battle, ship);
      const resolution = MovementEngine.resolveHorizontalCompletion(battle, ship, { actions });
      if (!resolution.ok) return false;
      if (resolution.text) this.app._addLog(battle, resolution.text);
    }
    this.completeShipActivation(battle, ship, phase);
    const next = this.getActiveShip(battle);
    if (next) {
      this.app.selectedShipId = next.id;
      this.app._addLog(battle, `Ход боевой единицы: ${next.name}.`);
    } else {
      this.app._addLog(battle, `Все боевые единицы завершили фазу. Можно перейти дальше.`);
    }
    return true;
  }

  completeShipActivation(battle, ship, phase = battle.phase) {
    if (!this.isActivationPhase(phase) || !ship) return false;
    if (phase === "movement") {
      const actions = this.getShipTurnActions(battle, ship);
      const resolution = MovementEngine.resolveHorizontalCompletion(battle, ship, { actions });
      if (!resolution.ok) return false;
      if (resolution.text) this.app?._addLog?.(battle, resolution.text);
    }
    battle.turn ??= {};
    battle.turn.completed ??= {};
    battle.turn.completed[phase] ??= [];
    if (!battle.turn.completed[phase].includes(ship.id)) battle.turn.completed[phase].push(ship.id);
    this.advanceActiveShip(battle, phase);
    return true;
  }

  advanceActiveShip(battle, phase = battle.phase) {
    battle.turn ??= {};
    if (!this.isActivationPhase(phase)) {
      battle.turn.activeShipId = this.eligibleShips(battle, phase)[0]?.id ?? null;
      return;
    }
    const done = new Set(battle.turn?.completed?.[phase] ?? []);
    const next = this.getShipsInPhaseOrder(battle, phase).find(s => !done.has(s.id));
    battle.turn.activeShipId = next?.id ?? null;
  }

  startPhase(battle, phase) {
    for (const ship of battle.ships ?? []) if (ship.unitType !== "creature") WindEngine.syncInIronsFlag(ship, battle.wind ?? {});
    battle.phase = phase;
    battle.turn ??= {};
    battle.turn.actions = {};
    if (phase === "movement") battle.turn.movementReservations = {};
    if (phase !== "orders") battle.pendingOrders = {};
    battle.turn.completed ??= {};
    battle.turn.completed[phase] = [];
    if (this.isActivationPhase(phase)) {
      this.buildPhaseOrder(battle, phase);
      this.advanceActiveShip(battle, phase);
    } else {
      battle.turn.activeShipId = this.eligibleShips(battle, phase)[0]?.id ?? null;
    }
  }

  getPhaseFlags(battle) {
    const phase = battle.phase;
    const confirmed = Boolean(battle.setupConfirmed);
    return {
      orders: confirmed && phase === "orders",
      movement: confirmed && phase === "movement",
      gunnery: confirmed && phase === "gunnery",
      damage: confirmed && ["crew", "damage", "end"].includes(phase),
      crew: confirmed && phase === "crew",
      end: confirmed && phase === "end",
      showTurnBox: confirmed && this.isActivationPhase(phase),
      showSetup: Boolean(game.user.isGM && !confirmed),
      showStorage: Boolean(game.user.isGM && (!confirmed || ["crew", "end"].includes(phase))),
      showTargets: confirmed && (phase === "gunnery" || phase === "crew"),
      showSections: confirmed && (phase === "damage" || phase === "crew" || phase === "end"),
      showWeapons: confirmed && (phase === "gunnery" || phase === "orders" || phase === "end")
    };
  }

  clearRoundShipActions(battle) {
    battle.turn ??= {};
    battle.turn.actions = {};
    battle.turn.phaseOrder = {};
    battle.turn.initiative = {};
    battle.turn.movementReservations = {};
    battle.turn.completed = {
      orders: [],
      movement: [],
      gunnery: [],
      damage: [],
      crew: [],
      end: []
    };
    battle.pendingOrders = {};
    for (const ship of battle.ships ?? []) {
      ship.selectedOrder = null;
      ship.turn ??= {};
      ship.turn.round = battle.round;
      ship.turn.actions = {};
      if (ship.flags) {
        delete ship.flags.suppressed;
        delete ship.flags.sharpManeuver;
      }
    }
  }

  tickReloads(battle) {
    for (const ship of battle.ships) {
      for (const weapon of ship.weapons ?? []) weapon.reload = Math.max(0, Number(weapon.reload ?? 0) - 1);
      for (const attack of ship.attacks ?? []) attack.cooldown = Math.max(0, Number(attack.cooldown ?? 0) - 1);
      if (ship.unitType === "creature") {
        for (const text of CreatureAbilityEngine.advanceEndOfRound(ship)) this.app?._addLog?.(battle, text);
      }
    }
  }


  async nextPhase() {
    if (!game.user.isGM) return ui.notifications.warn("Фазы боя переключает ГМ.");
    if (this.busy) return false;
    const shown = this.app.renderBattleSnapshot ?? this.app.battle;
    const request = { id: shown.id, revision: shown.revision, round: shown.round, phase: shown.phase };
    this.busy = true;
    let applied = false;
    try {
      const saved = await this.app._updateBattleAndRender(battle => {
        if (battle.id !== request.id || battle.revision !== request.revision
          || battle.round !== request.round || battle.phase !== request.phase) {
          ui.notifications.warn("Бой изменился. Проверьте текущую фазу и повторите действие.");
          return false;
        }
        if (!battle.setupConfirmed || battle.outcome?.resolved) return false;
        if (this.isActivationPhase(battle.phase) && this.getActiveShip(battle)) {
          ui.notifications.warn("Сначала завершите активации всех участников этой фазы.");
          return false;
        }
        const next = this.nextPhaseId(battle.phase);
        const endsRound = ["crew", "end"].includes(battle.phase);
        const before = endsRound ? BattleReportService.capture(battle) : null;
        const previousLogIds = new Set((battle.log ?? []).map(entry => entry.id));
        const report = () => BattleReportService.record(battle, before, {
          kind: "round", round: request.round, title: "Итоги раунда " + request.round,
          details: (battle.log ?? []).filter(entry => !previousLogIds.has(entry.id)).map(entry => entry.text)
        });

        if (endsRound) {
          // Keep the legacy end marker during settlement, including a resolved victory.
          battle.phase = "end";
          this.tickReloads(battle);
          for (const text of MovementEngine.advanceEndOfRoundMovement(battle)) this.app._addLog(battle, text);
          const movementStrikeEntries = [];
          for (const ship of battle.ships ?? []) DamageEngine.checkStruck(ship, movementStrikeEntries);
          for (const text of movementStrikeEntries) this.app._addLog(battle, text);
          for (const text of DamageEngine.advanceOngoingDamage(battle)) this.app._addLog(battle, text);
          for (const text of VictoryEngine.processWithdrawals(battle)) this.app._addLog(battle, text);
          const outcome = VictoryEngine.evaluate(battle);
          if (outcome.resolved) {
            this.clearRoundShipActions(battle);
            outcome.timestamp = Date.now();
            battle.outcome = outcome;
            battle.turn.activeShipId = null;
            this.app._addLog(battle, outcome.title + ". " + outcome.summary);
            report();
            applied = true;
            return true;
          }
          battle.round += 1;
          this.clearRoundShipActions(battle);
        }

        this.startPhase(battle, next);
        const timestamp = Date.now();
        battle.lastAudioEvent = { id: "audio-phase-" + battle.round + "-" + next + "-" + timestamp, type: "phase", shipId: null, timestamp };
        const active = this.getActiveShip(battle);
        this.app._addLog(battle, "Фаза боя: " + game.i18n.localize("SAILSHIPS.PhaseLabels." + next) + ".");
        const orderText = this.getTurnOrder(battle).map(unit => unit.name + (unit.initiative != null ? " (" + unit.initiative + ")" : "")).join(" → ");
        if (orderText) this.app._addLog(battle, "Очередность фазы: " + orderText + ".");
        if (active) this.app._addLog(battle, "Ход боевой единицы: " + active.name + ".");
        if (endsRound) report();
        applied = true;
        return true;
      }, { reason: "next-phase", renderParts: [] });
      if (applied && saved?.id === request.id && saved.revision > request.revision
        && (saved.phase !== request.phase || saved.round !== request.round || saved.outcome?.resolved)) {
        this.app.selectedShipId = this.getActiveShip(saved)?.id ?? this.app.selectedShipId;
        this.app.selectedTargetId = null;
        this.app.aimSection = null;
        this.app.deployMode = false;
        this.app.terrainMode = null;
        return true;
      }
      if (applied) ui.notifications.warn("Переход не сохранён. Проверьте состояние боя.");
      return false;
    } catch (error) {
      this.app.renderBattleSnapshot = null;
      ui.notifications.error("Не удалось сохранить переход. Проверьте состояние боя перед повтором.");
      console.error("Sailships Combat | Phase transition failed", error);
      return false;
    } finally {
      this.busy = false;
      await this.app.renderBattleState();
    }
  }

  async continueBattle() {
    if (!game.user.isGM) return ui.notifications.warn("Продолжить завершённый бой может только ГМ.");
    await this.app._updateBattleAndRender(battle => {
      if (!battle.outcome?.resolved) return false;
      battle.setup ??= {};
      battle.setup.victory = VictoryEngine.normalizeConfig(battle.setup.victory, battle.setup.sideOrder ?? []);
      battle.setup.victory.roundLimit = Math.max(Number(battle.setup.victory.roundLimit ?? 30) + 5, Number(battle.round ?? 1) + 5);
      battle.setup.victory.deferUntilRound = Number(battle.round ?? 1) + 5;
      delete battle.outcome;
      if (battle.phase === "end") battle.round += 1;
      this.clearRoundShipActions(battle);
      this.startPhase(battle, "orders");
      const timestamp = Date.now();
      battle.lastAudioEvent = { id: `audio-phase-${battle.round}-orders-${timestamp}`, type: "phase", shipId: null, timestamp };
      const active = this.getActiveShip(battle);
      this.app.selectedShipId = active?.id ?? this.app.selectedShipId;
      this.app.selectedTargetId = null;
      this.app._addLog(battle, `ГМ продолжает бой. Новый лимит: ${battle.setup.victory.roundLimit} раундов.`);
    }, { reason: "continue-battle" });
  }

  async passTurn() {
    if (!game.user.isGM) return ui.notifications.warn("Ход боевой единицы завершает ГМ.");
    await this.app._updateBattleAndRender(battle => {
      if (!this.isActivationPhase(battle.phase)) {
        ui.notifications.warn("В этой фазе нет очередности боевых единиц.");
        return false;
      }
      const ship = this.getActiveShip(battle);
      if (!ship) {
        ui.notifications.warn("Нет активной боевой единицы.");
        return false;
      }
      if (battle.phase === "movement") {
        const actions = this.getShipTurnActions(battle, ship);
        const resolution = MovementEngine.resolveHorizontalCompletion(battle, ship, { actions });
        if (!resolution.ok) {
          ui.notifications.warn(resolution.text);
          return false;
        }
        if (resolution.text) this.app._addLog(battle, resolution.text);
      }
      this.app._addLog(battle, `${ship.name}: завершает действие в фазе «${game.i18n.localize(`SAILSHIPS.PhaseLabels.${battle.phase}`) || battle.phase}».`);
      this.completeShipActivation(battle, ship, battle.phase);
      const next = this.getActiveShip(battle);
      if (next) {
        this.app.selectedShipId = next.id;
        this.app._addLog(battle, `Ход боевой единицы: ${next.name}.`);
      } else {
        this.app._addLog(battle, "Все боевые единицы завершили фазу. Можно перейти дальше.");
      }
      this.app.selectedTargetId = null;
    }, { reason: "pass-turn" });
  }

  nextPhaseId(currentPhase) {
    if (currentPhase === "damage") return "crew";
    if (currentPhase === "end") return "orders";
    const index = DECISION_PHASES.indexOf(currentPhase);
    return DECISION_PHASES[(index + 1) % DECISION_PHASES.length];
  }
}
