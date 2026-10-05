import { GunneryEngine } from "../engine/gunnery-engine.js";

export class RenderContextCache {
  constructor() {
    this.values = new Map();
    this.hits = 0;
    this.misses = 0;
    this.scope = null;
  }

  setScope(scope) {
    const next = String(scope ?? "");
    if (next === this.scope) return;
    this.scope = next;
    this.values.clear();
  }

  clear() {
    this.scope = null;
    this.values.clear();
  }

  memo(key, factory) {
    const scopedKey = `${this.scope ?? "global"}:${key}`;
    if (this.values.has(scopedKey)) {
      this.hits += 1;
      return this.values.get(scopedKey);
    }
    const value = factory();
    this.values.set(scopedKey, value);
    this.misses += 1;
    return value;
  }

  getTargets(battle, attacker, arc, options = {}) {
    const aimedSection = options.aimedSection ?? "auto";
    const key = `targets:${attacker?.id ?? "none"}:${arc}:${aimedSection}`;
    return this.memo(key, () => GunneryEngine.getTargets(battle, attacker, arc, options));
  }

  stats() {
    return { entries: this.values.size, hits: this.hits, misses: this.misses, scope: this.scope };
  }
}
