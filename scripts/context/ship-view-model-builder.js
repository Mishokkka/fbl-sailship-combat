import { cellToPixel, normalizeAngle } from "../board/board-geometry.js";
import { ALTITUDE_BAND_METERS, ORDER_LABELS } from "../utils/constants.js";
import { PlayerControlService } from "../services/player-control-service.js";
import { CombatantRules } from "../rules/combatant-rules.js";

export class ShipViewModelBuilder {
  constructor(app) {
    this.app = app;
  }

  prepareShipToken(battle, ship, cellSize, selectedShip, targetIds) {
    const app = this.app;
    const center = cellToPixel(battle.board, ship.x, ship.y);
    const isCreature = ship.unitType === "creature";
    const canViewDetails = PlayerControlService.canViewShipDetails(battle, game.user, ship.id);
    const hp = canViewDetails ? this.shipHp(ship) : { value: "?", max: "?", pct: 0 };
    const rawStatus = this.getShipStatus(ship);
    const status = canViewDetails ? rawStatus : this.getPublicStatus(rawStatus, { isCreature });
    const showAltitudeCore = !isCreature && canViewDetails && battle?.setup?.mode !== "sea";
    const reloads = canViewDetails
      ? isCreature
        ? (ship.attacks ?? []).filter(attack => Number(attack.cooldown ?? 0) > 0).length
        : (ship.weapons ?? []).filter(weapon => Number(weapon.reload ?? 0) > 0).length
      : 0;
    const renderHeading = normalizeAngle(Number(ship.heading ?? 0) - 90);
    const assignedUserId = PlayerControlService.getAssignedUserId(battle, ship.id);
    const assignedUser = assignedUserId ? game.users?.get?.(assignedUserId) : null;
    const pendingOrder = battle.pendingOrders?.[ship.id] ?? null;
    const assignedToCurrentUser = Boolean(game.user?.id && PlayerControlService.userControlsShip(battle, game.user.id, ship.id));
    const canShowAssignment = Boolean(game.user?.isGM || assignedToCurrentUser);
    const side = battle.setup?.sides?.[ship.side] ?? {};
    const silhouette = String(ship.token?.silhouette ?? "beast");
    const tokenImage = String(ship.token?.img ?? "").trim();
    const operational = CombatantRules.isOperational(ship);
    const attached = Boolean(isCreature && ship.flags?.attachedTo);
    const attachedHost = attached ? battle.ships?.find?.(unit => unit.id === ship.flags.attachedTo) ?? null : null;
    const renderOffset = attached ? cellSize * 0.22 : 0;
    const attachedCreatureCount = !isCreature && Array.isArray(ship.flags?.attachedCreatureIds) ? ship.flags.attachedCreatureIds.length : 0;
    return {
      ...ship,
      unitType: isCreature ? "creature" : "ship",
      isCreature,
      isShip: !isCreature,
      operational,
      rulesPending: !operational,
      cx: center.cx + renderOffset,
      cy: center.cy - renderOffset,
      length: cellSize * 0.92,
      width: cellSize * 0.36,
      selected: selectedShip?.id === ship.id,
      targetable: operational && targetIds.has(ship.id),
      active: operational && battle.turn?.activeShipId === ship.id,
      phaseDone: operational && app._isShipDoneForPhase(battle, ship.id, battle.phase),
      isTarget: app.selectedTargetId === ship.id,
      hp,
      hpWidth: Math.round(hp.pct * 0.52),
      status,
      showAltitudeCore,
      reloads,
      canViewDetails,
      sideName: side.name ?? ship.side,
      sideColor: side.color ?? "#777777",
      orderLabel: !isCreature && canViewDetails && ship.selectedOrder ? (game.i18n.localize(`SAILSHIPS.Orders.${ship.selectedOrder}`) || ship.selectedOrder) : "",
      assignedUserId,
      assignedUserName: canShowAssignment ? assignedUser?.name ?? assignedUserId ?? "" : "",
      assignedToCurrentUser,
      pendingOrderLabel: !isCreature && canViewDetails && pendingOrder ? ORDER_LABELS[pendingOrder.order] ?? pendingOrder.order : "",
      contactLabel: {
        detected: "Обнаружен",
        identified: "Опознан",
        lost: "Последняя известная позиция"
      }[ship.contactState] ?? "",
      crewPct: canViewDetails ? this.percent(isCreature ? ship.vitality?.current : ship.crew?.current, isCreature ? ship.vitality?.max : ship.crew?.required) : 0,
      moralePct: canViewDetails ? this.percent(isCreature ? ship.vitality?.morale : ship.crew?.morale, 10) : 0,
      renderHeading,
      counterHeading: -renderHeading,
      struck: Boolean(ship.flags?.struck),
      withdrawn: Boolean(ship.flags?.withdrawn),
      grappled: Boolean(ship.flags?.grappledWith),
      attached,
      attachedHostId: attachedHost?.id ?? null,
      attachedHostName: attachedHost?.name ?? "",
      attachedCreatureCount,
      camouflaged: Boolean(isCreature && Number(ship.flags?.camouflaged ?? 0) > 0),
      tokenImage,
      hasTokenImage: Boolean(tokenImage),
      tokenScale: Number(ship.token?.scale ?? 1),
      tokenTint: String(ship.token?.tint ?? "#d7d4c7"),
      tokenShowName: ship.token?.showName !== false,
      silhouetteBird: silhouette === "bird",
      silhouetteRay: silhouette === "ray",
      silhouetteJelly: silhouette === "jelly",
      silhouetteSwarm: silhouette === "swarm",
      silhouetteBeast: !["bird", "ray", "jelly", "swarm"].includes(silhouette)
    };
  }

  getPublicStatus(status, { isCreature = false } = {}) {
    if (isCreature) {
      return {
        vitality: 0,
        vitalityMax: 0,
        morale: 0,
        bleeding: 0,
        stunned: 0,
        burning: false,
        camouflaged: false,
        attachedTo: null,
        altitude: status.altitude,
        altitudeMeters: status.altitudeMeters,
        falling: Boolean(status.falling),
        abandoned: false
      };
    }
    return {
      fire: 0,
      flooding: 0,
      breaches: 0,
      mastWreckage: 0,
      damagedSystems: 0,
      destroyedSystems: 0,
      coreHeat: 0,
      coreMaxHeat: 0,
      coreIntegrity: 0,
      coreMaxIntegrity: 0,
      coreHeatState: "stable",
      altitude: status.altitude,
      altitudeMeters: status.altitudeMeters,
      verticalVelocity: 0,
      coreMode: "unknown",
      falling: Boolean(status.falling),
      coreExploded: Boolean(status.coreExploded),
      dishonorableCoreTargeted: false,
      immobilized: false,
      uncontrolledFire: false,
      abandoned: Boolean(status.abandoned)
    };
  }

  shipHp(ship) {
    if (ship?.unitType === "creature") {
      const value = Number(ship.vitality?.current ?? 0);
      const max = Number(ship.vitality?.max ?? 0);
      return { value, max, pct: max ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0 };
    }
    let value = 0;
    let max = 0;
    for (const section of Object.values(ship.sections ?? {})) {
      value += Number(section.hp?.value ?? 0);
      max += Number(section.hp?.max ?? 0);
    }
    return { value, max, pct: max ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0 };
  }

  getShipStatus(ship) {
    if (ship?.unitType === "creature") {
      return {
        vitality: Number(ship.vitality?.current ?? 0),
        vitalityMax: Number(ship.vitality?.max ?? 0),
        morale: Number(ship.vitality?.morale ?? 0),
        bleeding: Number(ship.flags?.bleeding ?? 0),
        stunned: Number(ship.flags?.stunned ?? 0),
        burning: Boolean(ship.flags?.burning),
        camouflaged: Number(ship.flags?.camouflaged ?? 0),
        attachedTo: ship.flags?.attachedTo ?? null,
        altitude: Number(ship.altitude ?? 0),
        altitudeMeters: Number(ship.altitude ?? 0) * ALTITUDE_BAND_METERS,
        verticalVelocity: Number(ship.verticalVelocity ?? 0),
        falling: Boolean(ship.flags?.falling),
        abandoned: false
      };
    }

    let fire = 0;
    let flooding = 0;
    let breaches = 0;
    let mastWreckage = 0;
    let damagedSystems = 0;
    let destroyedSystems = 0;
    for (const section of Object.values(ship.sections ?? {})) {
      fire += Number(section.fire ?? 0);
      flooding += Number(section.flooding ?? 0);
      breaches += Number(section.breaches ?? 0);
      mastWreckage += Number(section.mastWreckage ?? 0);
      for (const system of section.systems ?? []) {
        if (system.status === "damaged") damagedSystems += 1;
        if (system.status === "destroyed") destroyedSystems += 1;
      }
    }
    const core = ship.crystal ?? {};
    const coreHeat = Number(core.heat ?? 0);
    const coreMaxHeat = Number(core.maxHeat ?? 10);
    const coreIntegrity = Number(core.integrity ?? 0);
    const coreMaxIntegrity = Number(core.maxIntegrity ?? 1);
    const coreHeatState = coreHeat >= coreMaxHeat + 3 ? "critical" : coreHeat >= coreMaxHeat ? "hot" : coreHeat >= Math.ceil(coreMaxHeat * 0.6) ? "warm" : "stable";
    return {
      fire,
      flooding,
      breaches,
      mastWreckage,
      damagedSystems,
      destroyedSystems,
      coreHeat,
      coreMaxHeat,
      coreIntegrity,
      coreMaxIntegrity,
      coreHeatState,
      altitude: Number(ship.altitude ?? 0),
      altitudeMeters: Number(ship.altitude ?? 0) * ALTITUDE_BAND_METERS,
      verticalVelocity: Number(ship.verticalVelocity ?? 0),
      coreMode: String(core.mode ?? "normal"),
      falling: Boolean(ship.flags?.falling),
      coreExploded: Boolean(ship.flags?.coreExploded),
      dishonorableCoreTargeted: Boolean(ship.flags?.dishonorableCoreTargeted),
      immobilized: Boolean(ship.flags?.immobilized),
      uncontrolledFire: Boolean(ship.flags?.uncontrolledFire),
      abandoned: Boolean(ship.flags?.abandoned)
    };
  }

  percent(value, max) {
    value = Number(value ?? 0);
    max = Number(max ?? 1);
    if (!max) return 0;
    return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  }
}
