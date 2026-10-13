import { cellToPixel, normalizeAngle, rotateHeading } from "../board/board-geometry.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { MovementReadoutBuilder } from "./movement-readout-builder.js";
import { VictoryEngine } from "../engine/victory-engine.js";
import { WindEngine } from "../engine/wind-engine.js";

/** Read-only forecast: never execute damage, rolls, reservations or movement events. */
export class MovementPlanBuilder {
  static build(battle, shipId, x, y, { apCost = 1, withdraw = false } = {}) {
    const move = MovementEngine.getMoveResult(battle, shipId, x, y);
    if (!move.ok) return null;
    const { ship, candidate } = move;
    const collision = candidate.collision ?? null;
    const path = collision ? move.path.slice(0, -1) : move.path;
    const stop = { x: Number(candidate.stopX ?? x), y: Number(candidate.stopY ?? y) };
    const heading = Number(candidate.heading ?? ship.heading ?? 0);
    const speedBefore = Number(ship.speed ?? 0);
    let speedAfter = candidate.boundary ? 0 : Math.min(speedBefore, Number(candidate.steps ?? 0));
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
      warnings.push("Нос против ветра: тяга парусов 0, накопленный ход сохраняется.");
    }
    const projected = { ...ship, ...stop, heading, speed: speedAfter };
    if (candidate.boundary) warnings.push("Остановка у края поля: ход → 0, граница не наносит урона. Выход из боя — отдельный выбор.");
    const withdrawal = collision ? null : VictoryEngine.getWithdrawalPreview(battle, projected);
    if (withdraw && !withdrawal?.allowed) return null;
    const endOfRound = MovementReadoutBuilder.forecast(battle, withdraw ? { ...projected, flags: { ...projected.flags, withdrawn: true } } : projected);
    warnings.push(...endOfRound.warnings);
    const altitudeNow = Number(ship.altitude ?? 0);
    const altitudeEnd = endOfRound.altitudeEnd;
    const showAltitude = MovementEngine.usesAltitude(battle);
    if (!withdraw && showAltitude && altitudeEnd <= 0 && altitudeNow > 0) warnings.push("К концу раунда ожидается посадка или удар о поверхность.");
    if (!withdraw && !creature && MovementEngine.shipInTerrain(battle, projected, "stormCloud")) {
      warnings.push("В грозовом облаке к концу раунда возможны пожар и нагрев ядра.");
    }
    if (ship.flags?.towingId) warnings.push("Буксируемый корабль займёт вашу исходную клетку.");
    const points = [ship, ...path].map(step => cellToPixel(battle.board, step.x, step.y));
    const center = cellToPixel(battle.board, stop.x, stop.y);
    const contact = collision ? cellToPixel(battle.board, x, y) : null;
    return {
      kind: "move", isMove: true, confirmLabel: withdraw ? "Выполнить и выйти из боя" : collision ? "Подтвердить столкновение" : "Выполнить манёвр",
      note: "Движение завершит активацию. До подтверждения маршрут можно заменить другой клеткой.",
      withdrawal, withdraw, boundary: Boolean(candidate.boundary),
      shipId, shipName: ship.name, x, y, stopX: stop.x, stopY: stop.y,
      destination: `${stop.x + 1}:${stop.y + 1}`, heading,
      renderHeading: normalizeAngle(heading - 90),
      distance: path.length, speedBefore, speedAfter: withdraw ? 0 : speedAfter, apCost,
      showAltitude, altitudeNow, altitudeEnd, endOfRound,
      warnings, hasWarnings: warnings.length > 0, collision: Boolean(collision),
      routePoints: points.map(point => `${point.cx},${point.cy}`).join(" "),
      steps: path.map((step, i) => ({ ...cellToPixel(battle.board, step.x, step.y), number: i + 1 })),
      cx: center.cx, cy: center.cy,
      contact: contact ? { cx: contact.cx, cy: contact.cy } : null
    };
  }

  static stationary(battle, unit, fields) {
    const center = cellToPixel(battle.board, unit.x, unit.y);
    return {
      shipId: unit.id, shipName: unit.name, x: unit.x, y: unit.y, stopX: unit.x, stopY: unit.y,
      destination: (unit.x + 1) + ":" + (unit.y + 1), distance: 0, apCost: 1,
      speedBefore: Number(unit.speed ?? 0), speedAfter: Number(unit.speed ?? 0),
      heading: Number(unit.heading ?? 0), renderHeading: normalizeAngle(Number(unit.heading ?? 0) - 90),
      showAltitude: MovementEngine.usesAltitude(battle), altitudeNow: Number(unit.altitude ?? 0),
      altitudeEnd: Number(unit.altitude ?? 0), warnings: [], steps: [], routePoints: "", cx: center.cx, cy: center.cy,
      ...fields
    };
  }

  static turn(battle, unit, delta) {
    if (![-1, 1].includes(delta) || MovementEngine.getTurnLimit(unit) <= 0) return null;
    const creature = unit.unitType === "creature";
    const assessment = creature ? { needsCheck: false, nextHeading: rotateHeading(unit.heading, delta) }
      : MovementEngine.getTurnAssessment(battle, unit, delta);
    if (assessment.blockedByInertia) return null;
    const heading = assessment.nextHeading;
    const before = Number(unit.speed ?? 0);
    const after = !creature && assessment.leavingIrons && before <= 0
      && MovementEngine.getEffectiveMaxSpeed(battle, { ...unit, heading, flags: { ...unit.flags, inIrons: false } }) > 0 ? 1 : before;
    const projected = { ...unit, heading, speed: after };
    const endOfRound = MovementReadoutBuilder.forecast(battle, projected);
    const warnings = [...endOfRound.warnings];
    if (assessment.enteringIrons) warnings.push("Тяга парусов станет 0; накопленный ход сохранится.");
    if (assessment.needsCheck) warnings.push("Проверка 3d6 ≤ " + assessment.skill + ". При провале курс не изменится; ход станет " + Math.max(0, before - 2) + ". Следующая попытка получает +2.");
    return this.stationary(battle, unit, {
      kind: "turn", isTurn: true, delta, heading, renderHeading: normalizeAngle(heading - 90),
      speedAfter: after, endOfRound, altitudeEnd: endOfRound.altitudeEnd,
      warnings, hasWarnings: warnings.length > 0, assessment,
      confirmLabel: assessment.needsCheck ? "Проверить и повернуть" : "Выполнить поворот",
      note: "Поворот на месте: 1 ОД. Движение не расходуется; активация продолжится, если останутся ОД. Прогноз показан для успеха."
    });
  }

  static withdrawal(battle, unit, { apCost = 1 } = {}) {
    const withdrawal = VictoryEngine.getWithdrawalPreview(battle, unit);
    if (!withdrawal?.allowed) return null;
    return this.stationary(battle, unit, {
      kind: "withdraw", isWithdrawal: true, withdraw: true, withdrawal, apCost,
      speedAfter: 0, confirmLabel: withdrawal.title, hasWarnings: true,
      warnings: [withdrawal.consequence], note: "Подтверждение завершит участие этой боевой единицы в бою."
    });
  }

  static creatureAltitude(creature) {
    const altitude = Number(creature.altitude ?? 0);
    const hover = creature.movement?.canHover || ["hover", "swarm", "levitating"].includes(creature.movement?.profile);
    return creature.flags?.falling || (!hover && Number(creature.speed ?? 0) <= 0 && altitude > 0)
      ? Math.max(0, altitude - 2) : altitude;
  }
}
