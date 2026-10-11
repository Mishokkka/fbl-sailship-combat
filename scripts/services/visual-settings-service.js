import { MODULE_ID } from "../utils/constants.js";
export class VisualSettingsService {
  static registerSettings() {
    game.settings.register(MODULE_ID, "visualQuality", {
      name: "Визуальные эффекты боя",
      hint: "Только на этом компьютере. Экономный: короткие вспышки без следов ветра. Выключены: мгновенное перемещение и статичные обозначения.",
      scope: "client", config: true, type: String, default: "standard",
      choices: { standard: "Обычные", economy: "Экономные", off: "Выключены" },
      onChange: () => globalThis.dispatchEvent?.(new Event("ssc-visual-settings"))
    });
  }
  static quality() {
    const value = globalThis.game?.settings?.get?.(MODULE_ID, "visualQuality");
    return ["standard","economy","off"].includes(value) ? value : "standard";
  }
  static reducedMotion() { return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); }
  static motion() { return this.quality() !== "off" && !this.reducedMotion(); }
  static wind() { return this.quality() === "standard" && !this.reducedMotion(); }
}
