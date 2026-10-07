import { MovementPlanBuilder } from "../context/movement-plan-builder.js";

/** A local draft. Only confirm enters the serialized battle mutation queue. */
export class MovementPlanController {
  constructor(app) {
    this.app = app;
    this.pending = null;
    this.busy = false;
    this.notice = "";
  }

  matches(battle, plan = this.pending) {
    return Boolean(plan && game.user.isGM && battle.setupConfirmed && !battle.outcome?.resolved
      && !this.app.deployMode && battle.id === plan.battleId
      && Number(battle.revision ?? 0) === plan.revision
      && battle.round === plan.round && battle.phase === "movement"
      && battle.turn?.activeShipId === plan.shipId && this.app.selectedShipId === plan.shipId);
  }

  preview(battle, x, y) {
    // Phase helpers initialize action maps. Run them on a copy, never on the displayed battle.
    const copy = foundry.utils.deepClone(battle);
    const ship = copy.ships.find(unit => unit.id === this.app.selectedShipId);
    if (!game.user.isGM || !copy.setupConfirmed || copy.outcome?.resolved || this.app.deployMode
      || !ship || !this.app._canShowMovement(copy, ship)) return null;
    return MovementPlanBuilder.build(copy, ship.id, x, y, {
      apCost: this.app._getRemainingAP(copy, ship, "movement") > 0 ? 1 : 0
    });
  }

  async stage(x, y) {
    if (this.busy) return;
    const battle = this.app.renderBattleSnapshot ?? this.app.battle;
    const preview = this.preview(battle, x, y);
    if (!preview) {
      ui.notifications.warn("Выберите подсвеченную клетку для действующего участника.");
      return;
    }
    this.pending = {
      battleId: battle.id, revision: Number(battle.revision ?? 0), round: battle.round,
      shipId: preview.shipId, x, y, preview
    };
    this.notice = "";
    await this.app.renderBattleState(["board"]);
    this.app.element?.querySelector('[data-action="confirmMovementPlan"]')?.focus({ preventScroll: true });
  }

  async cancel() {
    if (this.busy) return;
    this.pending = null;
    this.notice = "";
    await this.app.renderBattleState(["board"]);
    this.app.element?.querySelector(".ssc-board-svg")?.focus({ preventScroll: true });
  }

  getContext(battle) {
    if (this.pending && !this.matches(battle)) {
      this.pending = null;
      if (!this.busy) this.notice = "Обстановка изменилась. Выберите маршрут заново.";
    }
    return { preview: this.pending?.preview ?? null, busy: this.busy, notice: this.notice };
  }

  async confirm() {
    if (this.busy || !this.pending) return;
    const plan = this.pending;
    this.busy = true;
    let executed = false;
    let movementId = null;
    try {
      await this.app.renderBattleState(["board"]);
      const saved = await this.app._updateBattleAndRender(battle => {
        // Validate again INSIDE the queue, before any AP, dice, logs or damage.
        const fresh = this.pending === plan && this.matches(battle, plan) ? this.preview(battle, plan.x, plan.y) : null;
        if (!fresh || JSON.stringify(fresh) !== JSON.stringify(plan.preview)) {
          this.pending = null;
          this.notice = "Обстановка изменилась. Выберите маршрут заново.";
          return false;
        }
        executed = this.app.board.executePlannedMove(battle, plan);
        movementId = executed ? battle.lastMovement?.id : null;
        return executed ? undefined : false;
      }, { reason: "board-move-ship", renderParts: [] });
      const committed = executed && saved.id === plan.battleId
        && Number(saved.revision ?? 0) > plan.revision && movementId
        && saved.lastMovement?.id === movementId;
      if (committed) {
        this.pending = null;
        const next = this.app._getActiveShip(saved);
        // Preserve a different selection made while the write was in flight.
        if (this.app.selectedShipId === plan.shipId && next) this.app.selectedShipId = next.id;
        const unit = saved.ships.find(ship => ship.id === plan.shipId);
        this.notice = `${unit?.name ?? plan.preview.shipName}: манёвр выполнен. ${next ? `Действует: ${next.name}.` : "Все участники завершили движение."}`;
      } else if (executed || this.pending) {
        this.notice = "Манёвр не сохранён. Проверьте состояние боя и повторите подтверждение.";
      }
    } catch (error) {
      this.app.renderBattleSnapshot = null;
      this.notice = "Не удалось сохранить манёвр. Проверьте состояние боя перед повтором.";
      ui.notifications.error(this.notice);
      console.error("Sailships | Movement confirmation failed", error);
    } finally {
      this.busy = false;
      await this.app.renderBattleState();
    }
  }
}
