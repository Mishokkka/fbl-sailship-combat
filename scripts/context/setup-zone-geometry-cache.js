import { cellKey, cellPath, withinBoard } from "../board/board-geometry.js";

const CACHE_LIMIT = 32;
const cache = new Map();
let hits = 0;
let misses = 0;

function cacheKey(board, zone) {
  return [
    Number(board?.width ?? 0),
    Number(board?.height ?? 0),
    Number(board?.cellSize ?? 48),
    Number(zone?.x1 ?? 0),
    Number(zone?.y1 ?? 0),
    Number(zone?.x2 ?? zone?.x1 ?? 0),
    Number(zone?.y2 ?? zone?.y1 ?? 0)
  ].join(":");
}

function calculateBounds(cells) {
  const points = [];
  for (const cell of cells) {
    for (const match of cell.path.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
      points.push({ x: Number(match[1]), y: Number(match[2]) });
    }
  }
  if (!points.length) return Object.freeze({ x: 0, y: 0, width: 0, height: 0, cx: 0, cy: 0 });
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return Object.freeze({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  });
}

export class SetupZoneGeometryCache {
  static get(board, zone) {
    const key = cacheKey(board, zone);
    if (cache.has(key)) {
      const cached = cache.get(key);
      cache.delete(key);
      cache.set(key, cached);
      hits += 1;
      return cached;
    }

    const cells = [];
    for (let y = Number(zone?.y1 ?? 0); y <= Number(zone?.y2 ?? zone?.y1 ?? 0); y += 1) {
      for (let x = Number(zone?.x1 ?? 0); x <= Number(zone?.x2 ?? zone?.x1 ?? 0); x += 1) {
        if (!withinBoard(board, x, y)) continue;
        cells.push(Object.freeze({ key: cellKey(x, y), x, y, path: cellPath(board, x, y) }));
      }
    }
    const geometry = Object.freeze({ cells: Object.freeze(cells), bounds: calculateBounds(cells) });
    cache.set(key, geometry);
    misses += 1;
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return geometry;
  }

  static clear() {
    cache.clear();
    hits = 0;
    misses = 0;
  }

  static stats() {
    return { size: cache.size, limit: CACHE_LIMIT, hits, misses };
  }
}
