import { MovementEngine } from "../engine/movement-engine.js";
import { TERRAIN_DESCRIPTIONS, TERRAIN_LABELS } from "../utils/constants.js";

export class TerrainTooltipBuilder {
  static signature(rawTerrain) {
    return [...new Set(MovementEngine.terrainList(rawTerrain).map(String))].join("|");
  }

  static build(rawTerrain) {
    return [...new Set(MovementEngine.terrainList(rawTerrain).map(String))].map(type => ({
      type,
      name: TERRAIN_LABELS[type] ?? type,
      description: TERRAIN_DESCRIPTIONS[type] ?? "Особая область поля боя.",
      altitudeLabel: MovementEngine.getTerrainAltitudeRangeLabel(type)
    }));
  }
}
