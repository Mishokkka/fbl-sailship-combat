import { BattleReportService } from "../services/battle-report-service.js";
import { ALTITUDE_MAX, ALTITUDE_MIN, BOARD_LIMITS, CURRENT_SCHEMA_VERSION, PHASES, SEA_STATE_SEQUENCE, TERRAIN_TYPES, VISIBILITY_SEQUENCE } from "../utils/constants.js";
import { SchemaMigrations } from "../migrations/schema-migrations.js";
import { CombatantNormalizer } from "./combatant-normalizer.js";
import { BattleScenarioService } from "../services/battle-scenario-service.js";
import { normalizeHeading } from "../board/board-geometry.js";
import { WindEngine } from "../engine/wind-engine.js";
import { PlayerControlService } from "../services/player-control-service.js";
import { boundedArray, boundedInteger, boundedString, enumValue, finiteNumber, isPlainObject, plainRecord, uniqueBoundedStrings } from "../utils/schema.js";
import { VisibilityEngine } from "../engine/visibility-engine.js";
import { VictoryEngine } from "../engine/victory-engine.js";
import { repairUniqueIds } from "../utils/identity.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { CreatureGrappleEngine } from "../engine/creature-grapple-engine.js";

function newId(prefix = "id") {
  return foundry.utils.randomID?.() ?? crypto.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export class BattleNormalizer {
  static normalize(battle) {
    return this.normalizeBattle(battle);
  }

  static normalizeBattle(battle) {
    battle = isPlainObject(battle) ? battle : {};
    SchemaMigrations.migrateBattle(battle);
    battle.schemaVersion = CURRENT_SCHEMA_VERSION;
    battle.id = boundedString(battle.id, { fallback: newId("battle"), maxLength: 128 });
    battle.name = boundedString(battle.name, { fallback: "Морской бой", maxLength: 256 }) || "Морской бой";
    battle.round = boundedInteger(battle.round, { fallback: 1, min: 1, max: 1_000_000 });
    battle.phase = enumValue(battle.phase, PHASES, "orders");
    battle.revision = boundedInteger(battle.revision, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
    const setupConfirmedDefault = battle.round > 1 || battle.phase !== "orders";
    battle.setupConfirmed = battle.setupConfirmed == null ? setupConfirmedDefault : Boolean(battle.setupConfirmed);
    this.normalizeBoard(battle);
    this.normalizeEnvironment(battle);
    this.normalizeTurnState(battle);
    this.normalizeSetup(battle);
    battle.ships = boundedArray(battle.ships, { maxLength: 200 }).filter(isPlainObject);
    battle.log = boundedArray(battle.log, { maxLength: 200 }).filter(isPlainObject).map(entry => ({
      ...entry,
      id: boundedString(entry.id, { fallback: newId("log"), maxLength: 128 }),
      round: boundedInteger(entry.round, { fallback: battle.round, min: 1, max: 1_000_000 }),
      phase: enumValue(entry.phase, PHASES, battle.phase),
      text: boundedString(entry.text, { maxLength: 4000, trim: false }),
      ts: boundedString(entry.ts, { maxLength: 64 })
    }));
    battle.processedActionIds = uniqueBoundedStrings(battle.processedActionIds, { maxItems: 200, maxLength: 128 });
    delete battle.lastUpdateReason;

    for (const ship of battle.ships) {
      CombatantNormalizer.normalize(ship, { battleRound: battle.round ?? 1 });
      ship.x = boundedInteger(ship.x, { fallback: 0, min: 0, max: battle.board.width - 1 });
      ship.y = boundedInteger(ship.y, { fallback: 0, min: 0, max: battle.board.height - 1 });
      if (CombatantRules.supports(ship, "wind")) WindEngine.syncInIronsFlag(ship, battle.wind ?? {});
    }
    repairUniqueIds(battle.ships, { prefix: "unit", maxLength: 128 });
    CreatureGrappleEngine.normalizeLinks(battle);
    VictoryEngine.normalizeBattleState(battle);
    BattleScenarioService.applyModeToBattle(battle);
    this.normalizePresentationEvents(battle);
    const report = BattleReportService.normalize(battle.lastReport, battle);
    if (report) battle.lastReport = report;
    else delete battle.lastReport;
    PlayerControlService.normalizePlayerState(battle);
    VisibilityEngine.normalizeState(battle);

    this.ensureActiveShip(battle);
    return battle;
  }

  static normalizeBoard(battle) {
    battle.board = isPlainObject(battle.board) ? battle.board : {
      width: BOARD_LIMITS.defaultWidth,
      height: BOARD_LIMITS.defaultHeight,
      cellSize: BOARD_LIMITS.defaultCellSize
    };
    battle.board.width = boundedInteger(battle.board.width, { fallback: BOARD_LIMITS.defaultWidth, min: BOARD_LIMITS.minWidth, max: BOARD_LIMITS.maxWidth });
    battle.board.height = boundedInteger(battle.board.height, { fallback: BOARD_LIMITS.defaultHeight, min: BOARD_LIMITS.minHeight, max: BOARD_LIMITS.maxHeight });
    battle.board.cellSize = boundedInteger(battle.board.cellSize, { fallback: BOARD_LIMITS.defaultCellSize, min: BOARD_LIMITS.minCellSize, max: BOARD_LIMITS.maxCellSize });
    battle.board.terrainRevision = boundedInteger(battle.board.terrainRevision, { fallback: 1, min: 1, max: Number.MAX_SAFE_INTEGER });
    this.normalizeBoardBackground(battle.board);
    battle.board.terrain = plainRecord(battle.board.terrain);
    const allowedTerrain = new Set(TERRAIN_TYPES);
    for (const [key, value] of Object.entries(battle.board.terrain)) {
      const [xRaw, yRaw] = String(key).split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      const values = Array.isArray(value) ? value : [value];
      let clean = [...new Set(values.filter(v => allowedTerrain.has(v)))];
      if (clean.includes("rockHigh")) clean = ["rockHigh"];
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= battle.board.width || y >= battle.board.height || !clean.length) {
        delete battle.board.terrain[key];
      } else {
        battle.board.terrain[key] = clean;
      }
    }
  }

  static normalizeBoardBackground(board) {
    const source = board.background && typeof board.background === "object" && !Array.isArray(board.background) ? board.background : {};
    const src = String(source.src ?? source.url ?? "").trim().slice(0, 512);
    const opacity = finiteNumber(source.opacity, { fallback: 0.35, min: 0, max: 1 });
    const tileSize = boundedInteger(source.tileSize, { fallback: 512, min: 64, max: 2048 });
    board.background = {
      enabled: Boolean(source.enabled ?? source.show) && src.length > 0,
      src,
      opacity,
      tileSize
    };
  }

  static normalizeEnvironment(battle) {
    battle.wind = isPlainObject(battle.wind) ? battle.wind : { direction: 240, strength: "moderate" };
    battle.wind.direction = normalizeHeading(battle.wind.direction ?? 240);
    battle.wind.strength = ["calm", "light", "moderate", "strong", "storm"].includes(battle.wind.strength) ? battle.wind.strength : "moderate";
    battle.sea = isPlainObject(battle.sea) ? battle.sea : { state: "calm", visibility: "clear" };
    battle.sea.state = enumValue(battle.sea.state, SEA_STATE_SEQUENCE, "calm");
    battle.sea.visibility = enumValue(battle.sea.visibility, VISIBILITY_SEQUENCE, "clear");
  }

  static normalizeSetup(battle) {
    BattleScenarioService.normalizeSetupZones(battle);
    battle.setup.scenarioName = boundedString(battle.setup.scenarioName, { fallback: battle.name ?? "Сценарий", maxLength: 256 }) || "Сценарий";
    battle.setup.terrainGenerator = battle.setup.terrainGenerator == null
      ? null
      : boundedString(battle.setup.terrainGenerator, { maxLength: 128 });
    battle.setup.terrainSeed = battle.setup.terrainSeed == null
      ? null
      : boundedString(battle.setup.terrainSeed, { maxLength: 128 });
    battle.setup.mode = BattleScenarioService.normalizeMode(battle.setup.mode);
  }

  static normalizeTurnState(battle) {
    battle.turn = plainRecord(battle.turn);
    battle.turn.activeShipId ??= null;
    battle.turn.actions = plainRecord(battle.turn.actions);
    battle.turn.phaseOrder = plainRecord(battle.turn.phaseOrder);
    battle.turn.initiative = plainRecord(battle.turn.initiative);
    battle.turn.completed = plainRecord(battle.turn.completed);
    const reservations = plainRecord(battle.turn.movementReservations);
    battle.turn.movementReservations = {};
    for (const [key, raw] of Object.entries(reservations).slice(0, 200)) {
      if (!isPlainObject(raw)) continue;
      const shipId = boundedString(raw.shipId ?? key, { maxLength: 128 });
      if (!shipId) continue;
      battle.turn.movementReservations[shipId] = {
        shipId,
        round: boundedInteger(raw.round, { fallback: battle.round, min: 1, max: 1_000_000 }),
        altitude: boundedInteger(raw.altitude, { fallback: 0, min: ALTITUDE_MIN, max: ALTITUDE_MAX }),
        speed: finiteNumber(raw.speed, { fallback: 0, min: 0, max: 100 }),
        heading: normalizeHeading(raw.heading),
        stop: {
          x: boundedInteger(raw.stop?.x, { fallback: 0, min: 0, max: battle.board.width - 1 }),
          y: boundedInteger(raw.stop?.y, { fallback: 0, min: 0, max: battle.board.height - 1 })
        },
        path: boundedArray(raw.path, { maxLength: 101 }).filter(isPlainObject).map((cell, index) => ({
          shipId,
          x: boundedInteger(cell.x, { fallback: 0, min: 0, max: battle.board.width - 1 }),
          y: boundedInteger(cell.y, { fallback: 0, min: 0, max: battle.board.height - 1 }),
          key: boundedString(cell.key, { maxLength: 64 }),
          altitude: boundedInteger(cell.altitude, { fallback: raw.altitude, min: ALTITUDE_MIN, max: ALTITUDE_MAX }),
          step: boundedInteger(cell.step, { fallback: index, min: 0, max: 100 }),
          heading: normalizeHeading(cell.heading ?? raw.heading)
        }))
      };
    }

    for (const phase of PHASES) {
      battle.turn.completed[phase] = uniqueBoundedStrings(battle.turn.completed[phase], { maxItems: 200, maxLength: 128 });
      battle.turn.phaseOrder[phase] = uniqueBoundedStrings(battle.turn.phaseOrder[phase], { maxItems: 200, maxLength: 128 });
      battle.turn.initiative[phase] = plainRecord(battle.turn.initiative[phase]);
    }
  }

  static normalizePresentationEvents(battle) {
    const shipIds = new Set((battle.ships ?? []).map(ship => ship.id));
    const movement = plainRecord(battle.lastMovement);
    if (movement.id && shipIds.has(movement.shipId)) {
      const normalizePoint = point => ({
        x: boundedInteger(point?.x, { fallback: 0, min: 0, max: battle.board.width - 1 }),
        y: boundedInteger(point?.y, { fallback: 0, min: 0, max: battle.board.height - 1 }),
        heading: normalizeHeading(point?.heading)
      });
      battle.lastMovement = {
        id: boundedString(movement.id, { maxLength: 160 }),
        shipId: boundedString(movement.shipId, { maxLength: 128 }),
        round: boundedInteger(movement.round, { fallback: battle.round, min: 1, max: 1_000_000 }),
        phase: enumValue(movement.phase, PHASES, "movement"),
        timestamp: finiteNumber(movement.timestamp, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER }),
        start: normalizePoint(movement.start),
        path: boundedArray(movement.path, { maxLength: 100 }).filter(isPlainObject).map(normalizePoint),
        end: normalizePoint(movement.end),
        collision: Boolean(movement.collision)
      };
    } else {
      delete battle.lastMovement;
    }

    const audio = plainRecord(battle.lastAudioEvent);
    const audioTypes = new Set(["movement", "collision", "gunfire", "creatureAttack", "phase"]);
    if (audio.id && audioTypes.has(audio.type) && (!audio.shipId || shipIds.has(audio.shipId))) {
      battle.lastAudioEvent = {
        id: boundedString(audio.id, { maxLength: 180 }),
        type: audio.type,
        shipId: audio.shipId ? boundedString(audio.shipId, { maxLength: 128 }) : null,
        timestamp: finiteNumber(audio.timestamp, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER })
      };
    } else {
      delete battle.lastAudioEvent;
    }
  }

  static ensureActiveShip(battle) {
    const eligible = battle.ships.filter(unit => CombatantRules.isEligibleForPhase(unit, battle.phase));
    const activeExists = eligible.some(unit => unit.id === battle.turn.activeShipId);
    if (activeExists) return;
    const activationPhases = ["orders", "movement", "gunnery", "crew"];
    const completed = new Set(battle.turn.completed?.[battle.phase] ?? []);
    const allDone = activationPhases.includes(battle.phase) && eligible.length > 0 && eligible.every(unit => completed.has(unit.id));
    if (allDone) battle.turn.activeShipId = null;
    else battle.turn.activeShipId = eligible.find(unit => !completed.has(unit.id))?.id ?? eligible[0]?.id ?? null;
  }
}
