import { BATTLE_MODE_LABELS, BATTLE_MODE_TOOLTIPS, TERRAIN_ICONS, TERRAIN_LABELS, WIND_STRENGTH_LABELS, WIND_STRENGTH_RATINGS, SEA_STATE_LABELS, VISIBILITY_LABELS } from "../utils/constants.js";
import { TerrainGenerationService } from "../services/terrain-generation-service.js";
import { boardPixelSize, buildHexGridPath, cellPath, cellToPixel, normalizeAngle } from "../board/board-geometry.js";
import { SetupZoneGeometryCache } from "./setup-zone-geometry-cache.js";

function terrainList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return [String(value)].filter(Boolean);
}

function headingPoint(cx, cy, radius, heading) {
  const rad = normalizeAngle(heading) * Math.PI / 180;
  return { x: cx + Math.sin(rad) * radius, y: cy - Math.cos(rad) * radius };
}

export class BattleSetupPreviewBuilder {
  static build(battle) {
    return this.buildPreview(battle);
  }

  static buildPreview(battle) {
    const width = Math.max(1, Number(battle.board?.width ?? 24));
    const height = Math.max(1, Number(battle.board?.height ?? 16));
    const cellSize = 18;
    const board = { width, height, cellSize };
    const pixelSize = boardPixelSize(board);
    const pixelWidth = Math.ceil(pixelSize.width);
    const pixelHeight = Math.ceil(pixelSize.height);
    const terrainEntries = [];

    for (const [key, raw] of Object.entries(battle.board?.terrain ?? {})) {
      const [xRaw, yRaw] = key.split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue;
      const types = terrainList(raw);
      if (!types.length) continue;
      const center = cellToPixel(board, x, y);
      terrainEntries.push({
        key,
        x,
        y,
        path: cellPath(board, x, y),
        cx: center.cx,
        cy: center.cy,
        terrainClass: types.map(type => `terrain-${type}`).join(" "),
        terrainLabel: types.map(type => TERRAIN_LABELS[type] ?? type).join(" + "),
        terrainIcon: types.map(type => TERRAIN_ICONS[type] ?? "").filter(Boolean).join("")
      });
    }

    const zones = Object.values(battle.setup?.sides ?? {}).map(side => {
      const zone = side.zone ?? { x1: 0, y1: 0, x2: 0, y2: 0, heading: 120 };
      const geometry = SetupZoneGeometryCache.get(board, zone);
      const bounds = geometry.bounds;
      const end = headingPoint(bounds.cx, bounds.cy, cellSize * 1.5, zone.heading);
      return {
        id: side.id,
        name: side.name,
        color: side.color,
        cells: geometry.cells,
        labelX: bounds.x + 4,
        labelY: bounds.y + 12,
        arrowX1: bounds.cx,
        arrowY1: bounds.cy,
        arrowX2: end.x,
        arrowY2: end.y
      };
    });

    const ships = (battle.ships ?? []).map(ship => {
      const center = cellToPixel(board, Number(ship.x ?? 0), Number(ship.y ?? 0));
      const end = headingPoint(center.cx, center.cy, cellSize * 0.75, ship.heading);
      const side = battle.setup?.sides?.[ship.side] ?? {};
      return {
        id: ship.id,
        name: ship.name,
        isCreature: ship.unitType === "creature",
        side: ship.side,
        sideName: side.name ?? ship.side,
        sideColor: side.color ?? "#777777",
        cx: center.cx,
        cy: center.cy,
        heading: Number(ship.heading ?? 0),
        renderHeading: normalizeAngle(Number(ship.heading ?? 0) - 90),
        arrowX2: end.x,
        arrowY2: end.y
      };
    });

    const mode = ["sea", "air", "mixed"].includes(battle.setup?.mode) ? battle.setup.mode : "mixed";
    const terrainSummary = TerrainGenerationService.summarize(battle.board?.terrain ?? {});
    return {
      width,
      height,
      cellSize,
      pixelWidth,
      pixelHeight,
      viewBox: `0 0 ${pixelWidth} ${pixelHeight}`,
      gridPath: buildHexGridPath(board),
      terrainEntries,
      terrainSummary,
      terrainCount: terrainEntries.length,
      zones,
      ships,
      mode,
      modeLabel: BATTLE_MODE_LABELS[mode] ?? mode,
      modeTitle: BATTLE_MODE_TOOLTIPS[mode] ?? "",
      windLabel: `Б${WIND_STRENGTH_RATINGS[battle.wind?.strength] ?? "?"}`,
      windTitle: `${WIND_STRENGTH_LABELS[battle.wind?.strength] ?? battle.wind?.strength ?? "—"}: ${WIND_STRENGTH_RATINGS[battle.wind?.strength] ?? "?"}/5`,
      seaLabel: SEA_STATE_LABELS[battle.sea?.state] ?? battle.sea?.state ?? "—",
      visibilityLabel: VISIBILITY_LABELS[battle.sea?.visibility] ?? battle.sea?.visibility ?? "—"
    };
  }
}
