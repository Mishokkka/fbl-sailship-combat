import { distanceCells } from "../board/board-geometry.js";
import { boundedArray, boundedInteger, boundedString, enumValue, isPlainObject, plainRecord } from "../utils/schema.js";
import { ALTITUDE_MAX, ALTITUDE_MIN } from "../utils/constants.js";
import { getCombatants } from "../utils/combatants.js";
import { CombatantRules } from "../rules/combatant-rules.js";

const CONTACT_STATES = new Set(["detected", "identified", "lost"]);
const BASE_DETECTION_RANGE = Object.freeze({ clear: 12, haze: 9, fog: 6, night: 5 });
const SEA_RANGE_PENALTY = Object.freeze({ calm: 0, choppy: 0, rough: 1, heavy: 2, storm: 3 });

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

export class VisibilityEngine {
  static normalizeState(battle) {
    const source = plainRecord(battle.playerVisibility);
    const contacts = plainRecord(source.contacts);
    const observations = plainRecord(source.observations);
    const shipIds = new Set(getCombatants(battle).map(ship => ship.id));
    const assignedUsers = new Set(Object.keys(battle.playerAssignments ?? {}));
    const clean = { contacts: {}, observations: {} };

    for (const userId of assignedUsers) {
      clean.contacts[userId] = {};
      for (const [shipId, raw] of Object.entries(plainRecord(contacts[userId])).slice(0, 200)) {
        if (!shipIds.has(shipId) || !isPlainObject(raw)) continue;
        clean.contacts[userId][shipId] = {
          shipId,
          unitType: String(raw.unitType ?? "ship") === "creature" ? "creature" : "ship",
          state: enumValue(raw.state, CONTACT_STATES, "lost"),
          x: boundedInteger(raw.x, { fallback: 0, min: 0, max: Math.max(0, Number(battle.board?.width ?? 1) - 1) }),
          y: boundedInteger(raw.y, { fallback: 0, min: 0, max: Math.max(0, Number(battle.board?.height ?? 1) - 1) }),
          altitude: boundedInteger(raw.altitude, { fallback: 0, min: ALTITUDE_MIN, max: ALTITUDE_MAX }),
          heading: boundedInteger(raw.heading, { fallback: 0, min: 0, max: 359 }),
          name: raw.name ? boundedString(raw.name, { maxLength: 256 }) : "",
          side: raw.side ? boundedString(raw.side, { maxLength: 64 }) : "",
          flags: {
            struck: Boolean(raw.flags?.struck),
            falling: Boolean(raw.flags?.falling),
            coreExploded: Boolean(raw.flags?.coreExploded),
            abandoned: Boolean(raw.flags?.abandoned)
          },
          lastSeenRound: boundedInteger(raw.lastSeenRound, { fallback: battle.round, min: 1, max: 1_000_000 }),
          lastSeenPhase: boundedString(raw.lastSeenPhase, { fallback: battle.phase, maxLength: 32 })
        };
      }
      clean.observations[userId] = boundedArray(observations[userId], { maxLength: 100 })
        .filter(isPlainObject)
        .map(entry => ({
          id: boundedString(entry.id, { maxLength: 128 }),
          round: boundedInteger(entry.round, { fallback: battle.round, min: 1, max: 1_000_000 }),
          phase: boundedString(entry.phase, { fallback: battle.phase, maxLength: 32 }),
          text: boundedString(entry.text, { maxLength: 1000, trim: false }),
          ts: boundedString(entry.ts, { maxLength: 64 })
        }));
    }
    battle.playerVisibility = clean;
    return clean;
  }

  static getDetectionRange(battle, observer, target) {
    const visibility = String(battle?.sea?.visibility ?? "clear");
    const sea = String(battle?.sea?.state ?? "calm");
    const base = Number(BASE_DETECTION_RANGE[visibility] ?? 8) - Number(SEA_RANGE_PENALTY[sea] ?? 0);
    const targetSize = Math.max(-1, Math.min(3, Math.floor((Number(target?.stats?.sm ?? 7) - 7) / 2)));
    const altitudeAdvantage = Number(observer?.altitude ?? 0) > Number(target?.altitude ?? 0) ? 1 : 0;
    const camouflagePenalty = Number(target?.flags?.camouflaged ?? 0) > 0 ? 2 : 0;
    return Math.max(2, base + targetSize + altitudeAdvantage - camouflagePenalty);
  }

  static assessContact(battle, observers, target, assignment = {}) {
    const friendly = observers.some(observer => observer.side === target.side)
      || (assignment.side && assignment.side !== "mixed" && assignment.side === target.side);
    if (friendly) return { state: "identified", distance: 0 };

    let best = null;
    for (const observer of observers) {
      if (!observer || observer.flags?.struck) continue;
      const distance = distanceCells(observer, target);
      const range = this.getDetectionRange(battle, observer, target);
      if (distance > range) continue;
      const altitudeDelta = Math.abs(Number(observer.altitude ?? 0) - Number(target.altitude ?? 0));
      if (battle?.setup?.mode !== "sea" && altitudeDelta > 4) continue;
      const state = distance <= Math.max(2, Math.floor(range * 0.6)) ? "identified" : "detected";
      if (!best || state === "identified" || distance < best.distance) best = { state, distance, range };
    }
    return best;
  }

  static updateContacts(battle) {
    this.normalizeState(battle);
    const shipsById = new Map(getCombatants(battle).map(ship => [ship.id, ship]));
    for (const [userId, assignment] of Object.entries(battle.playerAssignments ?? {})) {
      const controlled = new Set(assignment?.shipIds ?? []);
      const observers = [...controlled].map(id => shipsById.get(id)).filter(Boolean);
      const contacts = battle.playerVisibility.contacts[userId] ??= {};
      for (const target of getCombatants(battle)) {
        if (!CombatantRules.isOperational(target) || controlled.has(target.id)) continue;
        const previous = contacts[target.id] ?? null;
        const assessment = this.assessContact(battle, observers, target, assignment);
        if (!assessment) {
          if (previous && previous.state !== "lost") {
            contacts[target.id] = { ...previous, state: "lost" };
            this.addObservation(battle, userId, `Контакт потерян у клетки ${previous.x + 1}:${previous.y + 1}.`);
          }
          continue;
        }

        const identified = assessment.state === "identified";
        contacts[target.id] = {
          shipId: target.id,
          unitType: CombatantRules.typeOf(target),
          state: assessment.state,
          x: Number(target.x ?? 0),
          y: Number(target.y ?? 0),
          altitude: Number(target.altitude ?? 0),
          heading: Number(target.heading ?? 0),
          name: identified ? String(target.name ?? "") : "",
          side: identified ? String(target.side ?? "") : "",
          flags: this.getPublicFlags(target),
          lastSeenRound: Number(battle.round ?? 1),
          lastSeenPhase: String(battle.phase ?? "orders")
        };
        if (!previous || previous.state !== assessment.state) {
          const label = identified ? target.name : "Неопознанный контакт";
          const action = identified ? "опознан" : "обнаружен";
          this.addObservation(battle, userId, `${label}: ${action} в клетке ${Number(target.x ?? 0) + 1}:${Number(target.y ?? 0) + 1}.`);
        }
      }
    }
    this.normalizeState(battle);
    return battle.playerVisibility;
  }

  static getContact(battle, userId, ship) {
    const stored = battle?.playerVisibility?.contacts?.[userId]?.[ship?.id];
    if (stored) return clone(stored);
    const assignment = battle?.playerAssignments?.[userId] ?? {};
    const controlled = new Set(assignment.shipIds ?? []);
    const observers = getCombatants(battle).filter(candidate => controlled.has(candidate.id));
    const assessment = this.assessContact(battle, observers, ship, assignment);
    if (!assessment) return null;
    const identified = assessment.state === "identified";
    return {
      shipId: ship.id,
      unitType: CombatantRules.typeOf(ship),
      state: assessment.state,
      x: Number(ship.x ?? 0),
      y: Number(ship.y ?? 0),
      altitude: Number(ship.altitude ?? 0),
      heading: Number(ship.heading ?? 0),
      name: identified ? String(ship.name ?? "") : "",
      side: identified ? String(ship.side ?? "") : "",
      flags: this.getPublicFlags(ship),
      lastSeenRound: Number(battle.round ?? 1),
      lastSeenPhase: String(battle.phase ?? "orders")
    };
  }

  static addObservation(battle, userId, text) {
    battle.playerVisibility ??= { contacts: {}, observations: {} };
    battle.playerVisibility.observations ??= {};
    const entries = battle.playerVisibility.observations[userId] ??= [];
    entries.push({
      id: `observation-${Date.now()}-${entries.length}`,
      round: Number(battle.round ?? 1),
      phase: String(battle.phase ?? "orders"),
      text: String(text ?? ""),
      ts: new Date().toISOString()
    });
    if (entries.length > 100) entries.splice(0, entries.length - 100);
  }

  static getPublicFlags(ship) {
    return {
      struck: Boolean(ship?.flags?.struck),
      falling: Boolean(ship?.flags?.falling),
      coreExploded: Boolean(ship?.flags?.coreExploded),
      abandoned: Boolean(ship?.flags?.abandoned)
    };
  }
}
