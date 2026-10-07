import { cellToPixel, normalizeAngle } from "../board/board-geometry.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { WindEngine } from "../engine/wind-engine.js";

/** Read-only forecast: never execute damage, rolls, reservations or movement events. */
export class MovementPlanBuilder {
  static build(battle, shipId, x, y, { apCost = 1 } = {}) {
    const move = MovementEngine.getMoveResult(battle, shipId, x, y);
    if (!move.ok) return null;
    const { ship, candidate } = move;
    const collision = candidate.collision ?? null;
    const path = collision ? move.path.slice(0, -1) : move.path;
    const stop = { x: Number(candidate.stopX ?? x), y: Number(candidate.stopY ?? y) };
    const heading = Number(candidate.heading ?? ship.heading ?? 0);
    const speedBefore = Number(ship.speed ?? 0);
    let speedAfter = Math.min(speedBefore, Number(candidate.steps ?? 0));
    const warnings = [];
    const creature = ship.unitType === "creature";
    for (const step of path) {
      const label = `[${step.x + 1}:${step.y + 1}]`;
      if (creature) {
        const terrain = MovementEngine.terrainList(step.terrain);
        if (terrain.includes("stormCloud")) warnings.push(`${label} Грозовое облако: 2 урона и возможные последствия ранения.`);
        if (terrain.includes("turbulence")) warnings.push(`${label} Турбулентность: оглушение +1.`);
      } else {
        for (const hit of MovementEngine.getHazardCollisions(step.terrain, speedBefore, ship.altitude)) {
          warnings.push(`${label} ${hit.text}`);
          speedAfter = Math.max(0, speedAfter - Number(hit.speedLoss ?? 0));
        }
      }
    }
    if (collision) {
      warnings.push(`${collision.title}. Остановка перед контактом; возможно сцепление.`);
      speedAfter = Math.max(0, speedAfter - Number(collision.attackerSpeedLoss ?? 0));
    }
    const inIrons = !creature && WindEngine.isInIrons({ ...ship, heading }, battle.wind);
    if (inIrons) {
      speedAfter = 0;
      warnings.push("Нос против ветра: ход упадёт до 0.");
    }
    const projected = { ...ship, ...stop, heading, speed: speedAfter };
    const altitudeNow = Number(ship.altitude ?? 0);
    const altitudeEnd = creature
      ? this.creatureAltitude(projected)
      : MovementEngine.getVerticalProjection(battle, projected).after;
    const showAltitude = MovementEngine.usesAltitude(battle);
    if (showAltitude && altitudeEnd <= 0 && altitudeNow > 0) warnings.push("К концу раунда ожидается посадка или удар о поверхность.");
    if (!creature && MovementEngine.shipInTerrain(battle, projected, "stormCloud")) {
      warnings.push("В грозовом облаке к концу раунда возможны пожар и нагрев ядра.");
    }
    if (ship.flags?.towingId) warnings.push("Буксируемый корабль займёт вашу исходную клетку.");
    const points = [ship, ...path].map(step => cellToPixel(battle.board, step.x, step.y));
    const center = cellToPixel(battle.board, stop.x, stop.y);
    const contact = collision ? cellToPixel(battle.board, x, y) : null;
    return {
      shipId, shipName: ship.name, x, y, stopX: stop.x, stopY: stop.y,
      destination: `${stop.x + 1}:${stop.y + 1}`, heading,
      renderHeading: normalizeAngle(heading - 90),
      distance: path.length, speedBefore, speedAfter, apCost,
      showAltitude, altitudeNow, altitudeEnd,
      warnings, hasWarnings: warnings.length > 0, collision: Boolean(collision),
      routePoints: points.map(point => `${point.cx},${point.cy}`).join(" "),
      steps: path.map((step, i) => ({ ...cellToPixel(battle.board, step.x, step.y), number: i + 1 })),
      cx: center.cx, cy: center.cy,
      contact: contact ? { cx: contact.cx, cy: contact.cy } : null
    };
  }

  static creatureAltitude(creature) {
    const altitude = Number(creature.altitude ?? 0);
    const hover = creature.movement?.canHover || ["hover", "swarm", "levitating"].includes(creature.movement?.profile);
    return creature.flags?.falling || (!hover && Number(creature.speed ?? 0) <= 0 && altitude > 0)
      ? Math.max(0, altitude - 2) : altitude;
  }
}
