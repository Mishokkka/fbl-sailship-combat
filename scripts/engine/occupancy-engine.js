import { cellKey } from "../board/board-geometry.js";
import { CombatantRules } from "../rules/combatant-rules.js";

export class OccupancyEngine {
  static altitudeOf(ship) {
    return Math.max(0, Math.floor(Number(ship?.altitude ?? 0)));
  }

  static sharesAltitude(a, b) {
    return this.altitudeOf(a) === this.altitudeOf(b);
  }

  static getOccupiedCells(ship) {
    if (!ship) return [];
    const x = Number(ship.x ?? 0);
    const y = Number(ship.y ?? 0);
    return [{ shipId: ship.id, x, y, key: cellKey(x, y), altitude: this.altitudeOf(ship) }];
  }

  static findShipAt(battle, x, y, altitude, { excludeShipId = null } = {}) {
    const level = Math.max(0, Math.floor(Number(altitude ?? 0)));
    return (battle?.ships ?? []).find(ship => ship.id !== excludeShipId
      && CombatantRules.occupiesCell(ship)
      && Number(ship.x ?? 0) === Number(x)
      && Number(ship.y ?? 0) === Number(y)
      && this.altitudeOf(ship) === level) ?? null;
  }

  static getSweptCells(ship, path = []) {
    const altitude = this.altitudeOf(ship);
    const startX = Number(ship?.x ?? 0);
    const startY = Number(ship?.y ?? 0);
    return [
      { shipId: ship?.id, x: startX, y: startY, key: cellKey(startX, startY), altitude, step: 0, heading: Number(ship?.heading ?? 0) },
      ...path.map((cell, index) => ({
        shipId: ship?.id,
        x: Number(cell.x ?? 0),
        y: Number(cell.y ?? 0),
        key: cell.key ?? cellKey(cell.x, cell.y),
        altitude,
        step: Number(cell.step ?? index + 1),
        heading: Number(cell.heading ?? ship?.heading ?? 0)
      }))
    ];
  }

  static reserveMovement(battle, ship, path = [], { startX = null, startY = null, startHeading = null, stopX = null, stopY = null } = {}) {
    battle.turn ??= {};
    battle.turn.movementReservations ??= {};
    const origin = {
      ...ship,
      x: Number(startX ?? ship.x ?? 0),
      y: Number(startY ?? ship.y ?? 0),
      heading: Number(startHeading ?? ship.heading ?? 0)
    };
    const swept = this.getSweptCells(origin, path);
    battle.turn.movementReservations[ship.id] = {
      shipId: ship.id,
      round: Number(battle.round ?? 0),
      altitude: this.altitudeOf(ship),
      speed: Number(ship.speed ?? 0),
      heading: Number(ship.heading ?? 0),
      stop: {
        x: Number(stopX ?? ship.x ?? 0),
        y: Number(stopY ?? ship.y ?? 0)
      },
      path: swept
    };
    return battle.turn.movementReservations[ship.id];
  }

  static getActiveReservations(battle, excludeShipId = null) {
    const reservations = Object.values(battle?.turn?.movementReservations ?? {});
    return reservations.filter(entry => entry?.shipId
      && entry.shipId !== excludeShipId
      && CombatantRules.isOperational((battle?.ships ?? []).find(unit => unit.id === entry.shipId))
      && Number(entry.round ?? -1) === Number(battle?.round ?? 0)
      && Number(entry.altitude ?? 0) >= 0
      && Array.isArray(entry.path));
  }

  static findConflict(battle, ship, cell, previousCell = null) {
    const directShip = this.findShipAt(battle, cell.x, cell.y, ship?.altitude, { excludeShipId: ship?.id });
    if (directShip) return { kind: "occupied", targetShip: directShip, targetShipId: directShip.id, targetStep: null };

    const step = Number(cell?.step ?? 0);
    for (const reservation of this.getActiveReservations(battle, ship?.id)) {
      if (Number(reservation.altitude ?? 0) !== this.altitudeOf(ship)) continue;
      const sameStep = reservation.path.find(entry => Number(entry.step ?? -1) === step);
      if (sameStep && Number(sameStep.x) === Number(cell.x) && Number(sameStep.y) === Number(cell.y)) {
        return {
          kind: "crossing",
          targetShip: (battle?.ships ?? []).find(candidate => candidate.id === reservation.shipId) ?? null,
          targetShipId: reservation.shipId,
          targetStep: sameStep,
          reservation
        };
      }

      if (!previousCell || !sameStep) continue;
      const targetPrevious = reservation.path.find(entry => Number(entry.step ?? -1) === step - 1);
      if (targetPrevious
        && Number(sameStep.x) === Number(previousCell.x)
        && Number(sameStep.y) === Number(previousCell.y)
        && Number(targetPrevious.x) === Number(cell.x)
        && Number(targetPrevious.y) === Number(cell.y)) {
        return {
          kind: "swap",
          targetShip: (battle?.ships ?? []).find(candidate => candidate.id === reservation.shipId) ?? null,
          targetShipId: reservation.shipId,
          targetStep: sameStep,
          reservation
        };
      }
    }
    return null;
  }
}
