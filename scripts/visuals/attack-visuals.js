import { cellToPixel } from "../board/board-geometry.js";
import { tokenLocalPoint, tokenVisual } from "./token-visuals.js";
const ARCS = ["bow", "stern", "port", "starboard", "mortar", "swivel", "all"];
const TYPES = ["cannon", "chain", "grape", "fire", "natural", "breath", "spit", "sonic", "magic", "ram", "other"];
const point = value => {
  if (!value || !["x","y","heading"].every(key => Number.isFinite(value[key]))) return null;
  return { x: Math.max(-10000, Math.min(10000, value.x)), y: Math.max(-10000, Math.min(10000, value.y)),
    heading: ((value.heading % 360) + 360) % 360 };
};
export function captureAttackVisual(source, target, { arc = "bow", type = "cannon", ammo } = {}) {
  return normalizeAttackVisual({ source, target, arc,
    type: ({ chainShot: "chain", grapeShot: "grape", heatedShot: "fire" })[ammo] ?? type,
    section: "", timestamp: Date.now() });
}
export function normalizeAttackVisual(value) {
  if (!value || typeof value !== "object") return null;
  const source = point(value.source), target = point(value.target);
  if (!source || !target || !ARCS.includes(value.arc) || !TYPES.includes(value.type) || !Number.isFinite(value.timestamp)) return null;
  return { source, target, arc: value.arc, type: value.type, timestamp: Math.max(0, value.timestamp),
    section: ["bow","midship","stern","head","body","tail","leftWing","rightWing","crystalCore"].includes(value.section) ? value.section : "" };
}
/** Pure geometry from a committed result. No dice, damage, or persistence calls. */
export function attackGeometry(battle, report) {
  const event = normalizeAttackVisual(report?.visual);
  if (!event || !["hit","miss"].includes(report.outcome)) return null;
  const source = battle.ships?.find(unit => unit.id === report.sourceId);
  const target = battle.ships?.find(unit => unit.id === report.targetId);
  if (!source || !target || source.contactState === "lost" || target.contactState === "lost") return null;
  const a = cellToPixel(battle.board, event.source.x, event.source.y);
  const b = cellToPixel(battle.board, event.target.x, event.target.y);
  const sourceScale = tokenVisual(source, battle.board.cellSize).scale;
  const targetScale = tokenVisual(target, battle.board.cellSize).scale;
  const origin = ({ bow: [25,0], stern: [-23,0], port: [0,-13], starboard: [0,13] })[event.arc] ?? [0,0];
  const sectionX = ({ bow: 17, head: 20, stern: -18, tail: -20, crystalCore: -14 })[event.section] ?? 0;
  const start = tokenLocalPoint(a, event.source.heading, ...origin, sourceScale);
  const hit = tokenLocalPoint(b, event.target.heading, sectionX, 0, targetScale);
  let end = hit;
  if (report.outcome === "miss") {
    const dx = b.cx-start.x, dy = b.cy-start.y, length = Math.hypot(dx,dy);
    const course = event.source.heading * Math.PI / 180;
    const nx = length > .001 ? dx / length : Math.sin(course);
    const ny = length > .001 ? dy / length : -Math.cos(course);
    const clearance = Math.max(42 * Number(battle.board.cellSize ?? 48) / 48, 45 * targetScale);
    // The illustrative miss terminates beside the target, with no hit flash.
    end = { x: b.cx - ny * clearance, y: b.cy + nx * clearance };
  }
  return { start, end, hit: report.outcome === "hit", type: event.type, arc: event.arc,
    angle: Math.atan2(end.y-start.y, end.x-start.x) * 180 / Math.PI };
}
