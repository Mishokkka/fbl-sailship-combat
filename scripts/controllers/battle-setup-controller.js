import { cellKey, withinBoard } from "../board/board-geometry.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { BOARD_LIMITS, TERRAIN_TYPES } from "../utils/constants.js";
import { DialogService } from "../services/dialog-service.js";
import { VictoryEngine } from "../engine/victory-engine.js";
import { CombatantRules } from "../rules/combatant-rules.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

export class BattleSetupController {
  constructor(app) {
    this.app = app;
  }

  async confirmSetup(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("Подтверждение боя доступно только ГМу.");
    this.app.deployMode = false;
    this.app.terrainMode = null;
    this.app.selectedTargetId = null;
    this.app.aimSection = null;
    await this.app._updateBattleAndRender(battle => {
      if (!(battle.ships ?? []).some(unit => CombatantRules.isActive(unit))) {
        ui.notifications.warn("Нельзя начать бой без хотя бы одной активной боевой единицы с подключёнными правилами.");
        return false;
      }
      battle.setupConfirmed = true;
      battle.phase = "orders";
      battle.round = Math.max(1, Number(battle.round ?? 1));
      VictoryEngine.captureInitialStrength(battle);
      this.app._startPhase(battle, "orders");
      const active = this.app._getActiveShip(battle);
      if (active) this.app.selectedShipId = active.id;
      this.app._addLog(battle, "Подготовка подтверждена. Инструменты редактора скрыты, бой открыт с фазы приказов.");
      if (active) this.app._addLog(battle, `Ход корабля: ${active.name}.`);
    }, { reason: "confirm-setup" });
  }

  async returnToSetup(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("К подготовке возвращает только ГМ.");
    const confirmed = await DialogService.confirm({
      title: "Возврат к подготовке",
      content: "Редакторы снова откроются, текущая фаза будет сброшена на приказы.",
      yesLabel: "К подготовке"
    });
    if (!confirmed) return;
    this.app.deployMode = false;
    this.app.terrainMode = null;
    this.app.selectedTargetId = null;
    this.app.aimSection = null;
    await this.app._updateBattleAndRender(battle => {
      battle.setupConfirmed = false;
      battle.phase = "orders";
      delete battle.outcome;
      if (battle.setup?.victory) {
        battle.setup.victory.initialStrength = {};
        battle.setup.victory.initialShipCount = {};
      }
      this.app._clearRoundShipActions(battle);
      battle.turn.activeShipId = battle.ships.find(s => CombatantRules.isActive(s))?.id ?? null;
      this.app._addLog(battle, "Бой возвращен в режим подготовки.");
    }, { reason: "return-to-setup" });
  }

  async toggleDeployMode(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("Расстановка доступна только ГМу.");
    if (this.app.battle.setupConfirmed) return ui.notifications.warn("Расстановка доступна только до подтверждения боя.");
    this.app.deployMode = !this.app.deployMode;
    if (this.app.deployMode) this.app.terrainMode = null;
    this.app.renderBattleState();
  }

  setTerrainMode(mode) {
    if (!game.user.isGM) return ui.notifications.warn("Поле меняет ГМ.");
    const battle = this.app.battle;
    if (battle.setupConfirmed) return ui.notifications.warn("Террейн редактируется только до подтверждения боя.");
    const next = String(mode ?? "");
    if (next !== "clear" && !TERRAIN_TYPES.includes(next)) return ui.notifications.warn("Неизвестный тип террейна.");
    this.app.board?.cancelTerrainInteraction?.({ clearMode: false, render: false });
    this.app.deployMode = false;
    this.app.terrainMode = this.app.terrainMode === next ? null : next;
    if (this.app.terrainMode) this.app.layout?.showPane?.("board");
    this.app.renderBattleState();
  }

  cancelTerrainMode(event) {
    event?.preventDefault?.();
    this.app.board?.cancelTerrainInteraction?.({ clearMode: true, render: true });
  }

  async clearAllTerrain(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("Поле меняет ГМ.");
    this.app.terrainMode = null;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Террейн редактируется только до подтверждения боя.");
        return false;
      }
      battle.board.terrain = {};
      battle.board.terrainRevision = Math.max(0, Number(battle.board.terrainRevision ?? 0)) + 1;
      this.app._addLog(battle, "Все помехи на поле очищены.");
    }, { reason: "clear-terrain" });
  }

  async applyBoardEdits(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("Размер поля меняет ГМ.");
    const root = this.app.element;
    const read = name => Number(root.querySelector(`[data-board-edit="${name}"]`)?.value ?? NaN);
    const background = this.readBoardBackgroundForm();
    this.app.board.resetCamera();
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Размер поля меняется только до подтверждения боя.");
        return false;
      }
      const width = Math.max(BOARD_LIMITS.minWidth, Math.min(BOARD_LIMITS.maxWidth, Math.round(read("width") || battle.board.width || BOARD_LIMITS.defaultWidth)));
      const height = Math.max(BOARD_LIMITS.minHeight, Math.min(BOARD_LIMITS.maxHeight, Math.round(read("height") || battle.board.height || BOARD_LIMITS.defaultHeight)));
      const cellSize = Math.max(BOARD_LIMITS.minCellSize, Math.min(BOARD_LIMITS.maxCellSize, Math.round(read("cellSize") || battle.board.cellSize || BOARD_LIMITS.defaultCellSize)));
      battle.board.width = width;
      battle.board.height = height;
      battle.board.cellSize = cellSize;
      battle.board.background = background;
      this.trimBoardToSize(battle);
      battle.board.terrainRevision = Math.max(0, Number(battle.board.terrainRevision ?? 0)) + 1;
      const backgroundText = background.enabled ? ` Фон: ${background.tileSize}px, opacity ${background.opacity}.` : " Фон отключен.";
      this.app._addLog(battle, `Размер поля изменен: ${width}×${height}, клетка ${cellSize}px.${backgroundText}`);
    }, { reason: "apply-board-edits" });
  }

  readBoardBackgroundForm() {
    const root = this.app.element;
    const input = name => root?.querySelector?.(`[data-board-background-edit="${name}"]`);
    const current = this.app.battle?.board?.background ?? {};
    const src = String(input("src")?.value ?? current.src ?? "").trim();
    const opacity = clamp(Number(input("opacity")?.value ?? current.opacity ?? 0.35), 0, 1);
    const tileSize = Math.round(clamp(Number(input("tileSize")?.value ?? current.tileSize ?? 512), 64, 2048));
    const enabled = Boolean(input("enabled")?.checked) && src.length > 0;
    return { enabled, src: src.slice(0, 512), opacity, tileSize };
  }

  async pickBoardBackground(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("Фон поля меняет ГМ.");
    if (this.app.battle.setupConfirmed) return ui.notifications.warn("Фон поля меняется только до подтверждения боя.");
    const FilePickerClass = globalThis.FilePicker ?? globalThis.foundry?.applications?.apps?.FilePicker ?? null;
    if (!FilePickerClass) return ui.notifications.warn("Foundry FilePicker недоступен в этом окружении.");
    const draft = this.readBoardBackgroundForm();
    const picker = new FilePickerClass({
      type: "image",
      current: draft.src,
      callback: async path => {
        if (!path) return;
        await this.updateBoardBackground({ ...draft, src: String(path), enabled: true }, "Фоновая текстура поля выбрана.", "pick-board-background");
      }
    });
    picker.render(true);
  }

  async clearBoardBackground(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("Фон поля меняет ГМ.");
    const current = this.readBoardBackgroundForm();
    await this.updateBoardBackground({ ...current, enabled: false, src: "" }, "Фоновая текстура поля очищена.", "clear-board-background");
  }

  async updateBoardBackground(background, logText, reason) {
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Фон поля меняется только до подтверждения боя.");
        return false;
      }
      battle.board.background = {
        enabled: Boolean(background.enabled) && String(background.src ?? "").trim().length > 0,
        src: String(background.src ?? "").trim().slice(0, 512),
        opacity: clamp(Number(background.opacity ?? 0.35), 0, 1),
        tileSize: Math.round(clamp(Number(background.tileSize ?? 512), 64, 2048))
      };
      this.app._addLog(battle, logText);
    }, { reason });
  }

  async cycleBoardSize(event) {
    event?.preventDefault?.();
    if (!game.user.isGM) return ui.notifications.warn("Размер поля меняет ГМ.");
    const sizes = [40, 48, 56, 64];
    this.app.board.resetCamera();
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) {
        ui.notifications.warn("Размер поля меняется только до подтверждения боя.");
        return false;
      }
      const current = Number(battle.board.cellSize ?? 48);
      const index = sizes.indexOf(current);
      battle.board.cellSize = sizes[(index + 1 + sizes.length) % sizes.length];
      battle.board.terrainRevision = Math.max(0, Number(battle.board.terrainRevision ?? 0)) + 1;
      this.app._addLog(battle, `Масштаб поля: ${battle.board.cellSize}px.`);
    }, { reason: "cycle-board-size" });
  }

  trimBoardToSize(battle) {
    battle.board.terrain ??= {};
    for (const key of Object.keys(battle.board.terrain)) {
      const [xRaw, yRaw] = String(key).split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !withinBoard(battle.board, x, y)) delete battle.board.terrain[key];
    }
    for (const ship of battle.ships ?? []) {
      ship.x = Math.max(0, Math.min(battle.board.width - 1, Number(ship.x ?? 0)));
      ship.y = Math.max(0, Math.min(battle.board.height - 1, Number(ship.y ?? 0)));
      if (MovementEngine.isBlockingTerrain(MovementEngine.getTerrain(battle, ship.x, ship.y), Number(ship.altitude ?? 0))) {
        delete battle.board.terrain[cellKey(ship.x, ship.y)];
      }
    }
  }
}
