import { AIR_ONLY_TERRAIN_TYPES, SEA_ONLY_TERRAIN_TYPES, TERRAIN_LABELS } from "../utils/constants.js";

function hashSeed(seed = "") {
  let h = 2166136261;
  for (let i = 0; i < String(seed).length; i++) {
    h ^= String(seed).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function key(x, y) {
  return `${x},${y}`;
}

function inZone(x, y, zone) {
  if (!zone) return false;
  return x >= zone.x1 && x <= zone.x2 && y >= zone.y1 && y <= zone.y2;
}

function zoneBuffer(zone, board, buffer = 1) {
  if (!zone) return null;
  return {
    x1: Math.max(0, Number(zone.x1 ?? 0) - buffer),
    y1: Math.max(0, Number(zone.y1 ?? 0) - buffer),
    x2: Math.min(Number(board.width ?? 1) - 1, Number(zone.x2 ?? 0) + buffer),
    y2: Math.min(Number(board.height ?? 1) - 1, Number(zone.y2 ?? 0) + buffer)
  };
}

function zoneCenter(zone) {
  if (!zone) return null;
  return { x: (Number(zone.x1 ?? 0) + Number(zone.x2 ?? 0)) / 2, y: (Number(zone.y1 ?? 0) + Number(zone.y2 ?? 0)) / 2 };
}

function terrainList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return [String(value)].filter(Boolean);
}

function normalizeTerrainStack(value) {
  const list = [...new Set(terrainList(value))];
  if (list.includes("rockHigh")) return ["rockHigh"];
  return list;
}

function mergeTerrainStack(current, type) {
  const next = String(type ?? "");
  if (!next) return normalizeTerrainStack(current);
  if (next === "rockHigh") return ["rockHigh"];
  const list = normalizeTerrainStack(current);
  if (list.includes("rockHigh")) return list;
  if (!list.includes(next)) list.push(next);
  return normalizeTerrainStack(list);
}

const SEA_ONLY_TERRAIN = new Set(SEA_ONLY_TERRAIN_TYPES);
const AIR_ONLY_TERRAIN = new Set(AIR_ONLY_TERRAIN_TYPES);

function filterTerrainForMode(canvas, mode = "mixed") {
  const battleMode = ["sea", "air", "mixed"].includes(mode) ? mode : "mixed";
  for (const [cell, raw] of Object.entries(canvas.terrain)) {
    const clean = terrainList(raw).filter(type => !(battleMode === "air" && SEA_ONLY_TERRAIN.has(type)) && !(battleMode === "sea" && AIR_ONLY_TERRAIN.has(type)));
    if (!clean.length) delete canvas.terrain[cell];
    else canvas.terrain[cell] = normalizeTerrainStack(clean);
  }
}

function terrainSummary(terrain) {
  const counts = {};
  for (const raw of Object.values(terrain ?? {})) {
    for (const type of terrainList(raw)) counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.entries(counts).map(([type, count]) => ({ type, label: TERRAIN_LABELS[type] ?? type, count }));
}

class TerrainCanvas {
  constructor(board, avoidZones = [], { avoidPlacement = false } = {}) {
    this.board = {
      width: Math.max(8, Number(board?.width ?? 24)),
      height: Math.max(8, Number(board?.height ?? 16))
    };
    this.avoidZones = avoidPlacement ? avoidZones.map(zone => zoneBuffer(zone, this.board, 1)).filter(Boolean) : [];
    this.terrain = {};
  }

  within(x, y) {
    return x >= 0 && y >= 0 && x < this.board.width && y < this.board.height;
  }

  avoid(x, y) {
    return this.avoidZones.some(zone => inZone(x, y, zone));
  }

  add(x, y, type, { allowZone = false } = {}) {
    const cx = Math.round(x);
    const cy = Math.round(y);
    if (!this.within(cx, cy)) return false;
    if (!allowZone && this.avoid(cx, cy)) return false;
    const cell = key(cx, cy);
    const previous = normalizeTerrainStack(this.terrain[cell]);
    const next = mergeTerrainStack(previous, type);
    if (next.length === previous.length && next.every((entry, index) => entry === previous[index])) return false;
    this.terrain[cell] = next;
    return true;
  }

  remove(x, y, type = null) {
    const cell = key(Math.round(x), Math.round(y));
    if (!this.terrain[cell]) return;
    if (!type) {
      delete this.terrain[cell];
      return;
    }
    const next = terrainList(this.terrain[cell]).filter(t => t !== type);
    if (next.length) this.terrain[cell] = next;
    else delete this.terrain[cell];
  }

  addBlob(cx, cy, radiusX, radiusY, type, rng, irregularity = 0.35) {
    const rx = Math.max(1, Math.round(radiusX));
    const ry = Math.max(1, Math.round(radiusY));
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const dist = dx * dx + dy * dy;
        const edgeNoise = 1 + (rng() - 0.5) * irregularity;
        if (dist <= edgeNoise) this.add(x, y, type);
      }
    }
  }

  clearBlob(cx, cy, radiusX, radiusY) {
    const rx = Math.max(1, Math.round(radiusX));
    const ry = Math.max(1, Math.round(radiusY));
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (!this.within(x, y)) continue;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.remove(x, y);
      }
    }
  }

  clearZone(zone, buffer = 0) {
    const z = zoneBuffer(zone, this.board, buffer);
    if (!z) return;
    for (let y = z.y1; y <= z.y2; y++) {
      for (let x = z.x1; x <= z.x2; x++) this.remove(x, y);
    }
  }

  addChain(points, type, rng, radius = 1) {
    for (const point of points) {
      const jitterX = point.x + (rng() - 0.5) * 1.2;
      const jitterY = point.y + (rng() - 0.5) * 1.2;
      this.addBlob(jitterX, jitterY, radius + rng() * 1.5, Math.max(1, radius * 0.65 + rng()), type, rng, 0.6);
    }
  }

  addMeander({ startX, startY, endX, endY, steps, type, rng, radius = 1, drift = 3 }) {
    const phase = rng() * Math.PI * 2;
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / Math.max(1, steps);
      const wave = Math.sin(t * Math.PI * 2 + phase) * drift;
      points.push({
        x: startX + (endX - startX) * t + (rng() - 0.5) * drift,
        y: startY + (endY - startY) * t + wave + (rng() - 0.5) * drift
      });
    }
    this.addChain(points, type, rng, radius);
  }

  clearLine(from, to, rng, radius = 1) {
    const steps = Math.max(4, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
    const bend = (rng() - 0.5) * Math.min(this.board.width, this.board.height) * 0.12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * bend;
      this.clearBlob(x, y, radius, radius);
    }
  }

  scatter(count, type, rng, radiusMin = 1, radiusMax = 2, options = {}) {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rng() * this.board.width);
      const y = Math.floor(rng() * this.board.height);
      const r = radiusMin + rng() * (radiusMax - radiusMin);
      this.addBlob(x, y, r, Math.max(1, r * (0.55 + rng() * 0.6)), type, rng, options.irregularity ?? 0.8);
    }
  }

  addFloatingRockIsland(cx, cy, size, rng, { highChance = 0.55, skyChance = 0, forceSkyIsland = false } = {}) {
    const rx = Math.max(1.4, size * (0.8 + rng() * 0.8));
    const ry = Math.max(1.2, size * (0.55 + rng() * 0.6));
    const highType = forceSkyIsland || rng() < skyChance ? "skyIsland" : "rockHigh";
    this.addBlob(cx, cy, rx + 1.2, ry + 1, "rockLow", rng, 0.85);
    if (rng() < highChance) this.addBlob(cx + (rng() - 0.5) * rx * 0.7, cy + (rng() - 0.5) * ry * 0.7, Math.max(1, rx * 0.45), Math.max(1, ry * 0.45), highType, rng, 0.65);
    if (size > 2.1 && rng() > 0.45) this.addBlob(cx + (rng() - 0.5) * rx, cy + (rng() - 0.5) * ry, Math.max(1, rx * 0.35), Math.max(1, ry * 0.35), highType, rng, 0.75);
  }

  count(types = null) {
    const wanted = types ? new Set(Array.isArray(types) ? types : [types]) : null;
    let total = 0;
    for (const raw of Object.values(this.terrain)) {
      const list = terrainList(raw);
      total += wanted ? list.filter(t => wanted.has(t)).length : list.length;
    }
    return total;
  }

  cap(types, max, rng) {
    const wanted = new Set(Array.isArray(types) ? types : [types]);
    const cells = Object.keys(this.terrain).filter(cell => terrainList(this.terrain[cell]).some(type => wanted.has(type)));
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (let i = max; i < cells.length; i++) {
      for (const type of wanted) this.remove(...cells[i].split(",").map(Number), type);
    }
  }
}

function clearDeploymentAndLane(canvas, rng) {
  for (const zone of canvas.avoidZones) canvas.clearZone(zone, 0);
  if (canvas.avoidZones.length < 2) return;
  const a = zoneCenter(canvas.avoidZones[0]);
  const b = zoneCenter(canvas.avoidZones[1]);
  if (!a || !b) return;
  const radius = Math.max(1, Math.round(Math.min(canvas.board.width, canvas.board.height) / 18));
  canvas.clearLine(a, b, rng, radius);
}

function addFloatingRockField(canvas, rng, { density = 1, large = false, skyChance = 0 } = {}) {
  const area = canvas.board.width * canvas.board.height;
  const islands = Math.max(1, Math.round(area / (large ? 230 : 360) * density));
  for (let i = 0; i < islands; i++) {
    const flankBias = rng();
    const x = flankBias < 0.35
      ? canvas.board.width * (0.2 + rng() * 0.18)
      : flankBias > 0.65
        ? canvas.board.width * (0.62 + rng() * 0.18)
        : canvas.board.width * (0.25 + rng() * 0.5);
    const y = canvas.board.height * (0.12 + rng() * 0.76);
    const size = large ? 2 + rng() * 2.8 : 1.2 + rng() * 2.1;
    canvas.addFloatingRockIsland(x, y, size, rng, { highChance: large ? 0.7 : 0.45, skyChance, forceSkyIsland: large && i === 0 });
  }
}

function addBalancedClouds(canvas, rng, { density = 1, bands = false, type = "smoke", stormChance = 0 } = {}) {
  const area = canvas.board.width * canvas.board.height;
  const count = Math.max(1, Math.round(area / (bands ? 280 : 440) * density));
  for (let i = 0; i < count; i++) {
    const cloudType = stormChance > 0 && rng() < stormChance ? "stormCloud" : type;
    if (bands) {
      const startX = rng() * canvas.board.width;
      const startY = rng() * canvas.board.height;
      canvas.addMeander({
        startX,
        startY,
        endX: startX + canvas.board.width * (0.08 + rng() * 0.22),
        endY: startY + (rng() - 0.5) * canvas.board.height * 0.25,
        steps: 4 + Math.floor(rng() * 6),
        type: cloudType,
        rng,
        radius: 1 + rng() * 1.4,
        drift: 2 + rng() * 3
      });
    } else {
      canvas.scatter(1, cloudType, rng, 1.1, 2.4);
    }
  }
}

function addAirCurrents(canvas, rng, { density = 1 } = {}) {
  const area = canvas.board.width * canvas.board.height;
  const count = Math.max(1, Math.round(area / 520 * density));
  for (const type of ["updraft", "downdraft", "turbulence"]) {
    canvas.scatter(count, type, rng, 0.8, type === "turbulence" ? 2.1 : 1.5, { irregularity: type === "turbulence" ? 1.1 : 0.75 });
  }
}

const BLOCKING_TYPES = new Set(["rockHigh", "skyIsland"]);

function cellHasBlockingTerrain(rawTerrain) {
  return terrainList(rawTerrain).some(type => BLOCKING_TYPES.has(type));
}

function clearMultiSideDeploymentLanes(canvas, sides) {
  const zones = Object.values(sides ?? {}).map(side => zoneBuffer(side?.zone, canvas.board, 0)).filter(Boolean);
  if (zones.length <= 2) return;
  const center = { x: (canvas.board.width - 1) / 2, y: (canvas.board.height - 1) / 2 };
  const radius = Math.max(1, Math.round(Math.min(canvas.board.width, canvas.board.height) / 24));

  const clearBlockingAt = (cx, cy) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if (!canvas.within(x, y)) continue;
        if (Math.hypot(x - cx, y - cy) > radius + 0.35) continue;
        for (const type of BLOCKING_TYPES) canvas.remove(x, y, type);
      }
    }
  };

  for (const zone of zones) {
    const from = zoneCenter(zone);
    if (!from) continue;
    const steps = Math.max(4, Math.ceil(Math.hypot(center.x - from.x, center.y - from.y)));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      clearBlockingAt(from.x + (center.x - from.x) * t, from.y + (center.y - from.y) * t);
    }
  }
}

function thinBlockingTerrainInDeploymentZones(canvas, sides, rng) {
  const zones = Object.values(sides ?? {}).map(side => zoneBuffer(side?.zone, canvas.board, 0)).filter(Boolean);
  for (const zone of zones) {
    const cells = [];
    let free = 0;
    for (let y = zone.y1; y <= zone.y2; y++) {
      for (let x = zone.x1; x <= zone.x2; x++) {
        const cell = key(x, y);
        const blocking = cellHasBlockingTerrain(canvas.terrain[cell]);
        cells.push({ x, y, cell, blocking });
        if (!blocking) free += 1;
      }
    }
    const minimumFree = Math.max(2, Math.ceil(cells.length * 0.55));
    const blockingCells = cells.filter(item => item.blocking);
    for (let i = blockingCells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [blockingCells[i], blockingCells[j]] = [blockingCells[j], blockingCells[i]];
    }
    while (free < minimumFree && blockingCells.length) {
      const item = blockingCells.pop();
      for (const type of BLOCKING_TYPES) canvas.remove(item.x, item.y, type);
      free += 1;
    }
  }
}

function finalizeBalanced(canvas, rng, mode, sides = null) {
  const area = canvas.board.width * canvas.board.height;
  canvas.cap(["rockHigh", "skyIsland", "wreck", "reef"], Math.max(4, Math.round(area * (mode === "air" ? 0.09 : 0.13))), rng);
  canvas.cap(["rockLow", "shoal"], Math.max(8, Math.round(area * 0.18)), rng);
  canvas.cap(["smoke", "cloud", "stormCloud"], Math.max(12, Math.round(area * 0.25)), rng);
  canvas.cap(["updraft", "downdraft", "turbulence"], Math.max(8, Math.round(area * 0.14)), rng);
  thinBlockingTerrainInDeploymentZones(canvas, sides, rng);
  clearMultiSideDeploymentLanes(canvas, sides);
}

export class TerrainGenerationService {
  static seedFor({ scenarioId = "custom", board = {}, salt = "" } = {}) {
    return `${scenarioId}:${board.width ?? 0}x${board.height ?? 0}:${Date.now()}:${Math.random()}:${salt}`;
  }

  static generate({ board, scenarioId = "openDuel", mode = "mixed", sides = null, seed = null } = {}) {
    const actualSeed = seed ?? this.seedFor({ scenarioId, board });
    const rng = mulberry32(hashSeed(actualSeed));
    const canvas = new TerrainCanvas(board);
    const generator = String(scenarioId ?? "openDuel");

    if (generator === "airDuel") this.generateAirDuel(canvas, rng);
    else if (generator === "skyArchipelago") this.generateSkyArchipelago(canvas, rng);
    else if (generator === "harborBreakout") this.generateHarbor(canvas, rng);
    else if (generator === "reefChase") this.generateReefChase(canvas, rng);
    else if (generator === "stormContact") this.generateStorm(canvas, rng, mode);
    else this.generateOpen(canvas, rng, mode);

    finalizeBalanced(canvas, rng, mode, sides);
    filterTerrainForMode(canvas, mode);

    return {
      terrain: canvas.terrain,
      seed: actualSeed,
      summary: terrainSummary(canvas.terrain)
    };
  }

  static generateOpen(canvas, rng, mode = "mixed") {
    const area = canvas.board.width * canvas.board.height;
    if (mode !== "air") {
      canvas.scatter(Math.max(1, Math.round(area / 460)), "shoal", rng, 1, 2.4);
      if (rng() > 0.5) canvas.scatter(1, "wreck", rng, 0.8, 1.2);
    }
    if (mode !== "sea") {
      addFloatingRockField(canvas, rng, { density: 0.45, skyChance: mode === "air" ? 0.12 : 0.06 });
      addAirCurrents(canvas, rng, { density: 0.35 });
    }
    if (rng() > 0.35) addBalancedClouds(canvas, rng, { density: 0.45, type: mode === "sea" ? "smoke" : "cloud", stormChance: mode === "sea" ? 0 : 0.05 });
  }

  static generateAirDuel(canvas, rng) {
    addFloatingRockField(canvas, rng, { density: 0.75, skyChance: 0.18 });
    addBalancedClouds(canvas, rng, { density: 0.85, bands: true, type: "cloud", stormChance: 0.08 });
    addAirCurrents(canvas, rng, { density: 0.7 });
  }

  static generateSkyArchipelago(canvas, rng) {
    addFloatingRockField(canvas, rng, { density: 1.35, large: true, skyChance: 0.45 });
    addBalancedClouds(canvas, rng, { density: 0.65, bands: true, type: "cloud", stormChance: 0.12 });
    addAirCurrents(canvas, rng, { density: 0.9 });
    if (rng() > 0.35) canvas.scatter(Math.max(1, Math.round(canvas.board.width * canvas.board.height / 900)), "wreck", rng, 0.7, 1.2);
  }

  static generateHarbor(canvas, rng) {
    const width = canvas.board.width;
    const height = canvas.board.height;
    const channelTop = Math.max(3, Math.floor(height * (0.27 + rng() * 0.08)));
    const channelBottom = Math.min(height - 4, Math.ceil(height * (0.72 - rng() * 0.08)));
    const phase = rng() * Math.PI * 2;
    for (let x = 0; x < width; x++) {
      const bend = Math.sin((x / Math.max(1, width)) * Math.PI * 2 + phase) * Math.max(1, height * 0.06);
      const topY = Math.round(channelTop + bend + (rng() - 0.5) * 1.5);
      const bottomY = Math.round(channelBottom + bend * 0.55 + (rng() - 0.5) * 1.5);
      for (let y = 0; y < topY; y++) if (rng() > 0.18) canvas.add(x, y, rng() > 0.28 ? "rockHigh" : "rockLow");
      for (let y = bottomY; y < height; y++) if (rng() > 0.18) canvas.add(x, y, rng() > 0.32 ? "rockHigh" : "rockLow");
    }
    canvas.scatter(Math.max(1, Math.round(width * height / 620)), "rockLow", rng, 1, 2.2);
    canvas.scatter(Math.max(1, Math.round(width * height / 850)), "wreck", rng, 0.7, 1.1);
    addBalancedClouds(canvas, rng, { density: 0.7 });
  }

  static generateReefChase(canvas, rng) {
    const width = canvas.board.width;
    const height = canvas.board.height;
    const bands = Math.max(1, Math.round(width * height / 900));
    for (let i = 0; i < bands + 1; i++) {
      const y = height * (0.32 + rng() * 0.36);
      canvas.addMeander({
        startX: width * (0.10 + rng() * 0.12),
        startY: y,
        endX: width * (0.90 - rng() * 0.12),
        endY: y + (rng() - 0.5) * height * 0.25,
        steps: Math.max(8, Math.round(width / 3)),
        type: rng() > 0.38 ? "reef" : "shoal",
        rng,
        radius: 1.1 + rng() * 1.2,
        drift: Math.max(2, height * 0.075)
      });
    }
    canvas.scatter(Math.max(2, Math.round(width * height / 520)), "shoal", rng, 1, 2.5);
    canvas.scatter(Math.max(1, Math.round(width * height / 1000)), "rockLow", rng, 0.8, 1.6);
    if (rng() > 0.55) addFloatingRockField(canvas, rng, { density: 0.35 });
  }

  static generateStorm(canvas, rng, mode = "sea") {
    const area = canvas.board.width * canvas.board.height;
    addBalancedClouds(canvas, rng, { density: 1.35, bands: true });
    if (mode !== "air") {
      canvas.scatter(Math.max(1, Math.round(area / 720)), "wreck", rng, 0.8, 1.2);
      canvas.scatter(Math.max(1, Math.round(area / 820)), "shoal", rng, 1, 2.0);
    }
    if (mode !== "sea") addFloatingRockField(canvas, rng, { density: 0.55 });
  }

  static summarize(terrain) {
    return terrainSummary(terrain);
  }
}
