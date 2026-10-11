import test from "node:test";
import assert from "node:assert/strict";
import "./test-env.js";
import { cellToPixel, headingToVector, normalizeAngle } from "../scripts/board/board-geometry.js";
import { tokenVisual, tokenLocalPoint, IMAGE_FACING } from "../scripts/visuals/token-visuals.js";
import { CreatureAttackEngine } from "../scripts/engine/creature-attack-engine.js";
import { CreatureNormalizer } from "../scripts/normalizers/creature-normalizer.js";

const headings = [0, 60, 120, 180, 240, 300];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + " != " + b);
test("Artwork noses follow the actual next hex at every heading, in even and odd columns", () => {
  for (const x of [4, 5]) for (const heading of headings) {
    const board = { cellSize: 48 }, center = cellToPixel(board, x, 5);
    const delta = headingToVector(heading, x, 5);
    const next = cellToPixel(board, x + delta.dx, 5 + delta.dy);
    const nose = tokenLocalPoint(center, heading, 48, 0);
    near(nose.x, next.cx); near(nose.y, next.cy);
    for (const [arc, localY] of [["port", -12], ["starboard", 12]]) {
      const point = tokenLocalPoint(center, heading, 0, localY);
      const bearing = normalizeAngle(Math.atan2(point.x - center.cx, -(point.y - center.cy)) * 180 / Math.PI);
      for (const direction of CreatureAttackEngine.getArcDirections({ heading }, arc)) {
        const difference = Math.abs(((direction - bearing + 540) % 360) - 180);
        near(difference, 30);
      }
    }
  }
});
test("Custom image orientation corrects all four source directions at every course", () => {
  const sourceAngles = { right: 0, up: -90, left: 180, down: 90 };
  for (const heading of headings) for (const imageFacing of Object.keys(IMAGE_FACING)) {
    const unit = CreatureNormalizer.normalize({ heading, token: { imageFacing } });
    assert.equal(unit.token.imageFacing, imageFacing);
    const visual = tokenVisual(unit);
    assert.equal(normalizeAngle(sourceAngles[imageFacing] + visual.imageRotation + visual.rotation), normalizeAngle(heading - 90));
  }
  assert.equal(CreatureNormalizer.normalize({ token: { imageFacing: "invalid" } }).token.imageFacing, "right");
  assert.equal(CreatureNormalizer.normalize({ token: { img: "old.webp" } }).token.imageFacing, "right");
});
test("Families and size are cosmetic and hidden contacts reveal neither class nor size", () => {
  const cases = [
    ["cutter", 5, "foreAft", "cutter"], ["gunboat", 5, "bomb", "bomb"],
    ["schooner", 6, "foreAft", "schooner"], ["brig", 6, "mixed", "brig"],
    ["frigate", 7, "square", "frigate"], ["firstRate", 9, "heavySquare", "line"]
  ];
  const scales = [];
  for (const [template, sm, profile, family] of cases) {
    const unit = { template, stats: { sm }, sailing: { profile }, x: 4, y: 5, heading: 120 };
    const before = structuredClone(unit);
    assert.equal(tokenVisual(unit).family, family);
    scales.push(tokenVisual(unit).scale);
    assert.deepEqual(unit, before);
  }
  assert.ok(scales.at(-1) > scales[0]);
  for (const silhouette of ["bird", "ray", "jelly", "swarm", "beast"]) {
    assert.equal(tokenVisual({ unitType: "creature", token: { silhouette } }).family, silhouette);
  }
  assert.deepEqual(tokenVisual({ contactState: "detected", stats: { sm: 1 } }),
    tokenVisual({ contactState: "detected", stats: { sm: 20 }, template: "firstRate" }));
});

test("Wind streaks and gun arcs use the same north-clockwise convention", async () => {
  const { WindEngine } = await import("../scripts/engine/wind-engine.js");
  const { GunneryEngine } = await import("../scripts/engine/gunnery-engine.js");
  const { BoardContextBuilder } = await import("../scripts/context/board-context-builder.js");
  const builder = new BoardContextBuilder({});
  for (const heading of headings) {
    const wind = { direction: heading, strength: "light" };
    const data = builder.prepareWindParticles({ wind }, 500, 500);
    assert.equal(data.windParticleAngle, tokenVisual({ heading }).rotation);
    assert.equal(WindEngine.getPointOfSail({ heading }, wind), "running");
    assert.equal(WindEngine.getPointOfSail({ heading: (heading+180)%360 }, wind), "inIrons");
    for (const arc of ["bow","stern","port","starboard"]) for (const direction of headings) {
      assert.equal(GunneryEngine.isDirectionInArc({heading},arc,direction),
        CreatureAttackEngine.isDirectionInArc({heading},arc,direction));
    }
  }
});
