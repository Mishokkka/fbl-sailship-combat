import {
  boardPixelSize,
  buildHexGridPath,
  cellKey,
  cellPath,
  cellToPixel,
  normalizeAngle,
  withinBoard
} from "../board/board-geometry.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { GunneryEngine } from "../engine/gunnery-engine.js";
import { CreatureAttackEngine } from "../engine/creature-attack-engine.js";
import { ShipViewModelBuilder } from "./ship-view-model-builder.js";
import { BoardBackgroundContextBuilder } from "./board-background-context-builder.js";
import { PlayerControlService } from "../services/player-control-service.js";
import { SetupZoneGeometryCache } from "./setup-zone-geometry-cache.js";
import { TerrainClusterBuilder } from "./terrain-cluster-builder.js";
export class BoardContextBuilder {
  constructor(app, renderCache = null) {
    this.app = app;
    this.renderCache = renderCache;
    this.shipView = new ShipViewModelBuilder(app);
  }
  build(battle, selectedShip) {
    return this.buildContext(battle, selectedShip);
  }
  buildContext(battle, selectedShip) {
    const app = this.app;
    const cellSize = Number(battle.board.cellSize ?? 48);
    battle.board.cellSize = cellSize;
    const canUseSelectedShip = Boolean(selectedShip && PlayerControlService.canViewShipDetails(battle, game.user, selectedShip.id));
    const reachable = canUseSelectedShip && app._canShowMovement(battle, selectedShip) ? MovementEngine.getReachableCells(battle, selectedShip) : [];
    const occupied = new Set(battle.ships.filter(s => s.id !== selectedShip?.id).map(s => cellKey(s.x, s.y)));
    const targetIds = canUseSelectedShip ? this.getTargetIds(battle, selectedShip) : new Set();
    const selectedTarget = app.selectedTargetId ? battle.ships.find(s => s.id === app.selectedTargetId) : null;
    const pixelSize = boardPixelSize(battle.board);
    const pixelWidth = Math.ceil(pixelSize.width);
    const pixelHeight = Math.ceil(pixelSize.height);
    const camera = app._getBoardCamera(pixelWidth, pixelHeight);

    return {
      width: battle.board.width,
      height: battle.board.height,
      cellSize,
      pixelWidth,
      pixelHeight,
      background: BoardBackgroundContextBuilder.build(battle.board, pixelWidth, pixelHeight, battle.id),
      gridPath: buildHexGridPath(battle.board),
      viewBox: `${camera.x} ${camera.y} ${camera.viewWidth} ${camera.viewHeight}`,
      camera,
      lod: camera.zoom < 0.75 ? "far" : camera.zoom < 1.15 ? "medium" : "near",
      terrainClusters: this.prepareTerrainClusters(battle, selectedShip),
      terrainPaintable: Boolean(app.terrainMode && !battle.setupConfirmed),
      hoverCell: { x: 0, y: 0, px: 0, py: 0, key: "0,0" },
      setupZones: this.prepareSetupZones(battle),
      deployable: this.prepareDeployableCells(battle, selectedShip, occupied),
      movementPlan: app.movementPlan?.getContext(battle) ?? null,
      reachable: reachable.map(c => this.prepareCellShape(battle, c)),
      targetIds: [...targetIds],
      ships: this.prepareShipTokens(battle, selectedShip, { targetIds, cellSize }),
      arcs: canUseSelectedShip && battle.setupConfirmed ? this.prepareArcOverlays(battle, selectedShip) : [],
      targetLine: canUseSelectedShip && selectedTarget && battle.setupConfirmed ? this.prepareTargetLine(battle, selectedShip, selectedTarget) : null,
      ...this.prepareWindParticles(battle, pixelWidth, pixelHeight, camera.zoom < 0.75 ? "far" : camera.zoom < 1.15 ? "medium" : "near")
    };
  }
  buildFleetContext(battle, selectedShip) {
    const cellSize = Number(battle.board?.cellSize ?? 48);
    return {
      ships: this.prepareShipTokens(battle, selectedShip, { targetIds: new Set(), cellSize })
    };
  }

  prepareShipTokens(battle, selectedShip, { targetIds = new Set(), cellSize = Number(battle.board?.cellSize ?? 48) } = {}) {
    return [...(battle.ships ?? [])]
      .sort((a, b) => Number(Boolean(a.flags?.attachedTo)) - Number(Boolean(b.flags?.attachedTo)))
      .map(ship => this.shipView.prepareShipToken(battle, ship, cellSize, selectedShip, targetIds));
  }

  prepareWindParticles(battle, pixelWidth, pixelHeight, lod = "near") {
    const rating = ({ calm: 0, light: 1, moderate: 2, strong: 3, storm: 4 }[battle.wind?.strength] ?? 2);
    const baseCount = [0, 24, 38, 54, 70][rating] ?? 38;
    const lodFactor = lod === "far" ? 0.45 : lod === "medium" ? 0.72 : 1;
    const count = rating === 0 ? 0 : Math.max(12, Math.round(baseCount * lodFactor));
    const span = Math.max(pixelWidth, pixelHeight);
    const travel = Math.ceil(span * 2.6);
    const durationBase = Math.max(0.9, 3.0 - rating * 0.5);
    const particles = Array.from({ length: count }, (_, i) => {
      const lane = ((i * 137 + 53) % Math.max(1, pixelHeight * 3)) - pixelHeight;
      const x = -span - ((i * 83) % Math.max(1, span));
      const length = 12 + (i % 5) * 5 + rating * 2;
      return {
        i,
        x1: x,
        x2: x + length,
        y: lane,
        width: 0.7 + (i % 3) * 0.35,
        duration: Number((durationBase + (i % 5) * 0.18).toFixed(2)),
        delay: Number((-(i * 0.31) % Math.max(0.1, durationBase)).toFixed(2))
      };
    });
    return {
      windParticles: particles,
      windParticleAngle: normalizeAngle(Number(battle.wind?.direction ?? 0) - 90),
      windParticleCenterX: Math.round(pixelWidth / 2),
      windParticleCenterY: Math.round(pixelHeight / 2),
      windParticleTravel: travel,
      windParticleOpacity: rating === 0 ? 0 : Math.min(0.66, 0.16 + rating * 0.11)
    };
  }

  getTargetIds(battle, selectedShip) {
    const targetIds = new Set();
    if (!selectedShip || !battle.setupConfirmed) return targetIds;
    if (selectedShip.unitType === "creature") {
      for (const target of CreatureAttackEngine.getAllTargets(battle, selectedShip)) targetIds.add(target.target.id);
      return targetIds;
    }
    for (const arc of GunneryEngine.getArcOrder()) {
      const targets = this.renderCache
        ? this.renderCache.getTargets(battle, selectedShip, arc, { aimedSection: this.app.aimSection })
        : GunneryEngine.getTargets(battle, selectedShip, arc, { aimedSection: this.app.aimSection });
      for (const target of targets) targetIds.add(target.target.id);
    }
    return targetIds;
  }

  prepareCellShape(battle, cell) {
    const center = cellToPixel(battle.board, cell.x, cell.y);
    return {
      ...cell,
      px: center.cx,
      py: center.cy,
      cx: center.cx,
      cy: center.cy,
      path: cellPath(battle.board, cell.x, cell.y)
    };
  }

  prepareSetupZones(battle) {
    if (battle.setupConfirmed) return [];
    const zones = [];
    for (const side of Object.values(battle.setup?.sides ?? {})) {
      const zone = side.zone ?? null;
      if (!zone) continue;
      const geometry = SetupZoneGeometryCache.get(battle.board, zone);
      const cells = geometry.cells.map(cell => {
        const center = cellToPixel(battle.board, cell.x, cell.y);
        return { ...cell, px: center.cx, py: center.cy, cx: center.cx, cy: center.cy };
      });
      const bounds = geometry.bounds;
      zones.push({
        id: side.id,
        name: side.name,
        color: side.color,
        cells,
        labelX: bounds.x + 6,
        labelY: bounds.y + 14
      });
    }
    return zones;
  }

  prepareDeployableCells(battle, selectedShip, occupied) {
    const app = this.app;
    const deployable = [];
    if (!app.deployMode || !selectedShip || battle.setupConfirmed) return deployable;
    const zone = battle.setup?.sides?.[selectedShip.side]?.zone ?? null;
    if (!zone) return deployable;
    const mode = MovementEngine.getBattleMode(battle);
    const altitude = mode === "sea"
      ? 0
      : mode === "air"
        ? Math.max(3, Number(selectedShip.altitude ?? 3))
        : Number(selectedShip.altitude ?? 0);

    for (let y = Number(zone.y1 ?? 0); y <= Number(zone.y2 ?? 0); y++) {
      for (let x = Number(zone.x1 ?? 0); x <= Number(zone.x2 ?? 0); x++) {
        if (!withinBoard(battle.board, x, y)) continue;
        const key = cellKey(x, y);
        const terrain = battle.board?.terrain?.[key] ?? null;
        if (!occupied.has(key) && !MovementEngine.isBlockingTerrain(terrain, altitude)) {
          deployable.push(this.prepareCellShape(battle, { key, x, y }));
        }
      }
    }
    return deployable;
  }

  prepareTerrainClusters(battle, selectedShip) {
    return TerrainClusterBuilder.build(battle.board, battle.board?.terrain, {
      selectedAltitude: Number(selectedShip?.altitude ?? 0),
      cacheKey: `${battle.id}:${battle.board?.width ?? 0}x${battle.board?.height ?? 0}:${battle.board?.cellSize ?? 0}:terrain-${battle.board?.terrainRevision ?? 1}:alt-${selectedShip?.altitude ?? 0}`
    });
  }

  prepareArcOverlays(battle, ship) {
    const overlays = [];
    const seenArcs = new Set();
    const sources = ship.unitType === "creature"
      ? (ship.attacks ?? []).filter(attack => Number(attack.cooldown ?? 0) <= 0).map(attack => ({ ...attack, effectiveRange: attack.range }))
      : (ship.weapons ?? []);
    for (const weapon of sources) {
      if (seenArcs.has(weapon.arc)) continue;
      if (ship.unitType !== "creature" && (Number(weapon.reload ?? 0) > 0 || !GunneryEngine.isBatteryFunctional(ship, weapon))) continue;
      const range = ship.unitType === "creature" ? Number(weapon.range ?? 1) : GunneryEngine.getEffectiveRange(weapon);
      const path = this.buildArcSectorPath(battle, ship, weapon.arc, range);
      if (!path) continue;
      seenArcs.add(weapon.arc);
      overlays.push({ arc: weapon.arc, path, focused: battle.phase === "gunnery" && weapon.arc === (this.app.selectedBatteryArc ?? "port"), muted: battle.phase === "gunnery" && weapon.arc !== (this.app.selectedBatteryArc ?? "port") });
    }
    return overlays;
  }

  buildArcSectorPath(battle, ship, arc, range) {
    const maxRange = Math.max(0, Number(range ?? 0));
    if (!maxRange) return "";
    const center = cellToPixel(battle.board, ship.x, ship.y);
    const radius = maxRange * Number(battle.board.cellSize ?? 48) + Number(battle.board.cellSize ?? 48) * 0.6;
    const heading = Number(ship.heading ?? 0);
    let start = heading - 30;
    let end = heading + 30;
    if (arc === "mortar" || arc === "swivel" || arc === "all") return this.describeCircle(center.cx, center.cy, radius);
    if (arc === "stern") {
      start = heading + 150;
      end = heading + 210;
    } else if (arc === "port") {
      start = heading - 150;
      end = heading - 30;
    } else if (arc === "starboard") {
      start = heading + 30;
      end = heading + 150;
    }
    return this.describeSector(center.cx, center.cy, radius, start, end);
  }

  describeCircle(cx, cy, radius) {
    const r = this.round(radius);
    return `M ${this.round(cx)} ${this.round(cy - radius)} A ${r} ${r} 0 1 1 ${this.round(cx)} ${this.round(cy + radius)} A ${r} ${r} 0 1 1 ${this.round(cx)} ${this.round(cy - radius)} Z`;
  }

  describeSector(cx, cy, radius, startAngle, endAngle) {
    const start = normalizeAngle(startAngle);
    const end = normalizeAngle(endAngle);
    const delta = (end - start + 360) % 360;
    const startPoint = this.polarPoint(cx, cy, radius, start);
    const endPoint = this.polarPoint(cx, cy, radius, end);
    const largeArc = delta > 180 ? 1 : 0;
    return [
      `M ${this.round(cx)} ${this.round(cy)}`,
      `L ${this.round(startPoint.x)} ${this.round(startPoint.y)}`,
      `A ${this.round(radius)} ${this.round(radius)} 0 ${largeArc} 1 ${this.round(endPoint.x)} ${this.round(endPoint.y)}`,
      "Z"
    ].join(" ");
  }
  polarPoint(cx, cy, radius, angle) {
    const rad = normalizeAngle(angle) * Math.PI / 180;
    return { x: cx + Math.sin(rad) * radius, y: cy - Math.cos(rad) * radius };
  }
  round(value) {
    return Math.round(Number(value) * 1000) / 1000;
  }
  prepareTargetLine(battle, ship, target) {
    const a = cellToPixel(battle.board, ship.x, ship.y);
    const b = cellToPixel(battle.board, target.x, target.y);
    return { x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy };
  }
}
