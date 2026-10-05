import { WorkbenchController } from "../controllers/workbench-controller.js";
import { SoundService, SOUND_EVENT_TYPES } from "../services/sound-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const EVENT_META = Object.freeze({
  movement: { label: "Движение корабля", icon: "fa-solid fa-route" },
  collision: { label: "Столкновение", icon: "fa-solid fa-burst" },
  gunfire: { label: "Орудийный залп", icon: "fa-solid fa-explosion" },
  creatureAttack: { label: "Атака существа", icon: "fa-solid fa-dragon" },
  phase: { label: "Смена фазы", icon: "fa-solid fa-forward-step" }
});

export class SoundSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) { super(options); this.workbench = new WorkbenchController(this); }
  _onRender(context, options) { super._onRender(context, options); this.workbench.bind(); }

  static DEFAULT_OPTIONS = {
    id: "sailships-combat-sound-settings",
    classes: ["sailships-combat", "sailships-sound-settings-app"],
    tag: "section",
    window: {
      title: "Звуки Sailships Combat",
      icon: "fa-solid fa-volume-high",
      resizable: true
    },
    position: { width: 720, height: 620 },
    actions: {
      saveSoundSettings: this._onSaveSoundSettings,
      resetSoundSettings: this._onResetSoundSettings,
      browseSound: this._onBrowseSound,
      previewSound: this._onPreviewSound
    }
  };

  static PARTS = {
    main: { template: "modules/sailships-combat/templates/settings/sound-settings-app.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const profile = SoundService.getProfile();
    return foundry.utils.mergeObject(context, {
      profile,
      volumePercent: Math.round(profile.volume * 100),
      events: SOUND_EVENT_TYPES.map(type => ({
        type,
        ...EVENT_META[type],
        path: profile.events[type].path,
        volume: profile.events[type].volume,
        volumePercent: Math.round(profile.events[type].volume * 100)
      }))
    }, { inplace: false });
  }

  readProfile() {
    const root = this.element;
    const events = {};
    for (const type of SOUND_EVENT_TYPES) {
      events[type] = {
        path: root?.querySelector?.(`[data-sound-path="${type}"]`)?.value ?? "",
        volume: Number(root?.querySelector?.(`[data-sound-volume="${type}"]`)?.value ?? 1)
      };
    }
    return SoundService.normalize({
      enabled: Boolean(root?.querySelector?.('[data-sound-field="enabled"]')?.checked),
      volume: Number(root?.querySelector?.('[data-sound-field="volume"]')?.value ?? 0.65),
      events
    });
  }

  async saveSettings() {
    await SoundService.saveProfile(this.readProfile());
    this.workbench.accept();
    ui.notifications.info("Настройки звука сохранены для этого клиента.");
    this.render({ force: true });
  }

  async resetSettings() {
    await SoundService.resetProfile();
    this.workbench.accept();
    ui.notifications.info("Настройки звука сброшены: используются встроенные процедурные эффекты.");
    this.render({ force: true });
  }

  async browseSound(type) {
    if (!SOUND_EVENT_TYPES.includes(type)) return;
    const input = this.element?.querySelector?.(`[data-sound-path="${type}"]`);
    const FilePickerClass = globalThis.foundry?.applications?.apps?.FilePicker ?? globalThis.FilePicker ?? null;
    if (!FilePickerClass) return ui.notifications.warn("Foundry FilePicker недоступен.");
    const picker = new FilePickerClass({
      type: "audio",
      current: String(input?.value ?? ""),
      callback: path => {
        if (!input || !path) return;
        input.value = String(path);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    if (typeof picker.browse === "function") await picker.browse();
    else picker.render(true);
  }

  async preview(type) {
    await SoundService.play(type, { preview: true, profile: this.readProfile() });
  }

  static async _onSaveSoundSettings(event) {
    event.preventDefault();
    return this.saveSettings();
  }

  static async _onResetSoundSettings(event) {
    event.preventDefault();
    return this.resetSettings();
  }

  static async _onBrowseSound(event, target) {
    event.preventDefault();
    return this.browseSound((target ?? event.currentTarget)?.dataset?.soundType);
  }

  static async _onPreviewSound(event, target) {
    event.preventDefault();
    return this.preview((target ?? event.currentTarget)?.dataset?.soundType);
  }

  _onClose(options) {
    this.workbench.destroy();
    if (game.sailshipsCombat?.soundSettingsApp === this) game.sailshipsCombat.soundSettingsApp = null;
    if (super._onClose) super._onClose(options);
  }
}
