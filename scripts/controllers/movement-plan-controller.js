import { MovementPlanBuilder } from "../context/movement-plan-builder.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { VictoryEngine } from "../engine/victory-engine.js";
import { rotateHeading } from "../board/board-geometry.js";
import { uid } from "../utils/random.js";

/** A local draft. Only confirm enters the serialized battle mutation queue. */
export class MovementPlanController {
  constructor(app) { this.app = app; this.pending = null; this.busy = false; this.notice = ""; }

  matches(battle, plan = this.pending) {
    return Boolean(plan && game.user.isGM && battle.setupConfirmed && !battle.outcome?.resolved
      && !this.app.deployMode && battle.id === plan.battleId
      && Number(battle.revision ?? 0) === plan.revision && battle.round === plan.round
      && battle.phase === "movement" && battle.turn?.activeShipId === plan.shipId && this.app.selectedShipId === plan.shipId);
  }

  preview(battle, x, y, options = {}) {
    const copy = foundry.utils.deepClone(battle);
    const ship = copy.ships.find(unit => unit.id === this.app.selectedShipId);
    if (!game.user.isGM || !copy.setupConfirmed || copy.outcome?.resolved || this.app.deployMode
      || !ship || !this.app._canShowMovement(copy, ship)) return null;
    if (options.kind === "turn") {
      if (!this.app._getActionState(copy, ship).canTurn) return null;
      return MovementPlanBuilder.turn(copy, ship, options.delta);
    }
    const apCost = this.app._getRemainingAP(copy, ship, "movement") > 0 ? 1 : 0;
    if (options.kind === "withdraw") return MovementPlanBuilder.withdrawal(copy, ship, { apCost });
    return MovementPlanBuilder.build(copy, ship.id, x, y, { apCost, withdraw: Boolean(options.withdraw) });
  }

  async stage(x, y, options = {}) {
    if (this.busy) return;
    const battle = this.app.renderBattleSnapshot ?? this.app.battle;
    const preview = this.preview(battle, x, y, options);
    if (!preview) { ui.notifications.warn("Манёвр недоступен: проверьте маршрут, ход и оставшиеся ОД."); return; }
    this.pending = { battleId: battle.id, revision: Number(battle.revision ?? 0), round: battle.round,
      shipId: preview.shipId, x, y, kind: preview.kind, delta: options.delta ?? null, withdraw: Boolean(options.withdraw), preview };
    this.notice = "";
    this.app.layout?.showPane?.("board");
    await this.app.renderBattleState(["board"]);
    this.app.element?.querySelector('[data-action="confirmMovementPlan"]')?.focus({ preventScroll: true });
  }

  stageTurn(delta) { return this.stage(null, null, { kind: "turn", delta }); }
  stageWithdrawal() { return this.stage(null, null, { kind: "withdraw" }); }

  async toggleWithdrawal() {
    const plan = this.pending;
    if (plan?.kind === "move") return this.stage(plan.x, plan.y, { withdraw: !plan.withdraw });
  }

  routeOptions(battle) {
    const copy = foundry.utils.deepClone(battle);
    const ship = copy.ships.find(unit => unit.id === this.app.selectedShipId);
    if (!game.user.isGM || !copy.setupConfirmed || copy.outcome?.resolved || this.app.deployMode || !ship
      || !this.app._canShowMovement(copy, ship)) return [];
    const reachable = MovementEngine.getReachableCells(copy, ship);
    return [-1, 0, 1].map(delta => {
      const heading = rotateHeading(ship.heading, delta);
      const cells = reachable.filter(cell => Number(cell.heading) === heading && !cell.collision);
      const distance = this.pending?.preview?.isMove ? this.pending.preview.distance : Number(ship.speed ?? 0);
      const candidate = cells.sort((a, b) => Math.abs(a.steps - distance) - Math.abs(b.steps - distance) || b.steps - a.steps)[0];
      return { delta, label: delta < 0 ? "Курс влево" : delta > 0 ? "Курс вправо" : "Прямо",
        enabled: Boolean(candidate), selected: Boolean(this.pending?.preview?.isMove && this.pending.preview.heading === heading),
        x: candidate?.x, y: candidate?.y };
    });
  }

  async stageRoute(delta) {
    if (this.busy) return;
    const battle = this.app.renderBattleSnapshot ?? this.app.battle;
    const option = this.routeOptions(battle).find(option => option.delta === delta);
    if (option?.enabled) return this.stage(option.x, option.y);
  }

  async cancel() {
    if (this.busy) return;
    this.pending = null; this.notice = "";
    await this.app.renderBattleState(["board"]);
    this.app.element?.querySelector(".ssc-board-svg")?.focus({ preventScroll: true });
  }

  getContext(battle) {
    if (this.pending && !this.matches(battle)) {
      this.pending = null;
      if (!this.busy) this.notice = "Обстановка изменилась. Выберите маршрут заново.";
    }
    return { preview: this.pending?.preview ?? null, choices: this.routeOptions(battle), busy: this.busy, notice: this.notice };
  }

  executeWithdrawal(battle, plan) {
    const unit = battle.ships.find(unit => unit.id === plan.shipId);
    if (!unit || !this.app._requireActivePhase(battle, unit, "movement", "Выход из боя")) return false;
    if (!this.app._markTurnAction(battle, unit, "move", plan.preview.apCost)) return false;
    const result = VictoryEngine.withdraw(battle, unit);
    if (!result.ok) return false;
    this.app._addLog(battle, result.text);
    this.app._completeShipActivation(battle, unit, "movement");
    return true;
  }

  async confirm() {
    if (this.busy || !this.pending) return;
    const plan = this.pending;
    this.busy = true;
    let executed = false, movementId = null, receiptId = null;
    try {
      await this.app.renderBattleState(["board"]);
      const saved = await this.app._updateBattleAndRender(battle => {
        const fresh = this.pending === plan && this.matches(battle, plan) ? this.preview(battle, plan.x, plan.y, plan) : null;
        if (!fresh || JSON.stringify(fresh) !== JSON.stringify(plan.preview)) {
          this.pending = null; this.notice = "Обстановка изменилась. Выберите маршрут заново."; return false;
        }
        executed = plan.kind === "turn" ? this.app.movement.executeTurn(battle, plan.delta)
          : plan.kind === "withdraw" ? this.executeWithdrawal(battle, plan) : this.app.board.executePlannedMove(battle, plan);
        if (!executed) return false;
        movementId = plan.kind === "move" ? battle.lastMovement?.id : null;
        receiptId = uid("maneuver");
        battle.turn.lastManeuverPlan = { id: receiptId, shipId: plan.shipId, kind: plan.kind };
      }, { reason: plan.kind === "move" ? "board-move-ship" : "planned-" + plan.kind, renderParts: [] });
      const committed = executed && saved.id === plan.battleId && Number(saved.revision ?? 0) > plan.revision
        && receiptId && saved.turn?.lastManeuverPlan?.id === receiptId
        && (plan.kind !== "move" || (movementId && saved.lastMovement?.id === movementId));
      if (committed) {
        this.pending = null;
        const next = this.app._getActiveShip(saved);
        if (this.app.selectedShipId === plan.shipId && next) this.app.selectedShipId = next.id;
        const unit = saved.ships.find(ship => ship.id === plan.shipId);
        const check = saved.turn?.lastManeuverCheck;
        const failed = plan.kind === "turn" && plan.preview.assessment?.needsCheck && check?.shipId === plan.shipId && check.success === false;
        this.notice = (unit?.name ?? plan.preview.shipName) + (failed ? ": проверка поворота не пройдена. " : ": манёвр выполнен. ")
          + (next ? "Действует: " + next.name + "." : "Все участники завершили движение.");
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
