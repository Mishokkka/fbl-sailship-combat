const SQRT3 = Math.sqrt(3);

export function normalizeHeading(heading) {
  const raw = normalizeAngle(heading);
  return (Math.round(raw / 60) * 60) % 360;
}

export function rotateHeading(heading, steps) {
  return normalizeHeading(Number(heading) + steps * 60);
}

export function normalizeAngle(angle) {
  return ((Number(angle ?? 0) % 360) + 360) % 360;
}

export function angleBetween(a, b) {
  const delta = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(delta, 360 - delta);
}

export function getHexMetrics(cellSize = 48) {
  const height = Math.max(1, Number(cellSize ?? 48));
  const radius = height / SQRT3;
  const width = radius * 2;
  const columnStep = radius * 1.5;
  return { cellSize: height, height, radius, width, columnStep };
}

export function boardPixelSize(board = {}) {
  const metrics = getHexMetrics(board.cellSize ?? 48);
  const width = Math.max(1, Number(board.width ?? 1));
  const height = Math.max(1, Number(board.height ?? 1));
  return {
    width: metrics.width + Math.max(0, width - 1) * metrics.columnStep,
    height: height * metrics.height + (width > 1 ? metrics.height / 2 : 0)
  };
}

export function isOddColumn(x) {
  return Math.abs(Number(x ?? 0)) % 2 === 1;
}

export function cellToPixel(board = {}, x = 0, y = 0) {
  const metrics = getHexMetrics(board.cellSize ?? 48);
  const cx = metrics.radius + Number(x ?? 0) * metrics.columnStep;
  const cy = metrics.height / 2 + Number(y ?? 0) * metrics.height + (isOddColumn(x) ? metrics.height / 2 : 0);
  return { x: cx, y: cy, cx, cy, ...metrics };
}

export function cellPolygonPoints(board = {}, x = 0, y = 0) {
  const { cx, cy, radius } = cellToPixel(board, x, y);
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

export function cellPath(board = {}, x = 0, y = 0) {
  const points = cellPolygonPoints(board, x, y);
  if (!points.length) return "";
  const [first, ...rest] = points;
  return `M ${round(first.x)} ${round(first.y)} ${rest.map(p => `L ${round(p.x)} ${round(p.y)}`).join(" ")} Z`;
}

const HEX_GRID_PATH_CACHE_LIMIT = 8;
const hexGridPathCache = new Map();
let hexGridPathCacheHits = 0;
let hexGridPathCacheMisses = 0;

export function buildHexGridPath(board = {}) {
  const width = Math.max(0, Math.floor(Number(board.width ?? 0)));
  const height = Math.max(0, Math.floor(Number(board.height ?? 0)));
  const cellSize = Math.max(1, Number(board.cellSize ?? 48));
  const cacheKey = `${width}:${height}:${cellSize}`;
  if (hexGridPathCache.has(cacheKey)) {
    const cached = hexGridPathCache.get(cacheKey);
    hexGridPathCache.delete(cacheKey);
    hexGridPathCache.set(cacheKey, cached);
    hexGridPathCacheHits += 1;
    return cached;
  }

  const parts = [];
  const normalizedBoard = { width, height, cellSize };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) parts.push(cellPath(normalizedBoard, x, y));
  }
  const path = parts.join(" ");
  hexGridPathCache.set(cacheKey, path);
  hexGridPathCacheMisses += 1;
  while (hexGridPathCache.size > HEX_GRID_PATH_CACHE_LIMIT) {
    hexGridPathCache.delete(hexGridPathCache.keys().next().value);
  }
  return path;
}

export function clearHexGridPathCache() {
  hexGridPathCache.clear();
  hexGridPathCacheHits = 0;
  hexGridPathCacheMisses = 0;
}

export function getHexGridPathCacheStats() {
  return {
    size: hexGridPathCache.size,
    limit: HEX_GRID_PATH_CACHE_LIMIT,
    hits: hexGridPathCacheHits,
    misses: hexGridPathCacheMisses
  };
}

export function pixelToCell(board = {}, px = 0, py = 0) {
  const metrics = getHexMetrics(board.cellSize ?? 48);
  const size = boardPixelSize(board);
  const xPixel = Number(px ?? 0);
  const yPixel = Number(py ?? 0);
  if (xPixel < -metrics.radius || yPixel < -metrics.height || xPixel > size.width + metrics.radius || yPixel > size.height + metrics.height) return null;

  const approxX = Math.round((xPixel - metrics.radius) / metrics.columnStep);
  const approxOffset = isOddColumn(approxX) ? metrics.height / 2 : 0;
  const approxY = Math.round((yPixel - metrics.height / 2 - approxOffset) / metrics.height);
  let best = null;

  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const x = approxX + dx;
      const y = approxY + dy;
      if (!withinBoard(board, x, y)) continue;
      const center = cellToPixel(board, x, y);
      const distance = (center.cx - xPixel) ** 2 + (center.cy - yPixel) ** 2;
      if (!best || distance < best.distance) best = { x, y, key: cellKey(x, y), distance };
    }
  }

  return best ? { x: best.x, y: best.y, key: best.key } : null;
}

export function headingToVector(heading, x = 0, y = 0) {
  heading = normalizeHeading(heading);
  const odd = isOddColumn(x);
  const evenMap = {
    0: { dx: 0, dy: -1 },
    60: { dx: 1, dy: -1 },
    120: { dx: 1, dy: 0 },
    180: { dx: 0, dy: 1 },
    240: { dx: -1, dy: 0 },
    300: { dx: -1, dy: -1 }
  };
  const oddMap = {
    0: { dx: 0, dy: -1 },
    60: { dx: 1, dy: 0 },
    120: { dx: 1, dy: 1 },
    180: { dx: 0, dy: 1 },
    240: { dx: -1, dy: 1 },
    300: { dx: -1, dy: 0 }
  };
  return odd ? oddMap[heading] : evenMap[heading];
}

export function directionToCell(from, to) {
  if (Number(from?.x ?? 0) === Number(to?.x ?? 0) && Number(from?.y ?? 0) === Number(to?.y ?? 0)) return normalizeHeading(from?.heading ?? 0);
  return normalizeHeading(bearingBetween(from, to));
}

export function bearingBetween(from, to) {
  if (Number(from?.x ?? 0) === Number(to?.x ?? 0) && Number(from?.y ?? 0) === Number(to?.y ?? 0)) return normalizeAngle(from?.heading ?? 0);
  const a = cellToPixel({ cellSize: 1 }, Number(from?.x ?? 0), Number(from?.y ?? 0));
  const b = cellToPixel({ cellSize: 1 }, Number(to?.x ?? 0), Number(to?.y ?? 0));
  return normalizeAngle(Math.atan2(b.cx - a.cx, -(b.cy - a.cy)) * 180 / Math.PI);
}

export function distanceCells(a, b) {
  const ac = offsetToCube(Number(a?.x ?? 0), Number(a?.y ?? 0));
  const bc = offsetToCube(Number(b?.x ?? 0), Number(b?.y ?? 0));
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}

export function lineCells(a, b) {
  const start = offsetToCube(Number(a?.x ?? 0), Number(a?.y ?? 0));
  const end = offsetToCube(Number(b?.x ?? 0), Number(b?.y ?? 0));
  const n = distanceCells(a, b);
  if (n <= 0) return [{ x: Number(a?.x ?? 0), y: Number(a?.y ?? 0), key: cellKey(a?.x ?? 0, a?.y ?? 0) }];
  const cells = [];
  const seen = new Set();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cube = cubeRound({
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t),
      z: lerp(start.z, end.z, t)
    });
    const cell = cubeToOffset(cube);
    const key = cellKey(cell.x, cell.y);
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ ...cell, key });
  }
  return cells;
}

export function withinBoard(board, x, y) {
  return x >= 0 && y >= 0 && x < Number(board?.width ?? 0) && y < Number(board?.height ?? 0);
}

export function cellKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

export function offsetToCube(x, y) {
  const q = Number(x ?? 0);
  const r = Number(y ?? 0) - (q - (q & 1)) / 2;
  return { x: q, z: r, y: -q - r };
}

export function cubeToOffset(cube) {
  const x = Math.round(Number(cube.x ?? 0));
  const z = Math.round(Number(cube.z ?? 0));
  const y = z + (x - (x & 1)) / 2;
  return { x, y };
}

function cubeRound(cube) {
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);
  const xDiff = Math.abs(rx - cube.x);
  const yDiff = Math.abs(ry - cube.y);
  const zDiff = Math.abs(rz - cube.z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

function lerp(a, b, t) {
  return Number(a) + (Number(b) - Number(a)) * Number(t);
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
