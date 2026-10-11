import { attackGeometry } from "../visuals/attack-visuals.js";
import { VisualSettingsService } from "../services/visual-settings-service.js";

const SVG = "http://www.w3.org/2000/svg";
/** At most one salvo, <= 10 SVG nodes, one RAF, lifetime <= 850ms. */
export class BattleEffectsController {
  constructor(app) { this.app = app; this.seen = new Set(); this.initialized = false; this.frame = null; this.group = null; }
  consume(battle, visible = true) {
    const report = battle?.lastReport;
    const fresh = this.initialized;
    this.initialized = true;
    if (!report?.id || this.seen.has(report.id)) {
      if (this.group && !this.group.isConnected) this.cancel();
      return;
    }
    this.seen.add(report.id);
    if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value);
    this.cancel();
    if (!fresh || !visible || !VisualSettingsService.motion() || !report.visual ||
      Math.abs(Date.now() - report.visual.timestamp) > 10000) return;
    const geometry = attackGeometry(battle, report);
    const svg = this.app.element?.querySelector?.(".ssc-board-svg");
    if (!geometry || !svg) return;
    const bounds = svg.viewBox?.baseVal;
    const outside = p => bounds && (p.x < bounds.x || p.y < bounds.y || p.x > bounds.x+bounds.width || p.y > bounds.y+bounds.height);
    if (outside(geometry.start) && outside(geometry.end)) return;
    this.play(svg, geometry);
  }
  play(svg, geometry) {
    this.cancel();
    const group = document.createElementNS(SVG, "g");
    group.setAttribute("class", "ssc-attack-effect type-" + geometry.type);
    group.setAttribute("aria-hidden", "true");
    group.dataset.outcome = geometry.hit ? "hit" : "miss";
    group.dataset.arc = geometry.arc;
    svg.append(group); this.group = group;
    const node = (tag, attributes) => {
      const element = document.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
      group.append(element); return element;
    };
    const flash = node("path", { class: "ssc-shot-flash", d: "M-5 0 L1 -5 L9 0 L1 5 Z",
      transform: "translate("+geometry.start.x+" "+geometry.start.y+") rotate("+geometry.angle+")" });
    const economy = VisualSettingsService.quality() === "economy";
    const count = economy ? 0 : geometry.type === "grape" ? 5 : 3;
    const shots = Array.from({ length: count }, (_, i) => node("path", {
      class: "ssc-shot-tracer", d: ({ natural: "M-5 -5 L4 4 M-2 -6 L7 3", ram: "M-5 -5 L4 0 L-5 5", sonic: "M-3 -6 Q3 0 -3 6", magic: "M-4 0 H4 M0 -4 V4", breath: "M-8 -3 L1 0 L-8 3" })[geometry.type] ?? "M-8 0 H0",
      "data-particle": i
    }));
    const impact = node("path", { class: geometry.hit ? "ssc-shot-impact" : "ssc-shot-miss",
      d: geometry.hit ? "M-9 0 H9 M0 -9 V9 M-6 -6 L6 6 M-6 6 L6 -6" : "M-6 -2 Q0 2 6 -2",
      transform: "translate("+geometry.end.x+" "+geometry.end.y+")" });
    const smoke = economy ? null : node("circle", { class: "ssc-shot-smoke", r: 7,
      cx: geometry.start.x, cy: geometry.start.y });
    const started = performance.now(), duration = economy ? 380 : 850;
    const tick = now => {
      if (!group.isConnected || !VisualSettingsService.motion() || document.hidden) { this.cancel(); return; }
      const p = Math.min(1, (now-started)/duration);
      flash.setAttribute("opacity", String(Math.max(0, 1-p*5)));
      shots.forEach((shot, i) => {
        const travel = Math.max(0, Math.min(1, (p-i*.045)/.52));
        const side = (i-(count-1)/2) * (geometry.type === "grape" ? 2.5 : 1.8) * Math.sin(travel*Math.PI);
        const rad = geometry.angle*Math.PI/180;
        const x = geometry.start.x+(geometry.end.x-geometry.start.x)*travel-Math.sin(rad)*side;
        const y = geometry.start.y+(geometry.end.y-geometry.start.y)*travel+Math.cos(rad)*side;
        shot.setAttribute("transform", "translate("+x+" "+y+") rotate("+geometry.angle+")");
        shot.setAttribute("opacity", travel >= 1 ? "0" : "1");
      });
      const arrival = economy ? .2 : .62;
      impact.setAttribute("opacity", p < arrival ? "0" : String(Math.max(0, (1-p)/(1-arrival))));
      if (smoke) smoke.setAttribute("opacity", String(Math.max(0, (1-p)*.3)));
      if (p < 1) this.frame = requestAnimationFrame(tick); else this.cancel();
    };
    impact.setAttribute("opacity", "0");
    for (const shot of shots) shot.setAttribute("opacity", "0");
    this.frame = requestAnimationFrame(tick);
  }
  cancel() {
    if (this.frame != null) globalThis.cancelAnimationFrame?.(this.frame);
    this.frame = null; this.group?.remove(); this.group = null;
  }
  destroy() { this.cancel(); this.seen.clear(); this.initialized = false; }
}
