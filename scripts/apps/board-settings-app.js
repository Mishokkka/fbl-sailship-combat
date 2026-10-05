import { BattleNormalizer } from "../normalizers/battle-normalizer.js";
import { WorkbenchController } from "../controllers/workbench-controller.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BoardSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._dirty = false;
    this.workbench = new WorkbenchController(this);
  }

  static DEFAULT_OPTIONS = {
    id: "sailships-board-settings",
    classes: ["sailships-combat", "sailships-board-settings-app"],
    tag: "section",
    window: {
      title: "Настройки поля",
      icon: "fa-solid fa-image",
      resizable: true
    },
    position: { width: 640, height: 700 },
    actions: {
      applyBoardEdits: this._onApply,
      pickBoardBackground: this._onPick,
      clearBoardBackground: this._onClear
    }
  };

  static PARTS = {
    main: { template: "modules/sailships-combat/templates/settings/board-settings-app.hbs" }
  };

  get battle() {
    return game.sailshipsCombat.storage.getBattle();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return foundry.utils.mergeObject(context, { battle: this.battle }, { inplace: false });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.workbench.bind();
  }

  markMainStale() {
    const main = game.sailshipsCombat?.app;
    if (!main) return;
    main.renderBattleSnapshot = null;
    main.contextBuilder?.invalidate?.();
  }

  static async _onPick(event) {
    event.preventDefault();
    const input = this.element?.querySelector?.('[name="background.src"]');
    const FilePickerClass = globalThis.foundry?.applications?.apps?.FilePicker ?? globalThis.FilePicker ?? null;
    if (!FilePickerClass) return ui.notifications.warn("Foundry FilePicker недоступен.");
    const picker = new FilePickerClass({
      type: "image",
      current: String(input?.value ?? this.battle.board?.background?.src ?? ""),
      callback: path => {
        if (input && path) { input.value = String(path); input.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    if (typeof picker.browse === "function") return picker.browse();
    return picker.render(true);
  }

  static async _onClear(event) {
    event.preventDefault();
    const input = this.element?.querySelector?.('[name="background.src"]');
    if (input) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
  }

  /** Commit the submitted battle only, then display its normalized saved values. */
  static async _onApply(event) {
    event.preventDefault();
    const form = this.element?.querySelector?.("form");
    if (!form) return ui.notifications.warn("Форма настроек поля недоступна.");
    const data = new FormData(form);
    const numberOrDefault = (raw, fallback) => {
      const value = Number(raw);
      return raw != null && String(raw).trim() !== "" && Number.isFinite(value) ? value : fallback;
    };
    const submission = this.workbench.capture(form);
    const requested = { background: {
      src: String(data.get("background.src") ?? ""),
      enabled: data.get("background.enabled") === "on",
      opacity: Math.max(0, Math.min(1, numberOrDefault(data.get("background.opacity"), 0.35))),
      tileSize: Math.max(64, Math.min(2048, numberOrDefault(data.get("background.tileSize"), 512)))
    } };
    BattleNormalizer.normalizeBoardBackground(requested);
    let receipt = null;
    const saved = await game.sailshipsCombat.storage.updateBattle(battle => {
      if (submission.id !== `background:${battle.id}`) {
        ui.notifications.warn("Активный бой изменился. Откройте настройки его фона заново.");
        return false;
      }
      receipt = { id: battle.id, revision: Number(battle.revision ?? 0) + 1 };
      battle.board.background = { ...requested.background };
    }, { reason: "board-settings-apply" });
    // A denied write may resolve normally without advancing the stored revision.
    if (!receipt || saved?.id !== receipt.id || Number(saved.revision) !== receipt.revision
      || !Object.entries(requested.background).every(([key, value]) => saved.board?.background?.[key] === value)) return;
    const savedValues = new Map(Object.entries(saved.board.background).map(([key, value]) => [
      "background." + key, key === "enabled" ? Boolean(value) : String(value)
    ]));
    this.workbench.acceptSaved(submission, savedValues);
    this._dirty = true;
    this.markMainStale();
    await this.render({ force: true });
    ui.notifications.info("Настройки поля применены.");
  }

  _onClose(options) {
    this.workbench.destroy();
    if (this._dirty) game.sailshipsCombat?.app?.onExternalBattleUpdate?.();
    if (game.sailshipsCombat?.boardSettingsApp === this) game.sailshipsCombat.boardSettingsApp = null;
    if (super._onClose) super._onClose(options);
  }
}
