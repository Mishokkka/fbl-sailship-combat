import { MODULE_ID, SETTING_SOUND_PROFILE } from "../utils/constants.js";

export const SOUND_EVENT_TYPES = Object.freeze(["movement", "collision", "gunfire", "creatureAttack", "phase"]);

const DEFAULT_PROFILE = Object.freeze({
  enabled: true,
  volume: 0.65,
  events: Object.freeze({
    movement: Object.freeze({ path: "", volume: 0.7 }),
    collision: Object.freeze({ path: "", volume: 1 }),
    gunfire: Object.freeze({ path: "", volume: 1 }),
    creatureAttack: Object.freeze({ path: "", volume: 0.9 }),
    phase: Object.freeze({ path: "", volume: 0.55 })
  })
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value ?? 0)));
}

export class SoundService {
  static registerSettings() {
    game.settings.register(MODULE_ID, SETTING_SOUND_PROFILE, {
      name: "Sailships Combat Sound Profile",
      hint: "Client-local sound files and volume for Sailships Combat.",
      scope: "client",
      config: false,
      type: Object,
      default: this.defaults()
    });
  }

  static defaults() {
    return structuredClone(DEFAULT_PROFILE);
  }

  static normalize(profile) {
    const source = profile && typeof profile === "object" ? profile : {};
    const events = {};
    for (const type of SOUND_EVENT_TYPES) {
      const event = source.events?.[type] ?? {};
      events[type] = {
        path: String(event.path ?? "").trim().slice(0, 512),
        volume: clamp(event.volume ?? DEFAULT_PROFILE.events[type].volume, 0, 1)
      };
    }
    return {
      enabled: source.enabled == null ? true : Boolean(source.enabled),
      volume: clamp(source.volume ?? DEFAULT_PROFILE.volume, 0, 1),
      events
    };
  }

  static getProfile() {
    return this.normalize(game.settings.get(MODULE_ID, SETTING_SOUND_PROFILE));
  }

  static async saveProfile(profile) {
    const normalized = this.normalize(profile);
    await game.settings.set(MODULE_ID, SETTING_SOUND_PROFILE, normalized);
    return normalized;
  }

  static async resetProfile() {
    return this.saveProfile(this.defaults());
  }

  static async play(type, { preview = false, profile: profileOverride = null } = {}) {
    if (!SOUND_EVENT_TYPES.includes(type)) return false;
    const profile = profileOverride ? this.normalize(profileOverride) : this.getProfile();
    if (!profile.enabled && !preview) return false;
    const event = profile.events[type];
    const volume = clamp(profile.volume * event.volume, 0, 1);
    if (volume <= 0) return false;
    if (event.path) return this.playFile(event.path, volume, { notify: preview });
    return this.playProcedural(type, volume);
  }

  static async playFile(src, volume, { notify = false } = {}) {
    const AudioHelper = globalThis.foundry?.audio?.AudioHelper ?? globalThis.AudioHelper ?? null;
    if (!AudioHelper?.play) {
      if (notify) ui.notifications.warn("Foundry AudioHelper недоступен.");
      return false;
    }
    try {
      await AudioHelper.play({ src, volume, autoplay: true, loop: false });
      return true;
    } catch (error) {
      console.warn("sailships-combat | Failed to play custom sound", error);
      if (notify) ui.notifications.warn(`Не удалось воспроизвести звук: ${src}`);
      return false;
    }
  }

  static async playProcedural(type, volume) {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
    if (!AudioContextClass) return false;
    try {
      this.audioContext ??= new AudioContextClass();
      const context = this.audioContext;
      if (context.state === "suspended") await context.resume?.();
      if (context.state === "closed") return false;
      const now = context.currentTime;
      const plan = {
        movement: { wave: "triangle", start: 105, end: 58, duration: 0.34, gain: 0.16 },
        collision: { wave: "sawtooth", start: 95, end: 28, duration: 0.52, gain: 0.34 },
        gunfire: { wave: "square", start: 78, end: 34, duration: 0.42, gain: 0.38 },
        creatureAttack: { wave: "sawtooth", start: 165, end: 62, duration: 0.48, gain: 0.26 },
        phase: { wave: "sine", start: 440, end: 660, duration: 0.22, gain: 0.16 }
      }[type];
      if (!plan) return false;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = plan.wave;
      oscillator.frequency.setValueAtTime(plan.start, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, plan.end), now + plan.duration);
      gain.gain.setValueAtTime(Math.max(0.0001, volume * plan.gain), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + plan.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + plan.duration);
      return true;
    } catch (error) {
      console.debug("sailships-combat | Procedural sound unavailable", error);
      return false;
    }
  }
}
