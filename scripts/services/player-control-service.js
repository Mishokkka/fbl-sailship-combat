import { ORDER_IDS } from "../utils/constants.js";
import { boundedString, plainRecord, uniqueBoundedStrings } from "../utils/schema.js";
import { CombatantRules } from "../rules/combatant-rules.js";

const VALID_ORDERS = new Set(ORDER_IDS);

function objectEntries(value) {
  return Object.entries(plainRecord(value)).slice(0, 200);
}

function uniqueStrings(values) {
  return uniqueBoundedStrings(values, { maxItems: 200, maxLength: 128 });
}

export class PlayerControlService {
  static isValidOrder(order) {
    return VALID_ORDERS.has(String(order ?? ""));
  }

  static normalizePlayerState(battle) {
    battle.playerAssignments = this.normalizeAssignments(battle);
    battle.pendingOrders = this.normalizePendingOrders(battle);
    return battle;
  }

  static normalizeAssignments(battle) {
    const shipsById = new Map((battle.ships ?? []).map(ship => [ship.id, ship]));
    const assignedShipIds = new Set();
    const clean = {};

    for (const [userIdRaw, assignment] of objectEntries(battle.playerAssignments)) {
      const userId = boundedString(userIdRaw, { maxLength: 128 });
      if (!userId) continue;

      const shipIds = uniqueStrings(assignment?.shipIds)
        .filter(shipId => {
          const unit = shipsById.get(shipId);
          return unit && CombatantRules.isOperational(unit) && !assignedShipIds.has(shipId);
        });
      if (!shipIds.length) continue;

      for (const shipId of shipIds) assignedShipIds.add(shipId);
      const sides = [...new Set(shipIds.map(shipId => shipsById.get(shipId)?.side).filter(Boolean))];
      clean[userId] = {
        shipIds,
        side: sides.length === 1 ? sides[0] : (sides.length > 1 ? "mixed" : boundedString(assignment?.side, { maxLength: 64 }))
      };
    }

    return clean;
  }

  static normalizePendingOrders(battle) {
    if (battle.phase !== "orders") return {};
    const currentRound = Number(battle.round ?? 1);
    const shipsById = new Map((battle.ships ?? []).map(ship => [ship.id, ship]));
    const completed = new Set(battle.turn?.completed?.orders ?? []);
    const clean = {};

    for (const [shipIdRaw, pending] of objectEntries(battle.pendingOrders)) {
      const shipId = boundedString(shipIdRaw, { maxLength: 128 });
      const ship = shipsById.get(shipId);
      if (!ship || !CombatantRules.isOperational(ship) || ship.flags?.struck) continue;
      if (ship.selectedOrder || completed.has(shipId)) continue;
      if (!this.isValidOrder(pending?.order)) continue;
      if (Number(pending?.round ?? currentRound) !== currentRound) continue;
      if (!this.userControlsShip(battle, pending?.userId, shipId)) continue;

      clean[shipId] = {
        userId: boundedString(pending.userId, { maxLength: 128 }),
        order: boundedString(pending.order, { maxLength: 64 }),
        round: currentRound,
        submittedAt: String(pending.submittedAt ?? new Date().toISOString()),
        status: "submitted",
        actionId: pending.actionId ? boundedString(pending.actionId, { maxLength: 128 }) : null,
        baseRevision: Number.isFinite(Number(pending.baseRevision)) ? Number(pending.baseRevision) : null,
        baseRound: Number.isSafeInteger(Number(pending.baseRound)) ? Number(pending.baseRound) : currentRound,
        basePhase: boundedString(pending.basePhase, { fallback: battle.phase, maxLength: 64 }) || battle.phase
      };
    }

    return clean;
  }

  static getAssignedShipIds(battle, userId) {
    const assignment = battle.playerAssignments?.[String(userId ?? "")];
    return Array.isArray(assignment?.shipIds) ? assignment.shipIds : [];
  }

  static getAssignedUserId(battle, shipId) {
    const targetShipId = String(shipId ?? "");
    for (const [userId, assignment] of objectEntries(battle.playerAssignments)) {
      if ((assignment?.shipIds ?? []).includes(targetShipId)) return userId;
    }
    return null;
  }

  static userControlsShip(battle, userId, shipId) {
    const targetShipId = String(shipId ?? "");
    if (!targetShipId) return false;
    return this.getAssignedShipIds(battle, userId).includes(targetShipId);
  }

  static canViewShipDetails(battle, user, shipId) {
    if (user?.isGM) return true;
    return this.userControlsShip(battle, user?.id, shipId);
  }

  static assignShipToUser(battle, shipId, userId) {
    const targetShipId = String(shipId ?? "").trim();
    const targetUserId = String(userId ?? "").trim();
    if (!targetShipId || !targetUserId) return false;
    const unit = (battle.ships ?? []).find(ship => ship.id === targetShipId);
    if (!unit || !CombatantRules.isOperational(unit)) return false;

    this.unassignShip(battle, targetShipId);
    battle.playerAssignments ??= {};
    battle.playerAssignments[targetUserId] ??= { shipIds: [], side: "" };
    battle.playerAssignments[targetUserId].shipIds ??= [];
    if (!battle.playerAssignments[targetUserId].shipIds.includes(targetShipId)) {
      battle.playerAssignments[targetUserId].shipIds.push(targetShipId);
    }
    this.normalizePlayerState(battle);
    return true;
  }

  static unassignShip(battle, shipId) {
    const targetShipId = String(shipId ?? "").trim();
    if (!targetShipId) return false;
    let changed = false;
    battle.playerAssignments ??= {};

    for (const [userId, assignment] of objectEntries(battle.playerAssignments)) {
      const before = assignment?.shipIds ?? [];
      const after = before.filter(id => id !== targetShipId);
      if (after.length !== before.length) changed = true;
      if (after.length) battle.playerAssignments[userId] = { ...assignment, shipIds: after };
      else delete battle.playerAssignments[userId];
    }

    if (battle.pendingOrders?.[targetShipId]) {
      delete battle.pendingOrders[targetShipId];
      changed = true;
    }
    this.normalizePlayerState(battle);
    return changed;
  }

  static canSubmitOrder(battle, userId, shipId, order) {
    const ship = (battle.ships ?? []).find(candidate => candidate.id === shipId);
    if (!ship || !CombatantRules.isOperational(ship) || ship.flags?.struck) return false;
    if (!battle.setupConfirmed || battle.phase !== "orders") return false;
    if (!this.isValidOrder(order)) return false;
    if (!this.userControlsShip(battle, userId, shipId)) return false;
    if (ship.selectedOrder) return false;
    if ((battle.turn?.completed?.orders ?? []).includes(shipId)) return false;
    return true;
  }

  static submitPendingOrder(battle, {
    userId,
    shipId,
    order,
    actionId = null,
    baseRevision = null,
    baseRound = null,
    basePhase = null,
    submittedAt = null
  } = {}) {
    const normalizedShipId = String(shipId ?? "").trim();
    const normalizedUserId = String(userId ?? "").trim();
    const normalizedOrder = String(order ?? "").trim();
    const existing = battle.pendingOrders?.[normalizedShipId];
    if (existing?.actionId && actionId && existing.actionId === actionId) {
      return { ok: true, duplicate: true, pending: existing };
    }
    const currentRound = Number(battle.round ?? 1);
    const currentPhase = String(battle.phase ?? "");
    if (!Number.isSafeInteger(baseRound) || baseRound !== currentRound || String(basePhase ?? "") !== currentPhase) {
      return { ok: false, reason: "stale-turn" };
    }
    if (!this.canSubmitOrder(battle, normalizedUserId, normalizedShipId, normalizedOrder)) {
      return { ok: false, reason: "invalid-submit-order" };
    }

    battle.pendingOrders ??= {};
    battle.pendingOrders[normalizedShipId] = {
      userId: normalizedUserId,
      order: normalizedOrder,
      round: Number(battle.round ?? 1),
      submittedAt: submittedAt ?? new Date().toISOString(),
      status: "submitted",
      actionId: actionId ? String(actionId) : null,
      baseRevision: Number.isSafeInteger(baseRevision) ? baseRevision : null,
      baseRound: currentRound,
      basePhase: currentPhase
    };
    return { ok: true, duplicate: false, pending: battle.pendingOrders[normalizedShipId] };
  }
}
