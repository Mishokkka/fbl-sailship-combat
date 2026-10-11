import { cellToPixel, headingToVector, normalizeAngle, withinBoard } from "../board/board-geometry.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { CreatureMovementEngine } from "../engine/creature-movement-engine.js";
import { OccupancyEngine } from "../engine/occupancy-engine.js";
import { HEADING_LABELS } from "../utils/constants.js";

/** Conditional, read-only forecasts. Never roll, apply damage or reserve cells. */
export class MovementReadoutBuilder {
  static build(battle, unit) {
    const inertia = MovementEngine.getInertiaProfile(battle, unit);
    const brakeSpeed = Math.max(0, inertia.speed - inertia.braking);
    const afterBrake = MovementEngine.getInertiaProfile(battle, unit, { speed: brakeSpeed });
    const creature = unit.unitType === "creature";
    const canHover = creature && this.canHover(unit);
    return {
      ...inertia, brakeSpeed, brakeMinimum: afterBrake.requiredAdvance,
      overCap: inertia.speed > inertia.effectiveMax,
      turnText: MovementEngine.getTurnLimit(unit) <= 0 ? "Поворот недоступен." : inertia.turnText,
      stallOnStop: creature && !canHover && Number(unit.altitude ?? 0) > 0,
      endOfRound: this.forecast(battle, unit)
    };
  }

  static canHover(unit) {
    return Boolean(unit.movement?.canHover || ["hover", "swarm", "levitating"].includes(unit.movement?.profile));
  }

  static forecast(battle, unit) {
    const creature = unit.unitType === "creature";
    const altitudeNow = Number(unit.altitude ?? 0);
    const inactive = unit.flags?.struck || unit.flags?.withdrawn || (MovementEngine.usesCore(battle) && unit.flags?.coreExploded);
    const attached = creature && Boolean(unit.flags?.attachedTo);
    const falling = creature && (unit.flags?.falling || (!this.canHover(unit) && Number(unit.speed ?? 0) <= 0 && altitudeNow > 0));
    const vertical = creature
      ? { before: altitudeNow, after: falling ? Math.max(0, altitudeNow - 2) : altitudeNow }
      : MovementEngine.getVerticalProjection(battle, unit);
    const altitudeEnd = inactive || attached ? altitudeNow : vertical.after;
    // Landing can damage sails/steering or stop the ship before drift is calculated.
    const landing = !creature && altitudeEnd === 0 && (altitudeNow > 0 || vertical.velocity < 0);
    const warnings = [];
    let steps = 0;
    if (!inactive && !attached && !landing) {
      steps = creature ? (falling ? 0 : CreatureMovementEngine.driftSteps(battle, unit)) : MovementEngine.getDriftSteps(battle, unit);
    }
    if (falling && !inactive && !attached) warnings.push("Падение: −2 H в конце раунда; при H0 возможен удар.");
    if (landing && !inactive) warnings.push("Посадка или удар о поверхность: снос зависит от полученных повреждений.");
    const path = [{ x: Number(unit.x ?? 0), y: Number(unit.y ?? 0) }];
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      const current = path.at(-1);
      const vector = headingToVector(battle.wind?.direction ?? 0, current.x, current.y);
      const next = { x: current.x + vector.dx, y: current.y + vector.dy };
      const terrain = MovementEngine.getTerrain(battle, next.x, next.y);
      if (!withinBoard(battle.board, next.x, next.y) || MovementEngine.isBlockingTerrain(terrain, altitudeEnd)
          || OccupancyEngine.findShipAt(battle, next.x, next.y, altitudeEnd, { excludeShipId: unit.id })) {
        blocked = true;
        warnings.push(creature ? "Снос остановится перед препятствием." : "На пути сноса препятствие: возможно столкновение и повреждение.");
        break;
      }
      path.push(next);
      if (!creature && MovementEngine.getHazardCollisions(terrain, Math.max(1, Number(unit.speed ?? 0)), altitudeEnd).length) {
        warnings.push("Снос проходит через опасный террейн: возможны повреждения и потеря хода.");
      }
    }
    const points = path.map(cell => cellToPixel(battle.board, cell.x, cell.y));
    const end = points.at(-1);
    const direction = HEADING_LABELS[battle.wind?.direction ?? 0] ?? "";
    const driftText = inactive ? "Снос не применяется" : attached ? "Перемещается с носителем"
      : landing ? "Снос уточнится после посадки"
      : steps ? "Снос " + steps + " гекс. → " + direction + (blocked ? " · препятствие" : "") : "Без сноса";
    return {
      altitudeNow, altitudeEnd, showAltitude: MovementEngine.usesAltitude(battle), driftText,
      steps, moved: path.length - 1, blocked, landing, warnings, path,
      destination: (path.at(-1).x + 1) + ":" + (path.at(-1).y + 1),
      hasPath: path.length > 1,
      points: points.map(p => p.cx + "," + p.cy).join(" "),
      cx: end.cx, cy: end.cy, renderHeading: normalizeAngle(Number(battle.wind?.direction ?? 0) - 90)
    };
  }

  static turnCue(battle, unit, reachable) {
    const delay = MovementEngine.getInertiaProfile(battle, unit).turnDelay;
    if (!delay || !reachable.length || MovementEngine.getTurnLimit(unit) <= 0) return null;
    const path = reachable.reduce((best, cell) => (cell.path?.length ?? 0) > best.length ? cell.path : best, []).slice(0, delay);
    if (path.length < delay) return null;
    const points = [unit, ...path].map(cell => cellToPixel(battle.board, cell.x, cell.y));
    return { delay, points: points.map(p => p.cx + "," + p.cy).join(" "), ...points.at(-1) };
  }
}
