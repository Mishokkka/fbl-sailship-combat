// Reproducible observations of the existing rules, without changing balance.
import "../tests/test-env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { MovementEngine } from "../scripts/engine/movement-engine.js";
import { WindEngine } from "../scripts/engine/wind-engine.js";
import { MovementReadoutBuilder } from "../scripts/context/movement-readout-builder.js";

function fixture(profile = "mixed", speed = 4) {
  const battle = BattleNormalizer.normalize(createDefaultBattle());
  battle.setup.mode = "air"; battle.setupConfirmed = true; battle.phase = "movement";
  battle.wind = { direction: 240, strength: "moderate" }; battle.board.terrain = {};
  battle.ships = [battle.ships[0]];
  const ship = battle.ships[0];
  Object.assign(ship, { x: 12, y: 10, heading: 0, speed, altitude: 4, verticalVelocity: 0, selectedOrder: null });
  ship.stats.sm = 7; ship.stats.handling = 1; ship.sailing = { ...ship.sailing, profile };
  return battle;
}
const rows = [];
for (const profile of ["foreAft", "mixed", "square", "heavySquare"]) {
  const b = fixture(profile), s = b.ships[0];
  const initial = MovementEngine.getInertiaProfile(b, s);
  MovementEngine.reduceSpeed(b, s.id);
  const afterBrake = MovementEngine.getInertiaProfile(b, s);
  const completion = MovementEngine.resolveHorizontalCompletion(b, s);
  rows.push({ profile: WindEngine.getSailingProfile(s), initial, afterBrake,
    completeAfterBrake: completion.ok, speedAfterCompletion: s.speed });
}
const vertical = [];
for (const vv of [-2, -1, 1, 2]) {
  const b = fixture(), s = b.ships[0]; s.verticalVelocity = vv; s.altitude = 6;
  const heights = [s.altitude], velocities = [s.verticalVelocity];
  for (let r = 0; r < 3; r++) {
    MovementEngine.applyVerticalInertia(b, s);
    heights.push(s.altitude); velocities.push(s.verticalVelocity);
  }
  vertical.push({ vv, heights, velocities });
}
const intoWind = fixture(), windShip = intoWind.ships[0];
windShip.heading = WindEngine.getWindSourceDirection(intoWind.wind);
const beforeWind = windShip.speed;
MovementEngine.syncSailingState(intoWind, windShip);
const edge = fixture("square", 4), edgeShip = edge.ships[0];
edgeShip.y = 0; const beforeHp = edgeShip.sections.bow.hp.value;
const edgeResult = MovementEngine.resolveHorizontalCompletion(edge, edgeShip);
const creatureRows = [];
for (const template of ["skyRay", "cloudJelly", "razorSwarm"]) {
  const b = fixture(), creature = createCreature({ template, speed: 0, altitude: 4, x: 12, y: 10 });
  b.ships = [creature];
  creatureRows.push({ template, profile: creature.movement.profile, motion: MovementReadoutBuilder.build(b, creature) });
}
const report = {
  fixtures: "Intact ships: SM7, handling1, altitude4, speed4, moderate wind to240°, heading0°, no order, clear board.",
  rows, vertical, intoWind: { before: beforeWind, after: windShip.speed },
  boardEdge: { completed: edgeResult.ok, forced: Boolean(edgeResult.forced), speed: edgeShip.speed, bowDamage: beforeHp - edgeShip.sections.bow.hp.value },
  creatures: creatureRows
};
await mkdir("artifacts/inertia", { recursive: true });
await writeFile("artifacts/inertia/audit.json", JSON.stringify(report, null, 2));
console.log("INERTIA_AUDIT " + JSON.stringify(report));
