import { cellToPixel, normalizeAngle } from "../board/board-geometry.js";
import { SoundService } from "../services/sound-service.js";

const STEP_DURATION_MS = 240;

function shortestAngle(from, to) {
  return ((Number(to) - Number(from) + 540) % 360) - 180;
}

export class BattleAnimationController {
  constructor(app) {
    this.app = app;
    this.playedMovementIds = new Set();
    this.playedAudioIds = new Set();
    this.playedCollisionIds = new Set();
    this.animationFrame = null;
    this.collisionFrame = null;
    this.collisionTimer = null;
    this.initialized = false;
  }

  onRender(battle) {
    if (!this.initialized) {
      if (battle?.lastMovement?.id) this.remember(this.playedMovementIds, battle.lastMovement.id);
      if (battle?.lastAudioEvent?.id) this.remember(this.playedAudioIds, battle.lastAudioEvent.id);
      if (battle?.lastCollision?.id) this.remember(this.playedCollisionIds, battle.lastCollision.id);
      this.initialized = true;
      return;
    }
    this.consumeAudioEvent(battle?.lastAudioEvent);
    const movementDuration = this.animateMovement(battle, battle?.lastMovement);
    this.animateCollision(battle, battle?.lastCollision, movementDuration);
  }

  consumeAudioEvent(event) {
    if (!event?.id || this.playedAudioIds.has(event.id)) return;
    this.remember(this.playedAudioIds, event.id);
    SoundService.play(event.type);
  }

  animateMovement(battle, movement) {
    if (!movement?.id || this.playedMovementIds.has(movement.id)) return 0;
    const node = this.getToken(movement.shipId);
    if (!node) return 0;
    this.remember(this.playedMovementIds, movement.id);
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || typeof globalThis.requestAnimationFrame !== "function") return 0;

    const points = [movement.start, ...(movement.path ?? []), movement.end]
      .filter(Boolean)
      .filter((point, index, list) => index === 0
        || Number(point.x) !== Number(list[index - 1].x)
        || Number(point.y) !== Number(list[index - 1].y)
        || Number(point.heading) !== Number(list[index - 1].heading));
    if (points.length < 2) return 0;
    const frames = points.map(point => {
      const center = cellToPixel(battle.board, point.x, point.y);
      return { x: center.cx, y: center.cy, heading: normalizeAngle(Number(point.heading ?? 0) - 90) };
    });
    const duration = Math.min(2200, Math.max(STEP_DURATION_MS, (frames.length - 1) * STEP_DURATION_MS));
    const tokenUi = node.querySelector?.(".ssc-token-ui");
    const startedAt = performance.now();
    this.cancelMovementAnimation();
    node.classList.add("is-animating");
    this.setTokenTransform(node, tokenUi, frames[0].x, frames[0].y, frames[0].heading);

    const tick = now => {
      const elapsed = Math.max(0, now - startedAt);
      const progress = Math.min(1, elapsed / duration);
      const scaled = progress * (frames.length - 1);
      const index = Math.min(frames.length - 2, Math.floor(scaled));
      const local = Math.min(1, scaled - index);
      const from = frames[index];
      const to = frames[index + 1];
      const x = from.x + (to.x - from.x) * local;
      const y = from.y + (to.y - from.y) * local;
      const heading = normalizeAngle(from.heading + shortestAngle(from.heading, to.heading) * local);
      this.setTokenTransform(node, tokenUi, x, y, heading);
      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(tick);
        return;
      }
      this.animationFrame = null;
      node.classList.remove("is-animating");
    };
    this.animationFrame = requestAnimationFrame(tick);
    return duration;
  }

  animateCollision(battle, collision, delay = 0) {
    if (!collision?.id || this.playedCollisionIds.has(collision.id)) return;
    this.remember(this.playedCollisionIds, collision.id);
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || typeof globalThis.requestAnimationFrame !== "function") return;
    this.cancelCollisionAnimation();
    const run = () => this.runCollisionAnimation(battle, collision);
    if (delay > 0) this.collisionTimer = setTimeout(run, Math.max(0, delay - 40));
    else run();
  }

  runCollisionAnimation(battle, collision) {
    this.collisionTimer = null;
    const attacker = (battle?.ships ?? []).find(unit => unit.id === collision.attackerId);
    const target = (battle?.ships ?? []).find(unit => unit.id === collision.targetId);
    const a = this.getToken(collision.attackerId);
    const b = this.getToken(collision.targetId);
    if (!attacker || !target || !a || !b) return;

    const aCenter = cellToPixel(battle.board, attacker.x, attacker.y);
    const bCenter = cellToPixel(battle.board, target.x, target.y);
    const dx = bCenter.cx - aCenter.cx;
    const dy = bCenter.cy - aCenter.cy;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / length;
    const ny = dy / length;
    const strength = Math.max(1, Math.min(24, Number(collision.impactStrength ?? collision.relativeSpeed ?? 4)));
    const amplitude = Math.min(16, 4 + strength * 0.55);
    const duration = 620;
    const startedAt = performance.now();
    const aHeading = normalizeAngle(Number(attacker.heading ?? 0) - 90);
    const bHeading = normalizeAngle(Number(target.heading ?? 0) - 90);
    const aUi = a.querySelector?.(".ssc-token-ui");
    const bUi = b.querySelector?.(".ssc-token-ui");
    a.classList.add("ssc-collision-impact");
    b.classList.add("ssc-collision-impact");

    const offsetAt = progress => {
      if (progress < 0.28) return (progress / 0.28) * amplitude;
      if (progress < 0.52) return amplitude + ((progress - 0.28) / 0.24) * (-amplitude * 1.42);
      return (-amplitude * 0.42) * (1 - (progress - 0.52) / 0.48);
    };

    const tick = now => {
      const progress = Math.min(1, Math.max(0, now - startedAt) / duration);
      const offset = offsetAt(progress);
      this.setTokenTransform(a, aUi, aCenter.cx + nx * offset, aCenter.cy + ny * offset, aHeading);
      this.setTokenTransform(b, bUi, bCenter.cx - nx * offset, bCenter.cy - ny * offset, bHeading);
      if (progress < 1) {
        this.collisionFrame = requestAnimationFrame(tick);
        return;
      }
      this.collisionFrame = null;
      this.setTokenTransform(a, aUi, aCenter.cx, aCenter.cy, aHeading);
      this.setTokenTransform(b, bUi, bCenter.cx, bCenter.cy, bHeading);
      a.classList.remove("ssc-collision-impact");
      b.classList.remove("ssc-collision-impact");
    };
    this.collisionFrame = requestAnimationFrame(tick);
  }

  getToken(id) {
    return [...(this.app.element?.querySelectorAll?.(".ssc-ship-token[data-ship-id]") ?? [])]
      .find(element => element.dataset.shipId === id) ?? null;
  }

  setTokenTransform(node, tokenUi, x, y, heading) {
    node.setAttribute("transform", `translate(${x} ${y}) rotate(${heading})`);
    if (tokenUi) tokenUi.setAttribute("transform", `rotate(${-heading})`);
  }

  cancelMovementAnimation() {
    if (this.animationFrame != null && typeof globalThis.cancelAnimationFrame === "function") cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.app.element?.querySelector?.(".ssc-ship-token.is-animating")?.classList?.remove("is-animating");
  }

  cancelCollisionAnimation() {
    if (this.collisionTimer != null) clearTimeout(this.collisionTimer);
    if (this.collisionFrame != null && typeof globalThis.cancelAnimationFrame === "function") cancelAnimationFrame(this.collisionFrame);
    this.collisionTimer = null;
    this.collisionFrame = null;
    this.app.element?.querySelectorAll?.(".ssc-ship-token.ssc-collision-impact")?.forEach(node => node.classList.remove("ssc-collision-impact"));
  }

  cancelAnimation() {
    this.cancelMovementAnimation();
    this.cancelCollisionAnimation();
  }

  remember(set, id) {
    set.add(id);
    if (set.size <= 100) return;
    const oldest = set.values().next().value;
    set.delete(oldest);
  }

  destroy() {
    this.cancelAnimation();
    this.playedMovementIds.clear();
    this.playedAudioIds.clear();
    this.playedCollisionIds.clear();
    this.initialized = false;
  }
}
