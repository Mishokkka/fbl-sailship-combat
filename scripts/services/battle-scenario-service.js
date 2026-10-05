import { AIR_ONLY_TERRAIN_TYPES, BATTLE_MODE_LABELS, BATTLE_MODE_SEQUENCE, BATTLE_MODE_TOOLTIPS, SEA_ONLY_TERRAIN_TYPES, CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { BOARD_PRESETS, ENVIRONMENT_PRESETS, SCENARIO_PRESETS } from "../data/battle-setup-presets.js";
import { uid } from "../utils/random.js";
import { ShipNormalizer } from "../normalizers/ship-normalizer.js";
import { CreatureNormalizer } from "../normalizers/creature-normalizer.js";
import { TerrainGenerationService } from "./terrain-generation-service.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { normalizeHeading } from "../board/board-geometry.js";
import { SocketService } from "./socket-service.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "./document-state-store.js";
import { randomInt } from "../utils/random.js";
import { boundedString, finiteNumber, isPlainObject, jsonSize, uniqueBoundedStrings } from "../utils/schema.js";
import { repairUniqueIds } from "../utils/identity.js";
import { VictoryEngine } from "../engine/victory-engine.js";
import { CombatantRules } from "../rules/combatant-rules.js";

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return finiteNumber(value, { fallback: min, min, max });
}

function key(x, y) {
  return `${x},${y}`;
}

const DEFAULT_SIDE_IDS = ["blue", "red"];
const SIDE_COLOR_PALETTE = ["#5d91c7", "#c75d5d", "#79a86f", "#d1a648", "#9a76c8", "#57aaa7", "#c7835d", "#c06a9b"];
const SIDE_ZONE_SPECS = [
  { x1: 0.04, y1: 0.16, x2: 0.22, y2: 0.84, heading: 120 },
  { x1: 0.78, y1: 0.16, x2: 0.96, y2: 0.84, heading: 300 },
  { x1: 0.25, y1: 0.04, x2: 0.75, y2: 0.20, heading: 180 },
  { x1: 0.25, y1: 0.80, x2: 0.75, y2: 0.96, heading: 0 },
  { x1: 0.04, y1: 0.04, x2: 0.24, y2: 0.30, heading: 120 },
  { x1: 0.76, y1: 0.70, x2: 0.96, y2: 0.96, heading: 300 },
  { x1: 0.04, y1: 0.70, x2: 0.24, y2: 0.96, heading: 60 },
  { x1: 0.76, y1: 0.04, x2: 0.96, y2: 0.30, heading: 240 }
];

const SEA_ONLY_TERRAIN = new Set(SEA_ONLY_TERRAIN_TYPES);
const AIR_ONLY_TERRAIN = new Set(AIR_ONLY_TERRAIN_TYPES);
const SCENARIO_LIMIT = 40;
const SCENARIO_BYTE_BUDGET = 4_000_000;

function normalizeZone(zone, board) {
  const width = finiteNumber(board?.width, { fallback: 24, min: 1, max: 80, integer: true });
  const height = finiteNumber(board?.height, { fallback: 16, min: 1, max: 80, integer: true });
  const z = isPlainObject(zone) ? zone : {};
  const x1 = Math.floor(clamp(z.x1 ?? 0, 0, width - 1));
  const y1 = Math.floor(clamp(z.y1 ?? 0, 0, height - 1));
  const x2 = Math.floor(clamp(z.x2 ?? x1, 0, width - 1));
  const y2 = Math.floor(clamp(z.y2 ?? y1, 0, height - 1));
  return {
    x1: Math.min(x1, x2),
    y1: Math.min(y1, y2),
    x2: Math.max(x1, x2),
    y2: Math.max(y1, y2),
    heading: Number.isFinite(Number(z.heading)) ? normalizeHeading(z.heading) : 120
  };
}

function relativeZone(zoneSpec, board) {
  const width = finiteNumber(board?.width, { fallback: 24, min: 1, max: 80, integer: true });
  const height = finiteNumber(board?.height, { fallback: 16, min: 1, max: 80, integer: true });
  const spec = isPlainObject(zoneSpec) ? zoneSpec : {};
  return normalizeZone({
    x1: Math.floor(Number(spec.x1 ?? 0) * width),
    y1: Math.floor(Number(spec.y1 ?? 0) * height),
    x2: Math.ceil(Number(spec.x2 ?? spec.x1 ?? 0) * width) - 1,
    y2: Math.ceil(Number(spec.y2 ?? spec.y1 ?? 0) * height) - 1,
    heading: spec.heading ?? 120
  }, board);
}

function scaleZone(zone, fromBoard, toBoard) {
  const oldWidth = finiteNumber(fromBoard?.width ?? toBoard?.width, { fallback: 24, min: 1, max: 80, integer: true });
  const oldHeight = finiteNumber(fromBoard?.height ?? toBoard?.height, { fallback: 16, min: 1, max: 80, integer: true });
  const newWidth = finiteNumber(toBoard?.width, { fallback: oldWidth, min: 1, max: 80, integer: true });
  const newHeight = finiteNumber(toBoard?.height, { fallback: oldHeight, min: 1, max: 80, integer: true });
  const source = normalizeZone(zone, fromBoard);
  return normalizeZone({
    x1: Math.floor(source.x1 / oldWidth * newWidth),
    y1: Math.floor(source.y1 / oldHeight * newHeight),
    x2: Math.ceil((source.x2 + 1) / oldWidth * newWidth) - 1,
    y2: Math.ceil((source.y2 + 1) / oldHeight * newHeight) - 1,
    heading: source.heading
  }, toBoard);
}

function normalizeColor(value, fallback = "#ffffff") {
  const text = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function defaultSideForIndex(sideId, index, board) {
  const spec = SIDE_ZONE_SPECS[index % SIDE_ZONE_SPECS.length] ?? SIDE_ZONE_SPECS[0];
  return {
    id: sideId,
    name: sideId === "blue" ? "Синяя сторона" : sideId === "red" ? "Красная сторона" : `Команда ${index + 1}`,
    color: SIDE_COLOR_PALETTE[index % SIDE_COLOR_PALETTE.length] ?? "#ffffff",
    zone: relativeZone(spec, board)
  };
}

function uniqueSideIds(values) {
  return uniqueBoundedStrings(values, { maxItems: 16, maxLength: 64 });
}

function collectSideIds(battle, fallbackSetup) {
  const setup = battle?.setup ?? {};
  const fromOrder = Array.isArray(setup.sideOrder) ? setup.sideOrder : [];
  const fromSides = setup.sides && typeof setup.sides === "object" && !Array.isArray(setup.sides) ? Object.keys(setup.sides) : [];
  const fromShips = (battle?.ships ?? []).map(ship => ship?.side).filter(Boolean);
  let ids = uniqueSideIds([...fromOrder, ...fromSides, ...fromShips]);
  if (!ids.length) ids = DEFAULT_SIDE_IDS.slice();
  while (ids.length < 2) {
    const next = DEFAULT_SIDE_IDS.find(id => !ids.includes(id)) ?? `side${ids.length + 1}`;
    ids.push(next);
  }
  for (const id of DEFAULT_SIDE_IDS) {
    if (fallbackSetup?.sides?.[id] && !ids.includes(id) && ids.length < 2) ids.push(id);
  }
  return ids;
}

function materializeSides(presetSides, board) {
  const fallback = BattleScenarioService.defaultSetup({ width: board.width, height: board.height }).sides;
  const sides = {};
  const presetSideIds = Object.keys(presetSides ?? {}).filter(key => key !== "sideOrder");
  const sideIds = uniqueSideIds([...(Array.isArray(presetSides?.sideOrder) ? presetSides.sideOrder : []), ...presetSideIds, ...DEFAULT_SIDE_IDS]);
  for (const sideId of sideIds) {
    const fallbackSide = fallback[sideId] ?? defaultSideForIndex(sideId, sideIds.indexOf(sideId), board);
    const source = presetSides?.[sideId] ?? fallbackSide;
    sides[sideId] = {
      id: sideId,
      name: String(source.name ?? fallbackSide.name),
      color: normalizeColor(source.color, fallbackSide.color),
      zone: source.zoneSpec ? relativeZone(source.zoneSpec, board) : normalizeZone(source.zone ?? fallbackSide.zone, board)
    };
  }
  return sides;
}

export class BattleScenarioService {
  static boardPresets() {
    return Object.values(BOARD_PRESETS).map(clone);
  }

  static environmentPresets() {
    return Object.values(ENVIRONMENT_PRESETS).map(clone);
  }

  static scenarioPresets() {
    return Object.values(SCENARIO_PRESETS).map(clone);
  }

  static getBoardPreset(id = "skirmish") {
    return clone(BOARD_PRESETS[id] ?? BOARD_PRESETS.skirmish);
  }

  static getEnvironmentPreset(id = "clearSea") {
    return clone(ENVIRONMENT_PRESETS[id] ?? ENVIRONMENT_PRESETS.clearSea);
  }

  static getScenarioPreset(id = "openDuel") {
    return clone(SCENARIO_PRESETS[id] ?? SCENARIO_PRESETS.openDuel);
  }

  static normalizeMode(mode = "mixed") {
    const value = String(mode ?? "").trim();
    return BATTLE_MODE_SEQUENCE.includes(value) ? value : "mixed";
  }

  static getModeFlags(battleOrMode = "mixed") {
    const mode = this.normalizeMode(typeof battleOrMode === "string" ? battleOrMode : battleOrMode?.setup?.mode);
    return {
      mode,
      label: BATTLE_MODE_LABELS[mode] ?? mode,
      title: BATTLE_MODE_TOOLTIPS[mode] ?? "",
      usesAltitude: mode !== "sea",
      usesCrystal: mode !== "sea",
      usesWater: mode !== "air",
      seaOnly: mode === "sea",
      airOnly: mode === "air",
      mixed: mode === "mixed"
    };
  }

  static touchTerrain(battle) {
    battle.board ??= {};
    const current = Math.max(0, Number(battle.board.terrainRevision ?? 0));
    battle.board.terrainRevision = current + 1;
    return battle.board.terrainRevision;
  }

  static normalizeTerrainForMode(terrain, mode = "mixed") {
    const flags = this.getModeFlags(mode);
    const values = Array.isArray(terrain) ? terrain : [terrain].filter(Boolean);
    const clean = [...new Set(values.map(String).filter(type => !(flags.airOnly && SEA_ONLY_TERRAIN.has(type)) && !(flags.seaOnly && AIR_ONLY_TERRAIN.has(type))))];
    if (clean.includes("rockHigh")) return ["rockHigh"];
    return clean;
  }

  static applyModeToTerrain(battle) {
    battle.board ??= {};
    battle.board.terrain ??= {};
    const mode = this.normalizeMode(battle.setup?.mode);
    let changed = false;
    for (const [terrainKey, terrain] of Object.entries(battle.board.terrain)) {
      const previous = Array.isArray(terrain) ? terrain.map(String) : [String(terrain)];
      const clean = this.normalizeTerrainForMode(terrain, mode);
      if (!clean.length) {
        delete battle.board.terrain[terrainKey];
        changed = true;
      } else {
        if (clean.length !== previous.length || clean.some((value, index) => value !== previous[index])) changed = true;
        battle.board.terrain[terrainKey] = clean;
      }
    }
    if (changed) this.touchTerrain(battle);
    return changed;
  }

  static applyModeToShip(battle, ship) {
    if (!ship) return;
    const flags = this.getModeFlags(battle);
    ship.flags ??= {};
    if (flags.seaOnly) {
      ship.altitude = 0;
      ship.verticalVelocity = 0;
      delete ship.flags.falling;
      delete ship.flags.emergencyDescent;
      delete ship.flags.coreExploded;
      delete ship.flags.dishonorableCoreTargeted;
      delete ship.flags.dishonorableCoreShooter;
      return;
    }
    if (flags.airOnly && !battle.setupConfirmed && Number(ship.altitude ?? 0) <= 0) ship.altitude = 3;
  }

  static applyModeToBattle(battle) {
    this.normalizeSetupZones(battle);
    battle.setup.mode = this.normalizeMode(battle.setup.mode);
    this.applyModeToTerrain(battle);
    if (battle.setup.mode === "sea") delete battle.dishonorableCoreShots;
    for (const ship of battle.ships ?? []) {
      if (CombatantRules.typeOf(ship) === "ship") this.applyModeToShip(battle, ship);
    }
    return this.getModeFlags(battle);
  }

  static createBlankBattle({ name = "Новый бой", boardPreset = "skirmish", environmentPreset = "clearSea" } = {}) {
    const board = this.getBoardPreset(boardPreset);
    const environment = this.getEnvironmentPreset(environmentPreset);
    const now = nowIso();
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: uid("battle"),
      name: String(name || "Новый бой"),
      created: now,
      updated: now,
      round: 1,
      phase: "orders",
      setupConfirmed: false,
      board: {
        width: board.width,
        height: board.height,
        cellSize: board.cellSize,
        terrainRevision: 1,
        terrain: {}
      },
      wind: clone(environment.wind),
      sea: clone(environment.sea),
      setup: this.defaultSetup({ width: board.width, height: board.height, scenarioName: name }),
      turn: {
        activeShipId: null,
        actions: {},
        phaseOrder: { orders: [] },
        initiative: { orders: {} },
        completed: { orders: [], movement: [], gunnery: [], damage: [], crew: [], end: [] }
      },
      playerAssignments: {},
      pendingOrders: {},
      playerVisibility: { contacts: {}, observations: {} },
      ships: [],
      log: [{ id: uid("log"), round: 1, phase: "orders", text: "Создан новый пустой бой. Добавьте корабли через Верфь или библиотеку.", ts: now }]
    };
  }

  static defaultSetup({ width = 24, height = 16, scenarioName = "Сценарий" } = {}) {
    const board = { width, height };
    const leftZone = relativeZone({ x1: 0.04, y1: 0.16, x2: 0.22, y2: 0.84, heading: 120 }, board);
    const rightZone = relativeZone({ x1: 0.78, y1: 0.16, x2: 0.96, y2: 0.84, heading: 300 }, board);
    return {
      scenarioName,
      mode: "mixed",
      terrainGenerator: "openDuel",
      terrainSeed: null,
      sideOrder: DEFAULT_SIDE_IDS.slice(),
      coreTargeting: { blue: true, red: true },
      heatedShot: { blue: false, red: false },
      victory: VictoryEngine.defaultConfig(DEFAULT_SIDE_IDS),
      sides: {
        blue: { id: "blue", name: "Синяя сторона", color: "#5d91c7", zone: leftZone },
        red: { id: "red", name: "Красная сторона", color: "#c75d5d", zone: rightZone }
      }
    };
  }

  static clampUnitsToBoard(battle) {
    for (const unit of battle.ships ?? []) {
      unit.x = Math.max(0, Math.min(battle.board.width - 1, Number(unit.x) || 0));
      unit.y = Math.max(0, Math.min(battle.board.height - 1, Number(unit.y) || 0));
    }
  }

  static applyBoardPreset(battle, presetId) {
    const preset = this.getBoardPreset(presetId);
    const oldBoard = clone(battle.board ?? { width: preset.width, height: preset.height });
    const oldSides = clone(battle.setup?.sides ?? null);
    battle.board ??= {};
    battle.board.width = preset.width;
    battle.board.height = preset.height;
    battle.board.cellSize = preset.cellSize;
    this.clampUnitsToBoard(battle);
    battle.board.terrain ??= {};
    this.touchTerrain(battle);
    battle.setup ??= this.defaultSetup({ width: preset.width, height: preset.height, scenarioName: battle.name });
    battle.setup.sides ??= this.defaultSetup({ width: preset.width, height: preset.height, scenarioName: battle.name }).sides;
    if (oldSides) {
      for (const sideId of Object.keys(oldSides)) {
        const oldSide = oldSides[sideId];
        const current = battle.setup.sides[sideId];
        if (!oldSide?.zone || !current) continue;
        current.zone = scaleZone(oldSide.zone, oldBoard, battle.board);
      }
    }
    this.normalizeSetupZones(battle);
    return preset;
  }


  static resizeBoard(battle, { width, height, cellSize } = {}) {
    const oldBoard = clone(battle.board ?? {});
    const oldSides = clone(battle.setup?.sides ?? {});
    battle.board ??= {};
    battle.board.width = Math.max(8, Math.min(80, Math.round(Number(width ?? oldBoard.width ?? 24))));
    battle.board.height = Math.max(8, Math.min(80, Math.round(Number(height ?? oldBoard.height ?? 16))));
    battle.board.cellSize = Math.max(28, Math.min(96, Math.round(Number(cellSize ?? oldBoard.cellSize ?? 48))));
    battle.board.terrain ??= {};
    this.touchTerrain(battle);
    for (const sideId of Object.keys(oldSides)) {
      const current = battle.setup?.sides?.[sideId];
      if (current?.zone) current.zone = scaleZone(oldSides[sideId].zone, oldBoard, battle.board);
    }
    this.clampUnitsToBoard(battle);
    this.normalizeSetupZones(battle);
    return battle.board;
  }

  static applyEnvironmentPreset(battle, presetId) {
    const preset = this.getEnvironmentPreset(presetId);
    battle.wind = clone(preset.wind);
    battle.sea = clone(preset.sea);
    return preset;
  }

  static applyScenarioPreset(battle, presetId) {
    const preset = this.getScenarioPreset(presetId);
    const board = this.getBoardPreset(preset.boardPreset);
    const environment = this.getEnvironmentPreset(preset.environmentPreset);
    const setupSides = materializeSides(preset.sides, board);
    const generated = TerrainGenerationService.generate({ board, scenarioId: preset.terrainGenerator ?? preset.id, mode: this.normalizeMode(preset.mode), sides: setupSides });
    battle.name = battle.name || preset.label;
    battle.setupConfirmed = false;
    battle.round = 1;
    battle.phase = "orders";
    battle.board = { width: board.width, height: board.height, cellSize: board.cellSize, terrainRevision: 1, terrain: generated.terrain };
    this.clampUnitsToBoard(battle);
    battle.wind = clone(environment.wind);
    battle.sea = clone(environment.sea);
    battle.setup = {
      scenarioName: preset.label,
      mode: this.normalizeMode(preset.mode),
      terrainGenerator: preset.terrainGenerator ?? preset.id,
      terrainSeed: generated.seed,
      victory: VictoryEngine.normalizeConfig(preset.victory, Object.keys(setupSides)),
      sideOrder: Object.keys(setupSides),
      sides: setupSides
    };
    delete battle.outcome;
    this.applyModeToBattle(battle);
    return preset;
  }

  static generateScenarioTerrain(battle, presetId = "openDuel") {
    const preset = this.getScenarioPreset(presetId);
    this.normalizeSetupZones(battle);
    const generatorId = preset.terrainGenerator ?? battle.setup?.terrainGenerator ?? preset.id;
    const generated = TerrainGenerationService.generate({
      board: battle.board,
      scenarioId: generatorId,
      mode: this.normalizeMode(battle.setup?.mode ?? preset.mode),
      sides: battle.setup?.sides ?? null
    });
    battle.board ??= {};
    battle.board.terrain = generated.terrain;
    this.touchTerrain(battle);
    battle.setup ??= this.defaultSetup({ width: battle.board.width, height: battle.board.height, scenarioName: battle.name });
    battle.setup.terrainGenerator = generatorId;
    battle.setup.terrainSeed = generated.seed;
    this.applyModeToTerrain(battle);
    return generated;
  }

  static normalizeSetupZones(battle) {
    const board = battle.board ?? { width: 24, height: 16 };
    if (!isPlainObject(battle.setup)) battle.setup = this.defaultSetup({ width: board.width, height: board.height, scenarioName: battle.name });
    if (!battle.setup.sides || Array.isArray(battle.setup.sides) || typeof battle.setup.sides !== "object") battle.setup.sides = {};
    if (!battle.setup.coreTargeting || Array.isArray(battle.setup.coreTargeting) || typeof battle.setup.coreTargeting !== "object") {
      battle.setup.coreTargeting = {};
    }
    if (!battle.setup.heatedShot || Array.isArray(battle.setup.heatedShot) || typeof battle.setup.heatedShot !== "object") {
      battle.setup.heatedShot = {};
    }
    const fallbackSetup = this.defaultSetup({ width: board.width, height: board.height, scenarioName: battle.name });
    const sideIds = collectSideIds(battle, fallbackSetup);
    battle.setup.victory = VictoryEngine.normalizeConfig(battle.setup.victory, sideIds);
    const normalizedSides = {};
    for (const [index, sideId] of sideIds.entries()) {
      const fallback = fallbackSetup.sides[sideId] ?? defaultSideForIndex(sideId, index, board);
      const side = battle.setup.sides[sideId] ?? fallback;
      normalizedSides[sideId] = {
        id: sideId,
        name: boundedString(side.name, { fallback: fallback.name, maxLength: 128 }) || fallback.name,
        color: normalizeColor(side.color, fallback.color),
        zone: normalizeZone(side.zone ?? fallback.zone, board)
      };
      battle.setup.coreTargeting[sideId] = battle.setup.coreTargeting[sideId] !== false;
      battle.setup.heatedShot[sideId] = battle.setup.heatedShot[sideId] === true;
    }
    battle.setup.sides = normalizedSides;
    battle.setup.sideOrder = sideIds;
    for (const sideId of Object.keys(battle.setup.coreTargeting)) {
      if (!battle.setup.sides[sideId]) delete battle.setup.coreTargeting[sideId];
    }
    for (const sideId of Object.keys(battle.setup.heatedShot)) {
      if (!battle.setup.sides[sideId]) delete battle.setup.heatedShot[sideId];
    }
  }

  static updateSideFromForm(battle, sideId, formData = {}) {
    this.normalizeSetupZones(battle);
    const side = battle.setup.sides[sideId];
    if (!side) return null;
    side.name = String(formData[`${sideId}.name`] ?? side.name ?? sideId).trim() || side.name || sideId;
    side.color = normalizeColor(formData[`${sideId}.color`] ?? side.color, side.color ?? "#ffffff");
    side.zone = normalizeZone({
      x1: formData[`${sideId}.x1`] ?? side.zone.x1,
      y1: formData[`${sideId}.y1`] ?? side.zone.y1,
      x2: formData[`${sideId}.x2`] ?? side.zone.x2,
      y2: formData[`${sideId}.y2`] ?? side.zone.y2,
      heading: formData[`${sideId}.heading`] ?? side.zone.heading
    }, battle.board);
    battle.setup.coreTargeting ??= {};
    battle.setup.coreTargeting[sideId] = formData[`${sideId}.coreTargeting`] !== false;
    battle.setup.heatedShot ??= {};
    battle.setup.heatedShot[sideId] = formData[`${sideId}.heatedShot`] === true;
    return side;
  }

  static getSideIds(battle) {
    this.normalizeSetupZones(battle);
    return battle.setup.sideOrder.slice();
  }

  static getSides(battle) {
    this.normalizeSetupZones(battle);
    return battle.setup.sideOrder.map(sideId => battle.setup.sides[sideId]).filter(Boolean);
  }

  static getSideColor(battle, sideId) {
    this.normalizeSetupZones(battle);
    return battle.setup.sides?.[sideId]?.color ?? "#777777";
  }

  static getSideName(battle, sideId) {
    this.normalizeSetupZones(battle);
    return battle.setup.sides?.[sideId]?.name ?? sideId ?? "";
  }

  static getNextSideId(battle) {
    this.normalizeSetupZones(battle);
    for (let index = 3; index < 100; index++) {
      const id = `side${index}`;
      if (!battle.setup.sides[id]) return id;
    }
    return `side${Date.now()}`;
  }

  static addSide(battle) {
    this.normalizeSetupZones(battle);
    const id = this.getNextSideId(battle);
    const side = defaultSideForIndex(id, battle.setup.sideOrder.length, battle.board ?? { width: 24, height: 16 });
    battle.setup.sides[id] = side;
    battle.setup.sideOrder.push(id);
    battle.setup.coreTargeting ??= {};
    battle.setup.coreTargeting[id] = true;
    battle.setup.heatedShot ??= {};
    battle.setup.heatedShot[id] = false;
    return side;
  }

  static removeSide(battle, sideId) {
    this.normalizeSetupZones(battle);
    if (!battle.setup.sides[sideId] || battle.setup.sideOrder.length <= 2) return false;
    if ((battle.ships ?? []).some(unit => unit.side === sideId)) return false;
    delete battle.setup.sides[sideId];
    delete battle.setup.coreTargeting?.[sideId];
    delete battle.setup.heatedShot?.[sideId];
    battle.setup.sideOrder = battle.setup.sideOrder.filter(id => id !== sideId);
    return true;
  }

  static cycleShipSide(battle, ship) {
    if (!ship) return null;
    const sideIds = this.getSideIds(battle);
    const current = sideIds.indexOf(ship.side);
    ship.side = sideIds[(current + 1 + sideIds.length) % sideIds.length] ?? sideIds[0] ?? ship.side;
    return battle.setup.sides[ship.side] ?? null;
  }

  static getSideSpawnPoint(battle, sideId, offset = 0) {
    this.normalizeSetupZones(battle);
    const sideIds = battle.setup.sideOrder ?? [];
    const side = battle.setup.sides?.[sideId] ?? battle.setup.sides?.[sideIds[0]];
    const zone = side?.zone ?? { x1: 0, y1: 0, x2: 0, y2: 0, heading: 120 };
    const width = Math.max(1, Number(zone.x2 ?? zone.x1 ?? 0) - Number(zone.x1 ?? 0) + 1);
    const height = Math.max(1, Number(zone.y2 ?? zone.y1 ?? 0) - Number(zone.y1 ?? 0) + 1);
    const index = Math.max(0, Number(offset ?? 0));
    return {
      x: Math.min(Number(zone.x2 ?? zone.x1 ?? 0), Number(zone.x1 ?? 0) + (index % width)),
      y: Math.min(Number(zone.y2 ?? zone.y1 ?? 0), Number(zone.y1 ?? 0) + (Math.floor(index / width) % height)),
      heading: zone.heading ?? 120
    };
  }

  static deploymentAltitudeForBattle(battle, ship) {
    const mode = this.normalizeMode(battle.setup?.mode);
    if (mode === "sea") return 0;
    if (mode === "air") return Math.max(3, Number(ship?.altitude ?? 3));
    return Number(ship?.altitude ?? 0);
  }

  static cellsInZone(zone) {
    const cells = [];
    for (let y = zone.y1; y <= zone.y2; y++) {
      for (let x = zone.x1; x <= zone.x2; x++) cells.push({ x, y });
    }
    return cells;
  }

  static legalDeploymentCells(battle, sideId, ship, occupied = new Set()) {
    this.normalizeSetupZones(battle);
    const side = battle.setup.sides[sideId];
    if (!side) return [];
    const altitude = this.deploymentAltitudeForBattle(battle, ship);
    return this.cellsInZone(side.zone).filter(cell => {
      if (occupied.has(key(cell.x, cell.y))) return false;
      const terrain = battle.board?.terrain?.[key(cell.x, cell.y)] ?? null;
      return !MovementEngine.isBlockingTerrain(terrain, altitude);
    });
  }

  static shuffleCells(cells) {
    const next = cells.slice();
    for (let i = next.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }

  static deploySide(battle, sideId, { random = false } = {}) {
    this.normalizeSetupZones(battle);
    const side = battle.setup.sides[sideId];
    if (!side) return [];
    const ships = (battle.ships ?? []).filter(ship => ship.side === sideId && !ship.flags?.struck && !ship.flags?.withdrawn);
    const occupied = new Set((battle.ships ?? []).filter(ship => ship.side !== sideId).map(ship => key(ship.x, ship.y)));
    const placed = [];
    for (const ship of ships) {
      const altitude = this.deploymentAltitudeForBattle(battle, ship);
      const legalCells = this.legalDeploymentCells(battle, sideId, { ...ship, altitude }, occupied);
      const orderedCells = random ? this.shuffleCells(legalCells) : legalCells;
      const cell = orderedCells[0];
      if (!cell) continue;
      ship.x = cell.x;
      ship.y = cell.y;
      ship.heading = side.zone.heading;
      ship.altitude = altitude;
      occupied.add(key(cell.x, cell.y));
      placed.push(ship);
    }
    return placed;
  }

  static cleanScenarioFromBattle(battle, name = null) {
    const copy = clone(battle);
    copy.setupConfirmed = false;
    copy.round = 1;
    copy.phase = "orders";
    copy.turn = { activeShipId: null, actions: {}, phaseOrder: {}, initiative: {}, completed: { orders: [], movement: [], gunnery: [], damage: [], crew: [], end: [] } };
    copy.playerAssignments = {};
    copy.pendingOrders = {};
    copy.playerVisibility = { contacts: {}, observations: {} };
    delete copy.dishonorableCoreShots;
    delete copy.lastMovement;
    delete copy.lastAudioEvent;
    delete copy.outcome;
    if (copy.setup?.victory) {
      copy.setup.victory.initialStrength = {};
      copy.setup.victory.initialShipCount = {};
    }
    copy.log = [];
    copy.ships = (copy.ships ?? []).map(unit => {
      const clean = unit?.unitType === "creature"
        ? CreatureNormalizer.cleanForLibrary(unit)
        : ShipNormalizer.cleanForLibrary(unit);
      clean.x = unit.x;
      clean.y = unit.y;
      clean.heading = unit.heading;
      clean.side = unit.side;
      clean.altitude = unit.altitude;
      if (clean.unitType === "creature") clean.turn.round = 1;
      return clean;
    });
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: uid("scenario"),
      name: String(name || copy.setup?.scenarioName || copy.name || "Сценарий боя"),
      saved: nowIso(),
      scenario: copy
    };
  }

  static getSavedScenarios() {
    if (!game.user?.isGM) return [];
    const saved = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.SCENARIOS, { schemaVersion: 0, scenarios: [] });
    const scenarios = Array.isArray(saved.scenarios) ? saved.scenarios.map(clone) : [];
    repairUniqueIds(scenarios, { prefix: "scenario", maxLength: 128 });
    return scenarios;
  }

  static fitSavedScenariosToBudget(scenarios) {
    const clean = scenarios.slice(-SCENARIO_LIMIT);
    while (clean.length > 1 && jsonSize({ scenarios: clean }) > SCENARIO_BYTE_BUDGET) clean.shift();
    if (jsonSize({ scenarios: clean }) > SCENARIO_BYTE_BUDGET) {
      throw new Error(`Библиотека сценариев превышает лимит ${Math.round(SCENARIO_BYTE_BUDGET / 1_000_000)} МБ.`);
    }
    return clean;
  }

  static async saveSavedScenarios(scenarios) {
    const clean = (Array.isArray(scenarios) ? scenarios.map(clone) : []);
    repairUniqueIds(clean, { prefix: "scenario", maxLength: 128 });
    if (!SocketService.canCurrentUserWrite({ label: "Сценарии боя" })) return this.getSavedScenarios();
    const fitted = this.fitSavedScenariosToBudget(clean);
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.SCENARIOS, { schemaVersion: CURRENT_SCHEMA_VERSION, scenarios: fitted });
    SocketService.broadcastUpdate("scenarios");
    return fitted;
  }

  static async saveScenario(name, battle) {
    const scenarios = this.getSavedScenarios();
    const entry = this.cleanScenarioFromBattle(battle, name);
    scenarios.push(entry);
    await this.saveSavedScenarios(scenarios);
    return entry;
  }

  static async deleteScenario(id) {
    const scenarios = this.getSavedScenarios();
    const index = scenarios.findIndex(entry => entry.id === id);
    if (index < 0) return null;
    const [removed] = scenarios.splice(index, 1);
    await this.saveSavedScenarios(scenarios);
    return removed;
  }

  static scenarioToBattle(entryOrScenario) {
    const source = entryOrScenario?.scenario ?? entryOrScenario;
    const battle = clone(source);
    battle.id = uid("battle");
    battle.created = nowIso();
    battle.updated = battle.created;
    battle.setupConfirmed = false;
    battle.round = 1;
    battle.phase = "orders";
    delete battle.outcome;
    if (battle.setup?.victory) {
      battle.setup.victory.initialStrength = {};
      battle.setup.victory.initialShipCount = {};
    }
    battle.log = [{ id: uid("log"), round: 1, phase: "orders", text: `Сценарий загружен: ${entryOrScenario?.name ?? battle.name ?? "без названия"}.`, ts: battle.created }];
    return battle;
  }
}
