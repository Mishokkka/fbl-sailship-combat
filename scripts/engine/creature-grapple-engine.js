import { distanceCells, headingToVector } from "../board/board-geometry.js";
import { getCombatant, getCombatants } from "../utils/combatants.js";
import { roll3d6 } from "../utils/random.js";
import { OccupancyEngine } from "./occupancy-engine.js";
import { CreatureDamageEngine } from "./creature-damage-engine.js";

export class CreatureGrappleEngine {
  static getHost(battle, creature) {
    const hostId = creature?.flags?.attachedTo;
    if (!hostId) return null;
    const host = getCombatant(battle, hostId);
    return host?.unitType === "ship" ? host : null;
  }

  static getAttachedCreatures(battle, ship) {
    if (!ship || ship.unitType !== "ship") return [];
    const ids = new Set(Array.isArray(ship.flags?.attachedCreatureIds) ? ship.flags.attachedCreatureIds : []);
    return getCombatants(battle).filter(unit => unit.unitType === "creature"
      && (unit.flags?.attachedTo === ship.id || (!unit.flags?.attachedTo && ids.has(unit.id))));
  }

  static isAttached(creature) {
    return Boolean(creature?.unitType === "creature" && creature.flags?.attachedTo);
  }

  static canAttach(battle, creature, ship) {
    if (!creature || creature.unitType !== "creature" || !ship || ship.unitType !== "ship") return false;
    if (creature.flags?.struck || creature.flags?.withdrawn || creature.flags?.falling || ship.flags?.struck) return false;
    if (this.isAttached(creature)) return false;
    if (Number(creature.altitude ?? 0) !== Number(ship.altitude ?? 0)) return false;
    return distanceCells(creature, ship) <= 1;
  }

  static attach(battle, creatureId, shipId) {
    const creature = getCombatant(battle, creatureId);
    const ship = getCombatant(battle, shipId);
    if (!this.canAttach(battle, creature, ship)) {
      return { ok: false, text: "Захват невозможен: существо и корабль должны быть рядом, на одной высоте и не выбывшими из боя." };
    }
    creature.flags ??= {};
    ship.flags ??= {};
    creature.flags.falling = false;
    creature.flags.fallReason = null;
    creature.flags.attachedTo = ship.id;
    ship.flags.attachedCreatureIds = [...new Set([...(ship.flags.attachedCreatureIds ?? []), creature.id])];
    creature.x = Number(ship.x ?? 0);
    creature.y = Number(ship.y ?? 0);
    creature.altitude = Number(ship.altitude ?? 0);
    creature.speed = 0;
    creature.verticalVelocity = 0;
    return { ok: true, creature, ship, text: `${creature.name}: цепляется за ${ship.name}. Существо перемещается вместе с кораблем и может атаковать его в упор.` };
  }

  static findDetachCell(battle, creature, host) {
    const headings = [0, 60, 120, 180, 240, 300];
    const preferred = Number(creature?.heading ?? 0);
    headings.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
    for (const heading of headings) {
      const vector = headingToVector(heading, host.x, host.y);
      const x = Number(host.x ?? 0) + vector.dx;
      const y = Number(host.y ?? 0) + vector.dy;
      if (x < 0 || y < 0 || x >= Number(battle?.board?.width ?? 0) || y >= Number(battle?.board?.height ?? 0)) continue;
      const occupied = OccupancyEngine.findShipAt(battle, x, y, host.altitude, { excludeShipId: creature.id });
      if (!occupied) return { x, y, heading };
    }
    return null;
  }

  static detach(battle, creatureId, { reason = "", force = false } = {}) {
    const creature = getCombatant(battle, creatureId);
    if (!creature || creature.unitType !== "creature") return { ok: false, text: "Существо не найдено." };
    const host = this.getHost(battle, creature);
    if (!host) {
      if (creature.flags) delete creature.flags.attachedTo;
      return { ok: false, text: `${creature.name}: существо не держится за корабль.` };
    }
    const cell = this.findDetachCell(battle, creature, host);
    if (!cell && !force) return { ok: false, text: `${creature.name}: рядом нет свободной клетки для отцепления.` };
    if (cell) {
      creature.x = cell.x;
      creature.y = cell.y;
      creature.heading = cell.heading;
      creature.altitude = Number(host.altitude ?? creature.altitude ?? 0);
    }
    creature.flags ??= {};
    delete creature.flags.attachedTo;
    host.flags ??= {};
    host.flags.attachedCreatureIds = (host.flags.attachedCreatureIds ?? []).filter(id => id !== creature.id);
    if (!host.flags.attachedCreatureIds.length) delete host.flags.attachedCreatureIds;
    return { ok: true, creature, ship: host, text: `${creature.name}: отцепляется от ${host.name}${reason ? ` (${reason})` : ""}.` };
  }

  static syncAttached(battle, shipOrId = null) {
    const host = typeof shipOrId === "string" ? getCombatant(battle, shipOrId) : shipOrId;
    const hosts = host?.unitType === "ship" ? [host] : getCombatants(battle).filter(unit => unit.unitType === "ship");
    for (const ship of hosts) {
      for (const creature of this.getAttachedCreatures(battle, ship)) {
        if (creature.flags?.struck || creature.flags?.withdrawn || ship.flags?.struck || ship.flags?.withdrawn) {
          const reason = ship.flags?.struck || ship.flags?.withdrawn ? "корабль выбыл из боя" : "существо выбыло из боя";
          this.detach(battle, creature.id, { reason, force: true });
          continue;
        }
        creature.flags ??= {};
        creature.flags.attachedTo = ship.id;
        creature.x = Number(ship.x ?? 0);
        creature.y = Number(ship.y ?? 0);
        creature.altitude = Number(ship.altitude ?? 0);
        creature.speed = 0;
        creature.verticalVelocity = 0;
      }
      ship.flags ??= {};
      const ids = this.getAttachedCreatures(battle, ship).map(creature => creature.id);
      if (ids.length) ship.flags.attachedCreatureIds = ids;
      else delete ship.flags.attachedCreatureIds;
    }
  }

  static normalizeLinks(battle) {
    const combatants = getCombatants(battle);
    const byId = new Map(combatants.map(unit => [unit.id, unit]));
    for (const unit of combatants) {
      unit.flags ??= {};
      if (unit.unitType === "creature" && unit.flags.attachedTo && byId.get(unit.flags.attachedTo)?.unitType !== "ship") delete unit.flags.attachedTo;
      if (unit.unitType === "ship" && Array.isArray(unit.flags.attachedCreatureIds)) {
        unit.flags.attachedCreatureIds = [...new Set(unit.flags.attachedCreatureIds.filter(id => byId.get(id)?.unitType === "creature"))];
        if (!unit.flags.attachedCreatureIds.length) delete unit.flags.attachedCreatureIds;
      }
    }
    // Accept legacy host-side links only when the creature has no authoritative host.
    for (const ship of combatants.filter(unit => unit.unitType === "ship")) {
      for (const creatureId of ship.flags?.attachedCreatureIds ?? []) {
        const creature = byId.get(creatureId);
        if (creature?.unitType === "creature" && !creature.flags?.attachedTo) creature.flags.attachedTo = ship.id;
      }
    }
    this.syncAttached(battle);
    return battle;
  }

  static repel(battle, shipId, creatureId = null, { random = Math.random } = {}) {
    const ship = getCombatant(battle, shipId);
    if (!ship || ship.unitType !== "ship") return { ok: false, text: "Корабль не найден." };
    const attached = this.getAttachedCreatures(battle, ship);
    const creature = creatureId ? attached.find(unit => unit.id === creatureId) : attached[0];
    if (!creature) return { ok: false, text: `${ship.name}: на корпусе нет прицепившихся существ.` };
    if (!this.findDetachCell(battle, creature, ship)) return { ok: false, text: `${ship.name}: вокруг нет свободной клетки, куда можно сбросить ${creature.name}.` };

    const crew = Number(ship.crew?.current ?? 0);
    const morale = Number(ship.crew?.morale ?? 10);
    const quality = Number(ship.stats?.crewQuality ?? 0);
    const attackScore = Math.floor(crew / 25) + morale - 5 + quality + roll3d6(random);
    const holdScore = Number(creature.stats?.sm ?? 5) + Number(creature.stats?.stability ?? 4) + roll3d6(random);
    if (attackScore >= holdScore) {
      const detach = this.detach(battle, creature.id, { reason: "экипаж сбрасывает чудовище" });
      const damage = CreatureDamageEngine.applyDamage(creature, Math.max(4, Math.ceil((attackScore - holdScore + 1) / 2)), { ignoreArmor: true, tags: ["stun"] });
      return { ok: true, success: true, text: `${ship.name}: экипаж отбивает ${creature.name} (${attackScore} против ${holdScore}). ${detach.text} ${damage.text}` };
    }

    const losses = Math.max(1, Math.ceil((holdScore - attackScore) / 3));
    ship.crew.current = Math.max(0, crew - losses);
    ship.crew.casualties = Number(ship.crew.casualties ?? 0) + losses;
    ship.crew.morale = Math.max(0, morale - 1);
    return { ok: true, success: false, text: `${ship.name}: попытка сбросить ${creature.name} проваливается (${attackScore} против ${holdScore}). Потери экипажа: ${losses}, мораль -1.` };
  }
}
