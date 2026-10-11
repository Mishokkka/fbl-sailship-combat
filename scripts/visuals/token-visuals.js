import { normalizeAngle } from "../board/board-geometry.js";

export const IMAGE_FACING = Object.freeze({ right: 0, up: 90, left: 180, down: 270 });
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** All built-in artwork faces +X. Game headings start at north and turn clockwise. */
export function tokenRotation(heading) { return normalizeAngle(finite(heading, 0) - 90); }

/** Cosmetic dimensions only: never alter occupied hexes, range or collision geometry. */
export function tokenVisual(unit, cellSize = 48) {
  const creature = unit.unitType === "creature";
  const contact = Boolean(unit.contactState);
  const sm = contact ? 6 : finite(unit.stats?.sm, creature ? 6 : 7);
  const cellScale = clamp(finite(cellSize, 48), 16, 160) / 48;
  const sizeScale = clamp(0.72 + (sm - 5) * 0.11, 0.62, 1.27);
  let family = "contact";
  if (!contact && creature) {
    family = ["bird", "ray", "jelly", "swarm", "beast"].includes(unit.token?.silhouette) ? unit.token.silhouette : "beast";
  } else if (!contact) {
    const profile = unit.sailing?.profile;
    family = unit.template === "gunboat" || profile === "bomb" ? "bomb"
      : unit.template === "cutter" || sm <= 5 ? "cutter"
      : profile === "foreAft" || profile === "lateen" ? "schooner"
      : sm >= 8 ? "line" : profile === "square" ? "frigate" : sm <= 5 ? "cutter" : "brig";
  }
  const imageScale = creature && !contact ? clamp(finite(unit.token?.scale, 1), 0.35, 3) : 1;
  const scale = Number((sizeScale * cellScale * imageScale).toFixed(4));
  const radius = Math.max(25 * cellScale, 32 * scale);
  return {
    family, href: "#ssc-art-" + family, scale, cellScale,
    rotation: tokenRotation(unit.heading),
    imageRotation: IMAGE_FACING[unit.token?.imageFacing] ?? 0,
    labelY: -Math.ceil(radius + 8), badgeY: -Math.ceil(radius + 19),
    hpY: Math.ceil(radius + 3), statusY: Math.ceil(radius + 18), status2Y: Math.ceil(radius + 30),
    forwardX: 26 * scale, forwardY: 0
  };
}

/** Convert a point in the same local coordinates as the artwork into board pixels. */
export function tokenLocalPoint(center, heading, x, y, scale = 1) {
  const angle = tokenRotation(heading) * Math.PI / 180;
  return { x: center.cx + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
    y: center.cy + scale * (x * Math.sin(angle) + y * Math.cos(angle)) };
}
