import { AIR_ONLY_TERRAIN_TYPES, SEA_ONLY_TERRAIN_TYPES, TERRAIN_LABELS } from "../utils/constants.js";
import { cellKey, cellPath, distanceCells, pixelToCell, withinBoard } from "../board/board-geometry.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { BoardingEngine } from "../engine/boarding-engine.js";
import { TerrainTooltipBuilder } from "../context/terrain-tooltip-builder.js";
import { DialogService } from "../services/dialog-service.js";
import { CombatantRules } from "../rules/combatant-rules.js";

const SEA_ONLY_TERRAIN = new Set(SEA_ONLY_TERRAIN_TYPES);
const AIR_ONLY_TERRAIN = new Set(AIR_ONLY_TERRAIN_TYPES);
const BOARD_MIN_ZOOM = 0.45;
const CAMERA_MIN_VISIBLE_RATIO = 0.35;
const CAMERA_MIN_VISIBLE_PX = 160;

export class BoardInteractionController {
  constructor(app) {
    this.app = app;
    this.panState = null;
    this.suppressClick = false;
    this.terrainPaintState = null;
    this.lastHoverCellKey = null;
    this.boundTerrainPaintMove = this.onTerrainPaintMove.bind(this);
    this.boundTerrainPaintUp = this.onTerrainPaintUp.bind(this);
    this.boundBoardPanMove = this.onBoardPanMove.bind(this);
    this.boundBoardPanUp = this.onBoardPanUp.bind(this);
    this.boundAltKeyDown = this.onAltKeyDown.bind(this);
    this.boundAltKeyUp = this.onAltKeyUp.bind(this);
    this.boundWindowBlur = this.onWindowBlur.bind(this);
    this.lastHoverContext = null;
    this.hoverFrame = null;
    this.pendingHoverEvent = null;
  }

  getBattleSnapshot() {
    return this.app.renderBattleSnapshot ?? this.app.battle;
  }

  get camera() {
    this.app.boardCamera ??= { x: 0, y: 0, zoom: 1 };
    return this.app.boardCamera;
  }

  resetCamera() {
    this.app.boardCamera = { x: 0, y: 0, zoom: 1 };
  }

  getBoardCamera(pixelWidth, pixelHeight) {
    const camera = this.camera;
    camera.zoom = Math.max(BOARD_MIN_ZOOM, Math.min(4, Number(camera.zoom ?? 1)));
    const viewWidth = Math.max(80, pixelWidth / camera.zoom);
    const viewHeight = Math.max(80, pixelHeight / camera.zoom);
    const rangeX = this.getCameraRange(pixelWidth, viewWidth);
    const rangeY = this.getCameraRange(pixelHeight, viewHeight);
    camera.x = Math.max(rangeX.min, Math.min(rangeX.max, Number(camera.x ?? rangeX.min)));
    camera.y = Math.max(rangeY.min, Math.min(rangeY.max, Number(camera.y ?? rangeY.min)));
    camera.viewWidth = viewWidth;
    camera.viewHeight = viewHeight;
    camera.zoomPct = Math.round(camera.zoom * 100);
    this.app.boardCamera = camera;
    return camera;
  }

  getCameraRange(contentSize, viewSize) {
    const safeContentSize = Math.max(1, Number(contentSize ?? 1));
    const safeViewSize = Math.max(1, Number(viewSize ?? 1));
    const minVisible = Math.min(
      safeContentSize,
      Math.max(1, Math.min(CAMERA_MIN_VISIBLE_PX, safeViewSize * CAMERA_MIN_VISIBLE_RATIO))
    );
    return { min: minVisible - safeViewSize, max: safeContentSize - minVisible };
  }

  applyBoardViewBox(svg = this.app.element?.querySelector?.(".ssc-board-svg")) {
    if (!svg) return;
    const pixelWidth = Number(svg.dataset.pixelWidth ?? 0);
    const pixelHeight = Number(svg.dataset.pixelHeight ?? 0);
    if (!pixelWidth || !pixelHeight) return;
    const camera = this.getBoardCamera(pixelWidth, pixelHeight);
    svg.setAttribute("viewBox", `${camera.x} ${camera.y} ${camera.viewWidth} ${camera.viewHeight}`);
    svg.dataset.lod = camera.zoom < 0.75 ? "far" : camera.zoom < 1.15 ? "medium" : "near";
  }

  eventToBoardPoint(svg, event) {
    const rect = svg.getBoundingClientRect();
    const pixelWidth = Number(svg.dataset.pixelWidth ?? 0);
    const pixelHeight = Number(svg.dataset.pixelHeight ?? 0);
    const camera = this.getBoardCamera(pixelWidth, pixelHeight);
    let x;
    let y;

    try {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = svg.getScreenCTM()?.inverse();
      if (matrix) {
        const transformed = point.matrixTransform(matrix);
        x = transformed.x;
        y = transformed.y;
      }
    } catch (err) {
      // Conservative fallback below.
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const nxFallback = rect.width ? (event.clientX - rect.left) / rect.width : 0;
      const nyFallback = rect.height ? (event.clientY - rect.top) / rect.height : 0;
      x = camera.x + nxFallback * camera.viewWidth;
      y = camera.y + nyFallback * camera.viewHeight;
    }

    const nx = camera.viewWidth ? (x - camera.x) / camera.viewWidth : 0;
    const ny = camera.viewHeight ? (y - camera.y) / camera.viewHeight : 0;
    return {
      x,
      y,
      nx: Math.max(0, Math.min(1, nx)),
      ny: Math.max(0, Math.min(1, ny)),
      rect,
      camera
    };
  }

  eventToBoardCell(svg, event, battle = this.getBattleSnapshot()) {
    const point = this.eventToBoardPoint(svg, event);
    const cell = pixelToCell(battle.board, point.x, point.y);
    if (!cell || !withinBoard(battle.board, cell.x, cell.y)) return null;
    return { ...cell, key: cellKey(cell.x, cell.y), point };
  }

  bindEvents() {
    const root = this.app.element;
    if (!root) return;
    this.bindingAbort?.abort();
    this.bindingAbort = new AbortController();
    const listen = (node, type, listener, options = {}) =>
      node.addEventListener(type, listener, { ...options, signal: this.bindingAbort.signal });
    this.lastHoverCellKey = null;
    this.lastHoverContext = null;

    root.querySelectorAll(".ssc-ship-list-item[data-ship-id]").forEach(node => {
      listen(node, "click", event => {
        event.preventDefault();
        event.stopPropagation();
        this.selectShip(event.currentTarget.dataset.shipId);
      });
    });

    root.querySelectorAll(".ssc-target-row[data-target-id]").forEach(node => {
      listen(node, "click", event => {
        event.preventDefault();
        event.stopPropagation();
        this.app.selectedTargetId = event.currentTarget.dataset.targetId;
        this.app.renderBattleState();
      });
    });

    const board = root.querySelector(".ssc-board-svg");
    if (!board) return;

    window.removeEventListener("keydown", this.boundAltKeyDown);
    window.removeEventListener("keyup", this.boundAltKeyUp);
    window.removeEventListener("blur", this.boundWindowBlur);
    window.addEventListener("keydown", this.boundAltKeyDown);
    window.addEventListener("keyup", this.boundAltKeyUp);
    window.addEventListener("blur", this.boundWindowBlur);

    listen(board, "wheel", event => this.onBoardWheel(event), { passive: false });
    listen(board, "mousedown", event => this.onBoardMouseDown(event));
    listen(board, "mousemove", event => this.queueBoardHover(event));
    listen(board, "mouseleave", event => this.onBoardLeave(event));
    listen(board, "click", event => this.onBoardClick(event));
    listen(board, "contextmenu", event => this.onBoardContextMenu(event));

    board.querySelectorAll("[data-ship-id]").forEach(node => {
      listen(node, "click", async event => {
        event.preventDefault();
        event.stopPropagation();
        if (this.suppressClick) return;
        const shipId = event.currentTarget.dataset.shipId;
        const battle = this.getBattleSnapshot();
        const target = battle.ships.find(ship => ship.id === shipId);
        const selected = battle.ships.find(ship => ship.id === this.app.selectedShipId);
        const movementCandidate = target && selected && target.id !== selected.id && battle.phase === "movement"
          ? MovementEngine.findReachableCell(battle, selected, target.x, target.y)
          : null;
        if (movementCandidate) {
          await this.moveSelectedShip(target.x, target.y);
          return;
        }
        this.selectShipOrTarget(shipId);
      });
    });
  }

  onBoardWheel(event) {
    if (!game.user.isGM && !this.app.element) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget;
    const point = this.eventToBoardPoint(svg, event);
    const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
    const nextZoom = Math.max(BOARD_MIN_ZOOM, Math.min(4, Number(this.camera.zoom ?? 1) * factor));
    const pixelWidth = Number(svg.dataset.pixelWidth ?? 0);
    const pixelHeight = Number(svg.dataset.pixelHeight ?? 0);
    const viewWidth = pixelWidth / nextZoom;
    const viewHeight = pixelHeight / nextZoom;
    this.camera.zoom = nextZoom;
    this.camera.x = point.x - point.nx * viewWidth;
    this.camera.y = point.y - point.ny * viewHeight;
    this.applyBoardViewBox(svg);
  }

  onBoardMouseDown(event) {
    const svg = event.currentTarget;
    const battle = this.getBattleSnapshot();
    if (event.button === 0 && this.app.terrainMode && !battle.setupConfirmed) {
      return this.onTerrainBrushMouseDown(event, svg);
    }
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    const pixelWidth = Number(svg.dataset.pixelWidth ?? 0);
    const pixelHeight = Number(svg.dataset.pixelHeight ?? 0);
    const camera = this.getBoardCamera(pixelWidth, pixelHeight);
    const rect = svg.getBoundingClientRect();
    const ctm = svg.getScreenCTM();
    const scaleX = Math.abs(Number(ctm?.a ?? 0)) || (rect.width ? rect.width / Math.max(1, camera.viewWidth) : 1);
    const scaleY = Math.abs(Number(ctm?.d ?? 0)) || (rect.height ? rect.height / Math.max(1, camera.viewHeight) : 1);
    this.panState = {
      svg,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: camera.x,
      startY: camera.y,
      scaleX,
      scaleY,
      moved: false
    };
    svg.classList.add("panning");
    window.addEventListener("mousemove", this.boundBoardPanMove, { passive: false });
    window.addEventListener("mouseup", this.boundBoardPanUp, { passive: false, once: true });
  }

  onBoardPanMove(event) {
    const state = this.panState;
    if (!state) return;
    event.preventDefault();
    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      state.moved = true;
      this.suppressClick = true;
    }
    this.camera.x = state.startX - dx / Math.max(0.001, state.scaleX);
    this.camera.y = state.startY - dy / Math.max(0.001, state.scaleY);
    this.applyBoardViewBox(state.svg);
  }

  onBoardPanUp(event) {
    const state = this.releaseBoardPan();
    window.removeEventListener("mouseup", this.boundBoardPanUp);
    if (!state) return;
    if (state?.moved) window.setTimeout(() => { this.suppressClick = false; }, 0);
  }

  releaseBoardPan() {
    const state = this.panState;
    if (state?.svg) state.svg.classList.remove("panning");
    this.panState = null;
    window.removeEventListener("mousemove", this.boundBoardPanMove);
    return state;
  }

  queueBoardHover(event) {
    this.pendingHoverEvent = {
      currentTarget: event.currentTarget,
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey
    };
    if (this.hoverFrame != null) return;
    const schedule = globalThis.requestAnimationFrame ?? (callback => globalThis.setTimeout(callback, 16));
    this.hoverFrame = schedule(() => {
      this.hoverFrame = null;
      const pending = this.pendingHoverEvent;
      this.pendingHoverEvent = null;
      if (pending) this.onBoardHover(pending);
    });
  }

  onBoardHover(event) {
    if (this.panState || this.terrainPaintState) return;
    const svg = event.currentTarget;
    const battle = this.getBattleSnapshot();
    const cell = this.eventToBoardCell(svg, event, battle);
    const hover = svg.querySelector(".ssc-hover-cell");
    const readout = this.app.element?.querySelector?.(".ssc-board-cursor");

    if (!cell) {
      if (hover) hover.classList.add("hidden");
      if (readout) readout.textContent = "—";
      this.lastHoverCellKey = null;
      this.lastHoverContext = null;
      this.hideTerrainTooltip();
      return;
    }

    const cellChanged = cell.key !== this.lastHoverCellKey;
    if (cellChanged) {
      const ship = battle.ships.find(s => Number(s.x) === cell.x && Number(s.y) === cell.y);
      const selected = battle.ships.find(s => s.id === this.app.selectedShipId);
      const rangeText = selected
        ? ` · от ${selected.name}: ${distanceCells(selected, cell)} кл.`
        : "";
      if (hover) {
        hover.setAttribute("d", cellPath(battle.board, cell.x, cell.y));
        hover.classList.remove("hidden");
      }
      if (readout) readout.textContent = `Клетка ${cell.x + 1}:${cell.y + 1}${ship ? ` · ${ship.name}` : ""}${rangeText}`;
    }
    this.lastHoverCellKey = cell.key;
    this.lastHoverContext = { cell, clientX: event.clientX, clientY: event.clientY };
    if (event.altKey) this.showTerrainTooltip(this.lastHoverContext, battle);
    else this.hideTerrainTooltip();
  }

  onBoardLeave(event) {
    this.pendingHoverEvent = null;
    const hover = event.currentTarget?.querySelector?.(".ssc-hover-cell");
    const readout = this.app.element?.querySelector?.(".ssc-board-cursor");
    if (hover) hover.classList.add("hidden");
    if (readout) readout.textContent = "—";
    this.lastHoverCellKey = null;
    this.lastHoverContext = null;
    this.hideTerrainTooltip();
  }

  onAltKeyDown(event) {
    if (event.key === "Escape" && this.app.movementPlan?.pending
      && this.app.element?.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      void this.app.movementPlan.cancel();
      return;
    }
    if (event.key === "Escape" && this.app.terrainMode) {
      event.preventDefault();
      event.stopPropagation();
      this.cancelTerrainInteraction({ clearMode: true, render: true });
      return;
    }
    if (event.key !== "Alt" || !this.lastHoverContext) return;
    this.showTerrainTooltip(this.lastHoverContext, this.getBattleSnapshot());
  }

  onWindowBlur() {
    if (!this.terrainPaintState) return;
    void this.onTerrainPaintUp({ type: "blur" });
  }

  onBoardContextMenu(event) {
    event.preventDefault();
    if (!this.app.terrainMode) return;
    event.stopPropagation();
    this.cancelTerrainInteraction({ clearMode: true, render: true });
  }

  onAltKeyUp(event) {
    if (event.key === "Alt") this.hideTerrainTooltip();
  }

  showTerrainTooltip(context, battle) {
    const tooltip = this.app.element?.querySelector?.(".ssc-terrain-tooltip");
    if (!tooltip || !context?.cell) return;
    const terrain = MovementEngine.terrainList(MovementEngine.getTerrain(battle, context.cell.x, context.cell.y));
    if (!terrain.length) return this.hideTerrainTooltip();
    const cellKeyValue = context.cell.key ?? cellKey(context.cell.x, context.cell.y);
    const contentKey = `${cellKeyValue}:${TerrainTooltipBuilder.signature(terrain)}`;
    const alreadyVisible = !tooltip.classList.contains("hidden");
    if (alreadyVisible && tooltip.dataset.contentKey === contentKey) return;

    if (tooltip.dataset.contentKey !== contentKey) {
      const fragment = document.createDocumentFragment();
      for (const entry of TerrainTooltipBuilder.build(terrain)) {
        const section = document.createElement("section");
        section.className = `ssc-terrain-tooltip-entry terrain-${entry.type}`;
        const title = document.createElement("h4");
        title.className = "ssc-terrain-tooltip-title";
        title.textContent = entry.name;
        const description = document.createElement("p");
        description.className = "ssc-terrain-tooltip-description";
        description.textContent = entry.description;
        const altitude = document.createElement("p");
        altitude.className = "ssc-terrain-tooltip-altitude";
        altitude.textContent = `Высоты: ${entry.altitudeLabel}`;
        section.append(title, description, altitude);
        fragment.append(section);
      }
      tooltip.replaceChildren(fragment);
      tooltip.dataset.contentKey = contentKey;
    }
    tooltip.classList.remove("hidden");
    const panel = tooltip.parentElement;
    const rect = panel?.getBoundingClientRect?.();
    if (rect) {
      const tooltipWidth = tooltip.offsetWidth || 260;
      const tooltipHeight = tooltip.offsetHeight || 110;
      tooltip.style.left = `${Math.max(8, Math.min(rect.width - tooltipWidth - 8, context.clientX - rect.left + 14))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(rect.height - tooltipHeight - 8, context.clientY - rect.top + 14))}px`;
    }
  }

  hideTerrainTooltip() {
    const tooltip = this.app.element?.querySelector?.(".ssc-terrain-tooltip");
    if (tooltip && !tooltip.classList.contains("hidden")) tooltip.classList.add("hidden");
  }

  async onBoardClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.suppressClick) return;
    if (event.button !== 0) return;
    const battle = this.getBattleSnapshot();
    const cell = this.eventToBoardCell(event.currentTarget, event, battle);
    if (!cell) return;
    if (this.app.terrainMode && !battle.setupConfirmed) {
      await this.paintTerrainCell(battle, cell.x, cell.y, this.app.terrainMode);
      return;
    }
    await this.moveSelectedShip(cell.x, cell.y);
  }

  onTerrainBrushMouseDown(event, svg) {
    const battle = this.getBattleSnapshot();
    if (!this.app.terrainMode || battle.setupConfirmed) return;
    if (!game.user.isGM) return ui.notifications.warn("Поле меняет ГМ.");
    event.preventDefault();
    event.stopPropagation();
    const mode = this.app.terrainMode;
    const preview = document.createElementNS("http://www.w3.org/2000/svg", "g");
    preview.classList.add("ssc-terrain-paint-preview");
    preview.dataset.terrainMode = mode;
    svg.append(preview);
    this.terrainPaintState = { battle, svg, mode, preview, painted: new Set(), changed: false, cells: [] };
    this.suppressClick = true;
    this.paintTerrainAtEvent(event);
    window.addEventListener("mousemove", this.boundTerrainPaintMove, { passive: false });
    window.addEventListener("mouseup", this.boundTerrainPaintUp, { passive: false, once: true });
  }

  paintTerrainAtEvent(event) {
    const state = this.terrainPaintState;
    if (!state?.svg) return;
    const cell = this.eventToBoardCell(state.svg, event, state.battle);
    if (!cell) return;
    if (state.painted.has(cell.key)) return;
    const result = this.paintTerrainLocal(state.battle, cell.x, cell.y, state.mode);
    if (!result.changed) return;
    state.changed = true;
    state.painted.add(result.key);
    state.cells.push({ x: cell.x, y: cell.y });
    const previewCell = document.createElementNS("http://www.w3.org/2000/svg", "path");
    previewCell.setAttribute("d", cellPath(state.battle.board, cell.x, cell.y));
    previewCell.classList.add("ssc-terrain-paint-preview-cell");
    if (state.mode === "clear") previewCell.classList.add("clear-mode");
    else previewCell.classList.add("ssc-terrain-cell", `terrain-${state.mode}`);
    state.preview?.append(previewCell);
  }

  onTerrainPaintMove(event) {
    if (!this.terrainPaintState) return;
    event.preventDefault();
    this.paintTerrainAtEvent(event);
  }

  async onTerrainPaintUp(event) {
    const state = this.releaseTerrainPaint();
    if (!state) return;
    try {
      if (state.changed) {
        const label = TERRAIN_LABELS[state.mode] ?? (state.mode === "clear" ? "очистка" : state.mode);
        await this.app._updateBattleAndRender(battle => {
          let count = 0;
          for (const cell of state.cells ?? []) {
            const result = this.paintTerrainLocal(battle, cell.x, cell.y, state.mode);
            if (result.changed) count += 1;
          }
          if (!count) return false;
          this.touchTerrain(battle);
          this.app._addLog(battle, `Поле: кисть «${label}», изменено клеток: ${count}.`);
        }, { reason: "paint-terrain-brush" });
      }
    } catch (error) {
      console.error("Sailships Combat | terrain brush failed", error);
      ui.notifications.error("Не удалось применить террейн. Подробности записаны в консоль.");
    } finally {
      window.setTimeout(() => { this.suppressClick = false; }, 0);
    }
  }

  releaseTerrainPaint() {
    const state = this.terrainPaintState;
    this.terrainPaintState = null;
    state?.preview?.remove?.();
    window.removeEventListener("mousemove", this.boundTerrainPaintMove);
    window.removeEventListener("mouseup", this.boundTerrainPaintUp);
    return state;
  }

  cancelTerrainInteraction({ clearMode = false, render = false } = {}) {
    this.releaseTerrainPaint();
    this.suppressClick = false;
    if (clearMode) this.app.terrainMode = null;
    if (render) this.app.renderBattleState();
  }

  destroy() {
    this.bindingAbort?.abort();
    this.bindingAbort = null;
    this.releaseBoardPan();
    this.releaseTerrainPaint();
    window.removeEventListener("mouseup", this.boundBoardPanUp);
    window.removeEventListener("mouseup", this.boundTerrainPaintUp);
    window.removeEventListener("keydown", this.boundAltKeyDown);
    window.removeEventListener("keyup", this.boundAltKeyUp);
    window.removeEventListener("blur", this.boundWindowBlur);
    this.hideTerrainTooltip();
    this.lastHoverContext = null;
    this.pendingHoverEvent = null;
    if (this.hoverFrame != null) {
      globalThis.cancelAnimationFrame?.(this.hoverFrame);
      globalThis.clearTimeout?.(this.hoverFrame);
    }
    this.hoverFrame = null;
    this.suppressClick = false;
  }

  touchTerrain(battle) {
    battle.board ??= {};
    battle.board.terrainRevision = Math.max(0, Number(battle.board.terrainRevision ?? 0)) + 1;
  }

  paintTerrainLocal(battle, x, y, mode = this.app.terrainMode) {
    if (!withinBoard(battle.board, x, y)) return { changed: false };
    battle.board.terrain ??= {};
    const key = cellKey(x, y);
    const occupiedShip = battle.ships.find(s => Number(s.x) === x && Number(s.y) === y);
    if (occupiedShip && MovementEngine.isBlockingTerrain(mode, Number(occupiedShip.altitude ?? 0))) return { changed: false, key };

    const previous = MovementEngine.terrainList(battle.board.terrain[key]);
    if (mode === "clear") {
      if (!previous.length) return { changed: false, key };
      delete battle.board.terrain[key];
      return { changed: true, key, previous, terrain: null };
    }

    const next = mode;
    if (!next) return { changed: false, key };
    const battleMode = MovementEngine.getBattleMode(battle);
    if ((battleMode === "air" && SEA_ONLY_TERRAIN.has(next)) || (battleMode === "sea" && AIR_ONLY_TERRAIN.has(next))) return { changed: false, key };
    let combined = MovementEngine.mergeTerrainStack(previous, next);
    if (battleMode === "air") combined = combined.filter(type => !SEA_ONLY_TERRAIN.has(type));
    if (battleMode === "sea") combined = combined.filter(type => !AIR_ONLY_TERRAIN.has(type));
    if (combined.length === previous.length && combined.every((type, index) => type === previous[index])) return { changed: false, key };
    battle.board.terrain[key] = combined;
    return { changed: true, key, previous, terrain: combined };
  }

  selectShip(shipId) {
    const battle = this.getBattleSnapshot();
    const ship = battle.ships.find(s => s.id === shipId);
    if (!ship) return;
    this.app.selectedShipId = ship.id;
    if (this.app.selectedTargetId === ship.id) this.app.selectedTargetId = null;
    if (!this.app.selectedTargetId) this.app.aimSection = null;
    this.app.renderBattleState();
  }

  selectShipOrTarget(shipId) {
    const battle = this.getBattleSnapshot();
    const ship = battle.ships.find(s => s.id === shipId);
    if (!ship) return;

    const selected = battle.ships.find(s => s.id === this.app.selectedShipId);
    const canTarget = selected
      && selected.id !== ship.id
      && selected.side !== ship.side
      && (CombatantRules.supports(selected, "gunnery") || CombatantRules.supports(selected, "naturalAttack"))
      && CombatantRules.supports(ship, "targetable");
    if (canTarget) {
      this.app.selectedTargetId = ship.id;
    } else {
      this.app.selectedShipId = ship.id;
      this.app.selectedTargetId = null;
      this.app.aimSection = null;
    }
    this.app.renderBattleState();
  }

  async moveSelectedShip(x, y) {
    if (!game.user.isGM) return ui.notifications.warn("Движение пока доступно только ГМу.");
    if (this.getBattleSnapshot().setupConfirmed) return this.app.movementPlan.stage(x, y);
    await this.app._updateBattleAndRender(battle => {
      if (this.app.terrainMode && !battle.setupConfirmed) {
        const terrainMode = this.app.terrainMode;
        const result = this.paintTerrainLocal(battle, x, y, terrainMode);
        if (!result.changed) {
          if (result.key) ui.notifications.warn("Клетка не изменилась или занята кораблем.");
          return false;
        }
        this.touchTerrain(battle);
        const label = terrainMode === "clear" ? "помеха удалена" : `добавлено «${TERRAIN_LABELS[terrainMode] ?? terrainMode}»`;
        this.app._addLog(battle, `Поле ${x + 1}:${y + 1}: ${label}.`);
        return;
      }
      if (battle.setupConfirmed && this.app.terrainMode) this.app.terrainMode = null;

      const ship = battle.ships.find(s => s.id === this.app.selectedShipId);
      if (!ship) return false;

      if (this.app.deployMode) return this.placeSelectedShipLocal(battle, ship, x, y) ? undefined : false;

      return false;
    }, { reason: "board-move-ship" });
  }

  executePlannedMove(battle, plan) {
    const { x, y, shipId } = plan;
    const ship = battle.ships.find(unit => unit.id === shipId);
    if (!ship) return false;
    if (!this.app._requireActivePhase(battle, ship, "movement", "Маневр")) return false;
    const moveCost = this.app._getRemainingAP(battle, ship, "movement") > 0 ? 1 : 0;
    if (!this.app._markTurnAction(battle, ship, "move", moveCost)) {
      ui.notifications.warn(`${ship.name} уже маневрировал в этой фазе или исчерпал ОД.`);
      return false;
    }

    const move = MovementEngine.getMoveResult(battle, ship.id, x, y);
    if (!move.ok) {
      this.app._refundTurnAction(battle, ship, "move", moveCost);
      const terrain = MovementEngine.getTerrain(battle, x, y);
      const blocked = MovementEngine.isBlockingTerrain(terrain, Number(ship.altitude ?? 0));
      ui.notifications.warn(blocked
        ? "Клетка заблокирована террейном на текущей высоте корабля."
        : "Клетка не входит в доступный путь: проверьте ход, курс и занятые клетки. Дым сам по себе движение не блокирует.");
      return false;
    }

    const startHeading = Number(ship.heading ?? 0);
    const execution = MovementEngine.applyMoveResult(battle, move);
    if (!execution.ok) {
      this.app._refundTurnAction(battle, ship, "move", moveCost);
      return false;
    }
    const inertiaResult = execution.inertia;
    const terrainText = execution.terrain.text;
    if (Number(move.candidate.heading ?? startHeading) !== startHeading || Number(move.candidate.steps ?? 0) >= 4) {
      ship.flags ??= {};
      ship.flags.sharpManeuver = true;
    }
    const inIrons = MovementEngine.syncSailingState(battle, ship);
    const windText = inIrons ? " Корабль встал носом против ветра: ход падает до 0." : "";
    const inertiaText = inertiaResult.brakingCost > 0
      ? ` Инерция погашена: ход ${inertiaResult.before} → ${inertiaResult.after}.`
      : ` Ход сохранён: ${ship.speed}.`;

    this.app._addLog(battle, `${ship.name}: маневрирует в клетку ${ship.x + 1}:${ship.y + 1}, курс ${ship.heading}°.${inertiaText}${terrainText}${windText}`);
    if (execution.collision.applied) this.app._addLog(battle, `Столкновение: ${execution.collision.text}`);
    this.app._completeShipActivation(battle, ship, "movement");
    const next = this.app._getActiveShip(battle);
    if (next) {
      this.app._addLog(battle, `Ход боевой единицы: ${next.name}.`);
    } else {
      this.app._addLog(battle, `Все боевые единицы завершили фазу. Можно перейти дальше.`);
    }
    return true;
  }

  isInsideSideDeploymentZone(battle, ship, x, y) {
    const zone = battle.setup?.sides?.[ship?.side]?.zone ?? null;
    if (!zone) return true;
    return x >= Number(zone.x1 ?? 0)
      && x <= Number(zone.x2 ?? 0)
      && y >= Number(zone.y1 ?? 0)
      && y <= Number(zone.y2 ?? 0);
  }
  async placeSelectedShip(battle, ship, x, y) {
    const shipId = ship?.id ?? this.app.selectedShipId;
    await this.app._updateBattleAndRender(nextBattle => {
      const nextShip = nextBattle.ships.find(candidate => candidate.id === shipId);
      if (!nextShip) return false;
      return this.placeSelectedShipLocal(nextBattle, nextShip, x, y) ? undefined : false;
    }, { reason: "place-ship" });
  }

  placeSelectedShipLocal(battle, ship, x, y) {
    if (!withinBoard(battle.board, x, y)) return;
    if (!this.isInsideSideDeploymentZone(battle, ship, x, y)) return ui.notifications.warn("Корабль можно расставлять только внутри зоны своей стороны.");
    const occupied = battle.ships.some(s => s.id !== ship.id && Number(s.x) === x && Number(s.y) === y);
    if (occupied) return ui.notifications.warn("Клетка занята другим кораблем.");
    const mode = MovementEngine.getBattleMode(battle);
    const placementAltitude = mode === "sea"
      ? 0
      : mode === "air"
        ? Math.max(3, Number(ship.altitude ?? 3))
        : Number(ship.altitude ?? 0);
    const terrain = MovementEngine.getTerrain(battle, x, y);
    if (MovementEngine.isBlockingTerrain(terrain, placementAltitude)) return ui.notifications.warn("Клетка заблокирована непроходимым террейном на текущей высоте корабля.");
    ship.x = x;
    ship.y = y;
    ship.altitude = placementAltitude;
    this.app._addLog(battle, `${ship.name}: переставлен в клетку ${x + 1}:${y + 1}.`);
    return true;
  }

  async paintTerrainCell(battle, x, y, mode = this.app.terrainMode) {
    if (!mode) return;
    await this.app._updateBattleAndRender(nextBattle => {
      if (!withinBoard(nextBattle.board, x, y)) return false;
      if (nextBattle.setupConfirmed) {
        ui.notifications.warn("Террейн редактируется только до подтверждения боя.");
        return false;
      }
      const result = this.paintTerrainLocal(nextBattle, x, y, mode);
      if (!result.changed) {
        if (result.key) ui.notifications.warn("Клетка не изменилась или занята кораблем.");
        return false;
      }
      this.touchTerrain(nextBattle);
      const label = mode === "clear" ? "помеха удалена" : `добавлено «${TERRAIN_LABELS[mode] ?? mode}»`;
      this.app._addLog(nextBattle, `Поле ${x + 1}:${y + 1}: ${label}.`);
    }, { reason: "paint-terrain-cell" });
  }
}
