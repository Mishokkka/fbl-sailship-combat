import { cellPath, cellPolygonPoints, cellToPixel, headingToVector, withinBoard } from "../board/board-geometry.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { TERRAIN_ICONS, TERRAIN_LABELS } from "../utils/constants.js";

const NEIGHBOR_HEADINGS = [0, 60, 120, 180, 240, 300];
const CACHE_LIMIT = 6;
const clusterCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;

function canonicalTerrain(rawTerrain) {
  return [...new Set(MovementEngine.terrainList(rawTerrain).map(String))].sort();
}

function terrainSignature(types) {
  return types.join("|");
}

function selectIconCell(cells) {
  const averageX = cells.reduce((sum, cell) => sum + cell.cx, 0) / Math.max(1, cells.length);
  const averageY = cells.reduce((sum, cell) => sum + cell.cy, 0) / Math.max(1, cells.length);
  return cells.reduce((best, cell) => {
    const distance = (cell.cx - averageX) ** 2 + (cell.cy - averageY) ** 2;
    return !best || distance < best.distance ? { cell, distance } : best;
  }, null)?.cell ?? cells[0];
}

function roundCoordinate(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function pointKey(point) {
  return `${roundCoordinate(point.x)},${roundCoordinate(point.y)}`;
}

function buildBoundaryPath(board, cells) {
  const edges = new Map();
  for (const cell of cells) {
    const points = cellPolygonPoints(board, cell.x, cell.y);
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const startKey = pointKey(start);
      const endKey = pointKey(end);
      const key = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, { start, end });
    }
  }
  return [...edges.values()]
    .map(({ start, end }) => `M ${roundCoordinate(start.x)} ${roundCoordinate(start.y)} L ${roundCoordinate(end.x)} ${roundCoordinate(end.y)}`)
    .join(" ");
}

export class TerrainClusterBuilder {
  static build(board, terrainRecord, { selectedAltitude = 0, cacheKey = null } = {}) {
    const key = cacheKey == null ? null : String(cacheKey);
    if (key && clusterCache.has(key)) {
      const cached = clusterCache.get(key);
      clusterCache.delete(key);
      clusterCache.set(key, cached);
      cacheHits += 1;
      return cached;
    }

    const clusters = this.buildClusters(board, terrainRecord, { selectedAltitude });
    if (key) {
      clusterCache.set(key, clusters);
      cacheMisses += 1;
      while (clusterCache.size > CACHE_LIMIT) clusterCache.delete(clusterCache.keys().next().value);
    }
    return clusters;
  }

  static buildClusters(board, terrainRecord, { selectedAltitude = 0 } = {}) {
    const cellsByKey = new Map();
    for (const [key, rawTerrain] of Object.entries(terrainRecord ?? {})) {
      const [xRaw, yRaw] = key.split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !withinBoard(board, x, y)) continue;
      const terrainTypes = canonicalTerrain(rawTerrain);
      if (!terrainTypes.length) continue;
      const center = cellToPixel(board, x, y);
      cellsByKey.set(`${x},${y}`, {
        key: `${x},${y}`,
        x,
        y,
        cx: center.cx,
        cy: center.cy,
        path: cellPath(board, x, y),
        terrainTypes,
        signature: terrainSignature(terrainTypes)
      });
    }

    const visited = new Set();
    const clusters = [];
    for (const seed of cellsByKey.values()) {
      if (visited.has(seed.key)) continue;
      visited.add(seed.key);
      const queue = [seed];
      let queueIndex = 0;
      const cells = [];
      while (queueIndex < queue.length) {
        const cell = queue[queueIndex++];
        cells.push(cell);
        for (const heading of NEIGHBOR_HEADINGS) {
          const vector = headingToVector(heading, cell.x, cell.y);
          const neighbor = cellsByKey.get(`${cell.x + vector.dx},${cell.y + vector.dy}`);
          if (!neighbor || visited.has(neighbor.key) || neighbor.signature !== seed.signature) continue;
          visited.add(neighbor.key);
          queue.push(neighbor);
        }
      }

      const iconCell = selectIconCell(cells);
      const terrainTypes = seed.terrainTypes;
      clusters.push({
        id: `terrain-cluster-${clusters.length + 1}`,
        keys: cells.map(cell => cell.key),
        cellCount: cells.length,
        path: cells.map(cell => cell.path).join(" "),
        boundaryPath: buildBoundaryPath(board, cells),
        cx: iconCell.cx,
        cy: iconCell.cy,
        terrainTypes,
        terrainClass: terrainTypes.map(type => `terrain-${type}`).join(" "),
        terrainIcon: terrainTypes.map(type => TERRAIN_ICONS[type] ?? "").filter(Boolean).join(""),
        terrainLabel: terrainTypes.map(type => TERRAIN_LABELS[type] ?? type).join(" + "),
        terrainHeightLabel: MovementEngine.getTerrainHeightLabel(terrainTypes),
        blockedByTerrain: MovementEngine.isBlockingTerrain(terrainTypes, selectedAltitude)
      });
    }
    return clusters;
  }

  static clearCache() {
    clusterCache.clear();
    cacheHits = 0;
    cacheMisses = 0;
  }

  static cacheStats() {
    return { size: clusterCache.size, limit: CACHE_LIMIT, hits: cacheHits, misses: cacheMisses };
  }
}
