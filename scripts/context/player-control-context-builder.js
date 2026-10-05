import { ORDER_LABELS } from "../utils/constants.js";
import { PlayerControlService } from "../services/player-control-service.js";
import { CombatantRules } from "../rules/combatant-rules.js";

function playerUsers() {
  const rawUsers = game.users?.contents ?? (game.users ? Array.from(game.users) : []);
  return rawUsers
    .map(entry => Array.isArray(entry) ? entry[1] : entry)
    .filter(user => user && !user.isGM)
    .map(user => ({
      id: user.id,
      name: user.name ?? user.id,
      active: Boolean(user.active)
    }));
}

export class PlayerControlContextBuilder {
  static build(battle, selectedShip) {
    return this.buildContext(battle, selectedShip);
  }

  static buildContext(battle, selectedShip) {
    const users = playerUsers();
    const userNames = new Map(users.map(user => [user.id, user.name]));
    const shipsById = new Map((battle.ships ?? []).map(ship => [ship.id, ship]));
    const selectedAssignedUserId = selectedShip ? PlayerControlService.getAssignedUserId(battle, selectedShip.id) : null;
    const selectedPendingOrder = selectedShip ? battle.pendingOrders?.[selectedShip.id] ?? null : null;
    const selectedCanViewDetails = Boolean(selectedShip && PlayerControlService.canViewShipDetails(battle, game.user, selectedShip.id));
    const currentUserShipIds = PlayerControlService.getAssignedShipIds(battle, game.user.id)
      .filter(shipId => shipsById.has(shipId) && CombatantRules.isOperational(shipsById.get(shipId)));
    const completedOrders = new Set(battle.turn?.completed?.orders ?? []);
    const assignedShipIds = [...new Set(Object.values(battle.playerAssignments ?? {}).flatMap(assignment => assignment?.shipIds ?? []))]
      .filter(shipId => shipsById.has(shipId) && CombatantRules.isActive(shipsById.get(shipId)));
    const readyAssignedCount = assignedShipIds.filter(shipId => {
      const ship = shipsById.get(shipId);
      return Boolean(battle.pendingOrders?.[shipId] || ship?.selectedOrder || completedOrders.has(shipId));
    }).length;
    const currentUserShipNames = currentUserShipIds.map(shipId => shipsById.get(shipId)?.name ?? shipId);
    const pendingOrders = this.getPendingOrders(battle, shipsById, userNames);
    const assignmentRows = this.getAssignmentRows(battle, shipsById, userNames);

    return {
      showPanel: Boolean(game.user.isGM || currentUserShipIds.length || selectedAssignedUserId || pendingOrders.length),
      users,
      assignableUsers: users.map(user => ({
        ...user,
        assignedToSelected: user.id === selectedAssignedUserId,
        title: user.active ? "Игрок подключен" : "Игрок не подключен"
      })),
      assignmentRows,
      hasAssignments: assignmentRows.length > 0,
      selectedAssignable: Boolean(selectedShip && CombatantRules.isOperational(selectedShip)),
      selectedAssignedUserId,
      selectedAssignedUserName: selectedAssignedUserId ? userNames.get(selectedAssignedUserId) ?? selectedAssignedUserId : "",
      selectedShipIsAssignedToCurrentUser: Boolean(selectedShip && PlayerControlService.userControlsShip(battle, game.user.id, selectedShip.id)),
      selectedCanViewDetails,
      selectedPendingOrder,
      selectedPendingOrderLabel: selectedPendingOrder ? ORDER_LABELS[selectedPendingOrder.order] ?? selectedPendingOrder.order : "",
      canSubmitOrder: Boolean(selectedShip && PlayerControlService.canSubmitOrder(battle, game.user.id, selectedShip.id, "battleSail")),
      currentUserShipIds,
      currentUserShipNames,
      currentUserShipText: currentUserShipNames.join(", "),
      pendingOrders,
      hasPendingOrders: pendingOrders.length > 0,
      pendingOrderCount: pendingOrders.length,
      assignedShipCount: assignedShipIds.length,
      readyAssignedCount,
      readyText: `${readyAssignedCount}/${assignedShipIds.length}`
    };
  }

  static getPendingOrders(battle, shipsById, userNames) {
    return Object.entries(battle.pendingOrders ?? {}).map(([shipId, pending]) => {
      const ship = shipsById.get(shipId);
      return {
        shipId,
        shipName: ship?.name ?? shipId,
        userId: pending.userId,
        userName: userNames.get(pending.userId) ?? pending.userId,
        order: pending.order,
        orderLabel: ORDER_LABELS[pending.order] ?? pending.order,
        active: battle.turn?.activeShipId === shipId,
        canApprove: Boolean(battle.setupConfirmed && battle.phase === "orders" && battle.turn?.activeShipId === shipId)
      };
    });
  }

  static getAssignmentRows(battle, shipsById, userNames) {
    return Object.entries(battle.playerAssignments ?? {}).map(([userId, assignment]) => {
      const shipNames = (assignment?.shipIds ?? []).map(shipId => shipsById.get(shipId)?.name ?? shipId);
      const sideId = assignment?.side ?? "";
      const side = battle.setup?.sides?.[sideId] ?? null;
      return {
        userId,
        userName: userNames.get(userId) ?? userId,
        side: sideId,
        sideName: sideId === "mixed" ? "несколько сторон" : side?.name ?? sideId,
        sideColor: side?.color ?? "#777777",
        shipNames,
        shipText: shipNames.join(", ")
      };
    });
  }
}
