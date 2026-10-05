import { PHASES } from "../utils/constants.js";
import { PlayerControlService } from "./player-control-service.js";
import { VisibilityEngine } from "../engine/visibility-engine.js";
import { getCombatants } from "../utils/combatants.js";

function clone(value) {
  if (value == null) return value;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

function selectRecord(source, allowedIds) {
  return Object.fromEntries(Object.entries(source ?? {}).filter(([key]) => allowedIds.has(key)).map(([key, value]) => [key, clone(value)]));
}

export class BattleProjectionService {
  static project(battle, user) {
    if (!battle) return battle;
    if (user?.isGM) return clone(battle);
    const userId = String(user?.id ?? "");
    const controlledIds = new Set(PlayerControlService.getAssignedShipIds(battle, userId));
    const ships = [];

    for (const ship of getCombatants(battle)) {
      if (controlledIds.has(ship.id)) {
        ships.push(clone(ship));
        continue;
      }
      const contact = VisibilityEngine.getContact(battle, userId, ship);
      if (!contact) continue;
      ships.push(this.projectContact(ship, contact));
    }

    const visibleIds = new Set(ships.map(ship => ship.id));
    const observableIds = new Set(ships.filter(ship => controlledIds.has(ship.id) || ship.contactState !== "lost").map(ship => ship.id));
    const setup = clone(battle.setup ?? {});
    if (setup?.victory) {
      setup.victory.initialStrength = {};
      setup.victory.initialShipCount = {};
    }

    const projected = {
      schemaVersion: battle.schemaVersion,
      id: battle.id,
      name: battle.name,
      created: battle.created,
      updated: battle.updated,
      revision: Number(battle.revision ?? 0),
      round: Number(battle.round ?? 1),
      phase: battle.phase,
      setupConfirmed: Boolean(battle.setupConfirmed),
      board: clone(battle.board ?? {}),
      wind: clone(battle.wind ?? {}),
      sea: clone(battle.sea ?? {}),
      setup,
      ships,
      playerAssignments: battle.playerAssignments?.[userId]
        ? { [userId]: clone(battle.playerAssignments[userId]) }
        : {},
      pendingOrders: selectRecord(battle.pendingOrders, controlledIds),
      processedActionIds: [],
      dishonorableCoreShots: [],
      log: clone(battle.playerVisibility?.observations?.[userId] ?? []),
      playerVisibility: {
        contacts: { [userId]: selectRecord(battle.playerVisibility?.contacts?.[userId], visibleIds) },
        observations: { [userId]: clone(battle.playerVisibility?.observations?.[userId] ?? []) }
      },
      turn: this.projectTurn(battle.turn, controlledIds, visibleIds),
      projection: {
        kind: "player",
        userId,
        transportTrust: "permissionedDocuments",
        authoritative: false
      }
    };

    if (battle.outcome != null) projected.outcome = clone(battle.outcome);
    if (battle.lastMovement && observableIds.has(battle.lastMovement.shipId)) projected.lastMovement = clone(battle.lastMovement);
    if (battle.lastAudioEvent && (!battle.lastAudioEvent.shipId || observableIds.has(battle.lastAudioEvent.shipId))) projected.lastAudioEvent = clone(battle.lastAudioEvent);
    if (battle.lastCollision
      && observableIds.has(battle.lastCollision.attackerId)
      && observableIds.has(battle.lastCollision.targetId)) projected.lastCollision = clone(battle.lastCollision);

    return projected;
  }

  static projectContact(ship, contact) {
    const identified = contact.state === "identified";
    return {
      id: ship.id,
      unitType: String(contact.unitType ?? ship.unitType ?? "ship"),
      name: identified && contact.name ? contact.name : "Неопознанный контакт",
      side: identified && contact.side ? contact.side : "unknown",
      x: Number(contact.x ?? 0),
      y: Number(contact.y ?? 0),
      heading: Number(contact.heading ?? 0),
      altitude: Number(contact.altitude ?? 0),
      speed: null,
      maxSpeed: null,
      contactState: contact.state,
      lastKnown: contact.state === "lost",
      lastSeenRound: Number(contact.lastSeenRound ?? 0),
      lastSeenPhase: String(contact.lastSeenPhase ?? ""),
      stats: {},
      sailing: {},
      crew: {},
      sections: {},
      weapons: [],
      crystal: {},
      selectedOrder: null,
      turn: {},
      flags: clone(contact.flags ?? {})
    };
  }

  static projectTurn(turn = {}, controlledIds, visibleIds) {
    const result = {
      activeShipId: visibleIds.has(turn.activeShipId) ? turn.activeShipId : null,
      actions: selectRecord(turn.actions, controlledIds),
      phaseOrder: {},
      initiative: {},
      completed: {},
      movementReservations: selectRecord(turn.movementReservations, controlledIds)
    };
    for (const phase of PHASES) {
      result.phaseOrder[phase] = (turn.phaseOrder?.[phase] ?? []).filter(id => visibleIds.has(id));
      result.completed[phase] = (turn.completed?.[phase] ?? []).filter(id => visibleIds.has(id));
      result.initiative[phase] = selectRecord(turn.initiative?.[phase], visibleIds);
    }
    return result;
  }
}
