const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BoardSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._dirty = false;
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
    position: { width: 560, height: 520 },
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
        if (input && path) input.value = String(path);
      }
    });
    if (typeof picker.browse === "function") return picker.browse();
    return picker.render(true);
  }

  static async _onClear(event) {
    event.preventDefault();
    const input = this.element?.querySelector?.('[name="background.src"]');
    if (input) input.value = "";
  }

  static async _onApply(event) {
    event.preventDefault();
    const form = this.element?.querySelector?.("form");
    if (!form) return ui.notifications.warn("Форма настроек поля недоступна.");
    const data = new FormData(form);
    await game.sailshipsCombat.storage.updateBattle(battle => {
      battle.board.background ??= {};
      battle.board.background.src = String(data.get("background.src") ?? "");
      battle.board.background.enabled = data.get("background.enabled") === "on";
      battle.board.background.opacity = Math.max(0, Math.min(1, Number(data.get("background.opacity") ?? 0.35)));
      battle.board.background.tileSize = Math.max(64, Math.min(2048, Number(data.get("background.tileSize") ?? 512)));
    });
    this._dirty = true;
    this.markMainStale();
    ui.notifications.info("Настройки поля применены.");
  }

  _onClose(options) {
    if (this._dirty) game.sailshipsCombat?.app?.onExternalBattleUpdate?.();
    if (game.sailshipsCombat?.boardSettingsApp === this) game.sailshipsCombat.boardSettingsApp = null;
    if (super._onClose) super._onClose(options);
  }
}
