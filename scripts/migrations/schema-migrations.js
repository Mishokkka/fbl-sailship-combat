import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { createShip } from "../data/ship-factory.js";

const LEGACY_GENERATED_WEAPON_LABELS = new Set([
  "Левый борт",
  "Правый борт",
  "Носовые чэйзеры",
  "Кормовые чэйзеры",
  "Палубные мортиры",
  "Поворотные пушки"
]);

const PHASE_IDS = Object.freeze(["orders", "movement", "gunnery", "damage", "crew", "end"]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function schemaVersion(value) {
  const version = Number(value ?? 0);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

function ensurePhaseRecords(turn) {
  turn.actions = record(turn.actions);
  turn.phaseOrder = record(turn.phaseOrder);
  turn.initiative = record(turn.initiative);
  turn.completed = record(turn.completed);
  for (const phase of PHASE_IDS) {
    turn.phaseOrder[phase] = array(turn.phaseOrder[phase]);
    turn.initiative[phase] = record(turn.initiative[phase]);
    turn.completed[phase] = array(turn.completed[phase]);
  }
}

function migrate0To1(battle) {
  SchemaMigrations._migrateLegacyBattle(battle);
}

function migrate1To2(battle) {
  battle.revision ??= 0;
  battle.log = array(battle.log);
  battle.board = record(battle.board);
  battle.board.terrainRevision ??= 1;
}

function migrate2To3(battle) {
  battle.wind = record(battle.wind);
  battle.wind.direction ??= 240;
  battle.wind.strength ??= "moderate";
  battle.sea = record(battle.sea);
  battle.sea.state ??= "calm";
  battle.sea.visibility ??= "clear";
  battle.setup = record(battle.setup);
  battle.setup.scenarioName ??= battle.name ?? "Сценарий";
}

function migrate3To4(battle) {
  // Вооружение v4 мигрируется на уровне кораблей после прохода по бою.
  battle.ships = array(battle.ships);
}

function migrate4To5(battle) {
  battle.setupConfirmed ??= (Number(battle.round ?? 1) > 1 || battle.phase !== "orders");
  battle.ships = array(battle.ships);
}

function migrate5To6(battle) {
  battle.turn = record(battle.turn);
  battle.turn.movementReservations = record(battle.turn.movementReservations);
  ensurePhaseRecords(battle.turn);
}

function migrate6To7(battle) {
  battle.playerAssignments = record(battle.playerAssignments);
  battle.pendingOrders = record(battle.pendingOrders);
}

function migrate7To8(battle) {
  battle.playerVisibility = record(battle.playerVisibility);
  battle.playerVisibility.contacts = record(battle.playerVisibility.contacts);
  battle.playerVisibility.observations = record(battle.playerVisibility.observations);
}

function migrate8To9(battle) {
  battle.setup = record(battle.setup);
  battle.setup.mode ??= "mixed";
  battle.setup.zones = record(battle.setup.zones);
}

function migrate9To10(battle) {
  battle.processedActionIds = array(battle.processedActionIds);
}

function migrate10To11(battle) {
  for (const unit of array(battle.ships)) {
    if (!unit || typeof unit !== "object") continue;
    unit.unitType ??= unit.creatureType || unit.vitality || unit.attacks ? "creature" : "ship";
  }
}

function migrate11To12(battle) {
  // События представления остаются совместимыми в корне боя и позднее
  // отделяются DocumentStateStore без изменения формата самого боя.
  for (const key of ["lastMovement", "lastAudioEvent", "lastCollision"]) {
    if (battle[key] === undefined) delete battle[key];
  }
}

function migrate12To13(battle) {
  battle.board = record(battle.board);
  battle.board.background = record(battle.board.background);
  battle.processedActionIds = array(battle.processedActionIds);
  battle.playerAssignments = record(battle.playerAssignments);
  battle.pendingOrders = record(battle.pendingOrders);
}

const BATTLE_MIGRATIONS = Object.freeze([
  { from: 0, to: 1, label: "legacy battle shell", up: migrate0To1 },
  { from: 1, to: 2, label: "revision and terrain revision", up: migrate1To2 },
  { from: 2, to: 3, label: "environment and setup", up: migrate2To3 },
  { from: 3, to: 4, label: "historical armament", up: migrate3To4 },
  { from: 4, to: 5, label: "airship state", up: migrate4To5 },
  { from: 5, to: 6, label: "phase and movement reservations", up: migrate5To6 },
  { from: 6, to: 7, label: "player orders", up: migrate6To7 },
  { from: 7, to: 8, label: "visibility contacts", up: migrate7To8 },
  { from: 8, to: 9, label: "battle modes and setup zones", up: migrate8To9 },
  { from: 9, to: 10, label: "socket replay protection", up: migrate9To10 },
  { from: 10, to: 11, label: "creature combatants", up: migrate10To11 },
  { from: 11, to: 12, label: "presentation events", up: migrate11To12 },
  { from: 12, to: 13, label: "current board and player state", up: migrate12To13 }
]);

export class UnsupportedSchemaVersionError extends Error {
  constructor(kind, version, supported = CURRENT_SCHEMA_VERSION) {
    super(`${kind}: schema v${version} is newer than supported v${supported}.`);
    this.name = "UnsupportedSchemaVersionError";
    this.kind = kind;
    this.version = version;
    this.supported = supported;
  }
}

export class SchemaMigrations {
  static getMigrationPlan(from = 0, to = CURRENT_SCHEMA_VERSION) {
    const start = schemaVersion(from);
    const end = schemaVersion(to);
    if (start > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError("Battle", start);
    if (end > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError("Target", end);
    if (end < start) return [];
    return BATTLE_MIGRATIONS.filter(step => step.from >= start && step.to <= end).map(step => ({
      from: step.from,
      to: step.to,
      label: step.label
    }));
  }

  static migrateBattle(battle, { log = false } = {}) {
    if (!battle || typeof battle !== "object" || Array.isArray(battle)) return battle;
    const from = schemaVersion(battle.schemaVersion);
    if (from > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError("Battle", from);

    const applied = [];
    let current = from;
    while (current < CURRENT_SCHEMA_VERSION) {
      const step = BATTLE_MIGRATIONS.find(candidate => candidate.from === current);
      if (!step) throw new Error(`Sailships Combat: missing migration from schema v${current}.`);
      step.up(battle);
      battle.schemaVersion = step.to;
      current = step.to;
      applied.push(`${step.from}->${step.to} ${step.label}`);
    }

    battle.ships = array(battle.ships);
    for (const unit of battle.ships) this.migrateCombatant(unit);
    battle.schemaVersion = CURRENT_SCHEMA_VERSION;

    if (log && applied.length) {
      console.info(`sailships-combat | Battle schema migrations: ${applied.join(", ")} (from ${from || "legacy"} to ${CURRENT_SCHEMA_VERSION}).`);
    }
    return battle;
  }

  static migrateCombatant(unit) {
    if (!unit || typeof unit !== "object" || Array.isArray(unit)) return unit;
    const from = schemaVersion(unit.schemaVersion);
    if (from > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError("Combatant", from);
    const type = String(unit.unitType ?? (unit.creatureType || unit.vitality || unit.attacks ? "creature" : "ship"));
    if (type === "creature") {
      unit.schemaVersion = CURRENT_SCHEMA_VERSION;
      unit.unitType = "creature";
      unit.flags = record(unit.flags);
      // Старые данные не различали сваливание и разрушение несущих органов.
      // Причину для падающего существа определит CreatureNormalizer по анатомии.
      if (!unit.flags.falling) unit.flags.fallReason = null;
      return unit;
    }
    return this.migrateShip(unit);
  }

  static migrateShip(ship) {
    if (!ship || typeof ship !== "object" || Array.isArray(ship)) return ship;
    const from = schemaVersion(ship.schemaVersion);
    if (from > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError("Ship", from);

    ship.unitType = "ship";
    const hadCrystal = ship.crystal && typeof ship.crystal === "object" && !Array.isArray(ship.crystal);
    ship.crystal = record(ship.crystal);
    ship.crystal.enabled ??= true;
    ship.crystal.heat ??= 0;
    ship.crystal.maxHeat ??= 10;
    ship.crystal.integrity ??= 16;
    ship.crystal.maxIntegrity ??= 16;
    ship.crystal.location ??= "stern";
    ship.crystal.honorProtected ??= true;
    ship.crystal.mode ??= "normal";
    ship.verticalVelocity ??= 0;

    if (!hadCrystal) {
      ship.crystal.armor ??= 9;
      ship.crystal.armorRevision = 2;
    } else if (Number(ship.crystal.armorRevision ?? 1) < 2) {
      ship.crystal.armor = Number(ship.crystal.armor ?? 6) + 3;
      ship.crystal.armorRevision = 2;
    } else {
      ship.crystal.armor ??= 9;
    }

    ship.flags = record(ship.flags);
    if (ship.flags.grappledWith == null && typeof ship.flags.grappled === "string") ship.flags.grappledWith = ship.flags.grappled;
    delete ship.flags.grappled;
    ship.flags.inIronsAttempts ??= 0;

    ship.sections = record(ship.sections);
    for (const section of Object.values(ship.sections)) {
      if (section && typeof section === "object" && !Array.isArray(section)) section.breaches ??= 0;
    }

    if (from < 4) this._migrateHistoricalArmament(ship);
    ship.schemaVersion = CURRENT_SCHEMA_VERSION;
    return ship;
  }

  static _migrateHistoricalArmament(ship) {
    if (!ship?.template || !Array.isArray(ship.weapons) || !ship.weapons.length) return;
    if (ship.weapons.some(weapon => weapon.armamentRevision || weapon.caliber || weapon.guns)) return;
    if (!ship.weapons.every(weapon => LEGACY_GENERATED_WEAPON_LABELS.has(String(weapon.label ?? "")))) return;

    const historical = createShip({
      id: ship.id,
      name: ship.name,
      side: ship.side,
      x: ship.x,
      y: ship.y,
      heading: ship.heading,
      template: ship.template
    });
    if (!historical?.weapons?.length) return;

    const legacyByArc = new Map(ship.weapons.map(weapon => [weapon.arc, weapon]));
    ship.weapons = historical.weapons.map(weapon => {
      const legacy = legacyByArc.get(weapon.arc) ?? {};
      return {
        ...weapon,
        reload: Math.min(Number(legacy.reload ?? 0), Number(weapon.reloadMax ?? 0)),
        ammo: legacy.ammo ?? weapon.ammo,
        fireMode: legacy.fireMode ?? weapon.fireMode,
        delayed: Boolean(legacy.delayed ?? weapon.delayed),
        rangingTargetId: legacy.rangingTargetId ?? weapon.rangingTargetId
      };
    });
  }

  static _migrateLegacyBattle(battle) {
    battle.setupConfirmed ??= (Number(battle.round ?? 1) > 1 || battle.phase !== "orders");
    battle.board = record(battle.board);
    battle.board.width ??= 24;
    battle.board.height ??= 16;
    battle.board.cellSize ??= 48;
    battle.board.terrain = this.normalizeLegacyTerrain(battle.board.terrain);
    battle.turn = record(battle.turn);
    battle.turn.activeShipId ??= null;
    ensurePhaseRecords(battle.turn);
    battle.playerAssignments = record(battle.playerAssignments);
    battle.pendingOrders = record(battle.pendingOrders);
  }

  static normalizeLegacyTerrain(terrain) {
    if (!terrain || typeof terrain !== "object" || Array.isArray(terrain)) return {};
    const clean = {};
    for (const [key, value] of Object.entries(terrain)) {
      const values = Array.isArray(value) ? value : [value];
      const layers = [...new Set(values.filter(Boolean).map(String))];
      if (layers.length) clean[key] = layers;
    }
    return clean;
  }
}
