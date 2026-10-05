import { ORDER_LABELS } from "../utils/constants.js";
import { PlayerControlService } from "../services/player-control-service.js";
import { SocketService } from "../services/socket-service.js";
import { CombatantRules } from "../rules/combatant-rules.js";

export class ShipOrderController {
  constructor(app) {
    this.app = app;
  }

  async setOrder(order) {
    if (!game.user.isGM) return this.submitPlayerOrder(order);
    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      return this.applyOrderToShip(battle, ship, order);
    }, { reason: "set-order" });
  }

  async submitPlayerOrder(order) {
    const battle = this.app.battle;
    const ship = this.app.getSelectedShip(battle);
    if (!ship) return ui.notifications.warn("Корабль не выбран.");
    if (!PlayerControlService.canSubmitOrder(battle, game.user.id, ship.id, order)) {
      return ui.notifications.warn("Этот приказ сейчас нельзя отправить: нужен назначенный вам корабль в фазе приказов.");
    }

    const result = await SocketService.requestAction({
      type: "submitOrder",
      shipId: ship.id,
      order
    });
    const label = ORDER_LABELS[order] ?? order;
    if (result.ok) {
      const suffix = result.reason === "duplicate" ? " уже был принят ГМом." : " принят ГМом.";
      ui.notifications.info(`${ship.name}: приказ «${label}»${suffix}`);
      return true;
    }

    const reasonLabels = {
      "stale-turn": "раунд или фаза уже изменились",
      "invalid-submit-order": "корабль больше не может принять этот приказ",
      "inactive-user": "игрок не найден или отключён",
      "expired-action": "команда пришла слишком поздно",
      "storage-conflict": "состояние боя одновременно изменилось",
      "socket-unavailable": "сокет Foundry недоступен",
      "projection-auth-unavailable": "персональная проекция игрока ещё не готова",
      "invalid-action-signature": "подпись команды не прошла проверку",
      "action-signing-failed": "клиент не смог подписать команду",
      "response-timeout": "ведущий ГМ не подтвердил получение",
      "internal-error": "при обработке возникла внутренняя ошибка"
    };
    ui.notifications.warn(`${ship.name}: приказ «${label}» не принят: ${reasonLabels[result.reason] ?? result.reason ?? "неизвестная причина"}.`);
    return false;
  }

  async assignSelectedShipToPlayer(userId) {
    if (!game.user.isGM) return ui.notifications.warn("Назначения кораблей меняет только ГМ.");
    const user = game.users?.get?.(userId);
    if (!user || user.isGM) return ui.notifications.warn("Выберите игрока, а не ГМа.");

    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      if (!CombatantRules.isOperational(ship)) {
        ui.notifications.warn("Назначение игроку станет доступно после подключения боевых правил этого типа.");
        return false;
      }
      if (!PlayerControlService.assignShipToUser(battle, ship.id, user.id)) return false;
      this.app._addLog(battle, `${ship.name}: назначен игроку ${user.name}.`);
    }, { reason: "assign-ship-player" });
  }

  async unassignSelectedShip() {
    if (!game.user.isGM) return ui.notifications.warn("Назначения кораблей меняет только ГМ.");

    await this.app._updateBattleAndRender(battle => {
      const ship = this.app.getSelectedShip(battle);
      if (!ship) return false;
      const userId = PlayerControlService.getAssignedUserId(battle, ship.id);
      if (!PlayerControlService.unassignShip(battle, ship.id)) return false;
      const user = userId ? game.users?.get?.(userId) : null;
      this.app._addLog(battle, `${ship.name}: назначение игрока ${user?.name ?? userId ?? ""} снято.`);
    }, { reason: "unassign-ship-player" });
  }

  async approvePendingOrder(shipId) {
    if (!game.user.isGM) return ui.notifications.warn("Pending-приказы подтверждает только ГМ.");

    await this.app._updateBattleAndRender(battle => {
      PlayerControlService.normalizePlayerState(battle);
      const pending = battle.pendingOrders?.[shipId];
      if (!pending) {
        ui.notifications.warn("Pending-приказ не найден.");
        return false;
      }
      const ship = battle.ships.find(s => s.id === shipId);
      const user = game.users?.get?.(pending.userId);
      return this.applyOrderToShip(battle, ship, pending.order, { userName: user?.name ?? pending.userId });
    }, { reason: "approve-pending-order" });
  }

  async rejectPendingOrder(shipId) {
    if (!game.user.isGM) return ui.notifications.warn("Pending-приказы отклоняет только ГМ.");

    await this.app._updateBattleAndRender(battle => {
      PlayerControlService.normalizePlayerState(battle);
      const pending = battle.pendingOrders?.[shipId];
      const ship = battle.ships.find(s => s.id === shipId);
      if (!pending || !ship) {
        ui.notifications.warn("Pending-приказ не найден.");
        return false;
      }
      const user = game.users?.get?.(pending.userId);
      const label = ORDER_LABELS[pending.order] ?? pending.order;
      delete battle.pendingOrders[shipId];
      this.app._addLog(battle, `${ship.name}: приказ игрока ${user?.name ?? pending.userId} «${label}» отклонен.`);
    }, { reason: "reject-pending-order" });
  }

  applyOrderToShip(battle, ship, order, { userName = null } = {}) {
    if (!this.app._requireActivePhase(battle, ship, "orders", "Приказ")) return false;
    if (!PlayerControlService.isValidOrder(order)) return false;
    if (!this.app._markTurnAction(battle, ship, "order")) {
      ui.notifications.warn(`${ship.name} уже получил приказ в этой фазе.`);
      return false;
    }

    ship.selectedOrder = order;
    if (battle.pendingOrders?.[ship.id]) delete battle.pendingOrders[ship.id];
    const label = ORDER_LABELS[order] ?? order;
    const source = userName ? ` игрока ${userName}` : "";
    this.app._addLog(battle, `${ship.name}: приказ${source} «${label}».`);
    this.app._completeShipActivation(battle, ship, "orders");
    const next = this.app._getActiveShip(battle);
    if (next) {
      this.app.selectedShipId = next.id;
      this.app._addLog(battle, `Ход корабля: ${next.name}.`);
    } else {
      this.app._addLog(battle, "Все корабли получили приказы. Можно перейти к маневру.");
    }
    this.app.selectedTargetId = null;
    return true;
  }
}
