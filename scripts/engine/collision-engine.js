import { angleBetween } from "../board/board-geometry.js";
import { DamageEngine } from "./damage-engine.js";
import { BoardingEngine } from "./boarding-engine.js";

const CONTACT_LABELS = {
  touch: "касание",
  broadside: "бортовое столкновение",
  headOn: "лобовое столкновение"
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value ?? 0)));
}

export class CollisionEngine {
  /**
   * SM is logarithmic in the rules, so using it as a linear mass made light and
   * heavy ships much too similar. This proxy doubles mass every two SM steps.
   */
  static massProxy(unit) {
    const sm = clamp(unit?.stats?.sm ?? unit?.sizeClass ?? 7, 0, 20);
    return clamp(2 ** ((sm - 5) / 2), 0.25, 128);
  }

  static relativeVelocity(attackerSpeed, targetSpeed, angle) {
    const radians = Number(angle ?? 0) * Math.PI / 180;
    const squared = attackerSpeed ** 2 + targetSpeed ** 2 - 2 * attackerSpeed * targetSpeed * Math.cos(radians);
    return Math.sqrt(Math.max(0, squared));
  }

  static previewShipCollision(attacker, target, conflict = {}) {
    if (!attacker || !target || Number(attacker.altitude ?? 0) !== Number(target.altitude ?? 0)) return null;
    const attackerHeading = Number(conflict.attackerHeading ?? attacker.heading ?? 0);
    const targetHeading = Number(conflict.targetStep?.heading ?? conflict.reservation?.heading ?? target.heading ?? 0);
    const attackerSpeed = Math.max(0, Number(conflict.attackerSpeed ?? attacker.speed ?? 0));
    const targetSpeed = Math.max(0, Number(conflict.reservation?.speed ?? target.speed ?? 0));
    const angle = angleBetween(attackerHeading, targetHeading);
    const relativeSpeed = this.relativeVelocity(attackerSpeed, targetSpeed, angle);
    const contactType = relativeSpeed < 1.15 ? "touch" : angle >= 120 ? "headOn" : "broadside";

    const attackerMass = this.massProxy(attacker);
    const targetMass = this.massProxy(target);
    const reducedMass = (attackerMass * targetMass) / Math.max(0.001, attackerMass + targetMass);
    const impactEnergy = 0.5 * reducedMass * relativeSpeed ** 2;
    const contactMultiplier = contactType === "headOn" ? 1.15 : contactType === "broadside" ? 1 : 0.45;
    const baseDamage = Math.max(0.75, Math.sqrt(Math.max(0.1, impactEnergy)) * 2.4 * contactMultiplier);
    const attackerDamage = clamp(Math.round(baseDamage * Math.sqrt(targetMass / attackerMass)), 1, 40);
    const targetDamage = clamp(Math.round(baseDamage * Math.sqrt(attackerMass / targetMass)), 1, 40);

    const attackerSection = "bow";
    const targetAspect = angleBetween(targetHeading, attackerHeading);
    const targetSection = targetAspect >= 150 ? "bow" : targetAspect <= 30 ? "stern" : "midship";
    const label = CONTACT_LABELS[contactType];

    // Momentum share determines how much of each ship's current motion is lost.
    const attackerImpulseShare = targetMass / Math.max(0.001, attackerMass + targetMass);
    const targetImpulseShare = attackerMass / Math.max(0.001, attackerMass + targetMass);
    const attackerSpeedLoss = clamp(Math.ceil(relativeSpeed * attackerImpulseShare), contactType === "touch" ? 0 : 1, attackerSpeed);
    const targetSpeedLoss = clamp(Math.ceil(relativeSpeed * targetImpulseShare), 0, targetSpeed);

    return {
      kind: conflict.kind ?? "occupied",
      contactType,
      label,
      attackerId: attacker.id,
      attackerName: attacker.name,
      targetId: target.id,
      targetName: target.name,
      altitude: Number(attacker.altitude ?? 0),
      angle,
      relativeSpeed: Number(relativeSpeed.toFixed(2)),
      attackerSpeed,
      targetSpeed,
      attackerMass: Number(attackerMass.toFixed(2)),
      targetMass: Number(targetMass.toFixed(2)),
      impactEnergy: Number(impactEnergy.toFixed(2)),
      attackerDamage,
      targetDamage,
      attackerSection,
      targetSection,
      attackerSpeedLoss,
      targetSpeedLoss,
      impactStrength: clamp(Math.round(baseDamage), 1, 24),
      title: `${label}: относительная скорость ${relativeSpeed.toFixed(1)}, ${attacker.name} −${attackerDamage} HP, ${target.name} −${targetDamage} HP`
    };
  }

  static applyShipCollision(battle, preview) {
    if (!preview) return { applied: false, text: "" };
    const attacker = (battle?.ships ?? []).find(ship => ship.id === preview.attackerId);
    const target = (battle?.ships ?? []).find(ship => ship.id === preview.targetId);
    if (!attacker || !target || Number(attacker.altitude ?? 0) !== Number(target.altitude ?? 0)) return { applied: false, text: "" };

    this.applySectionDamage(attacker, preview.attackerSection, preview.attackerDamage, "столкновение");
    this.applySectionDamage(target, preview.targetSection, preview.targetDamage, "столкновение");
    attacker.speed = Math.max(0, Number(attacker.speed ?? 0) - Number(preview.attackerSpeedLoss ?? 0));
    target.speed = Math.max(0, Number(target.speed ?? 0) - Number(preview.targetSpeedLoss ?? 0));
    const struck = [];
    DamageEngine.checkStruck(attacker, struck);
    DamageEngine.checkStruck(target, struck);
    const auto = BoardingEngine.tryAutomaticGrapple(battle, attacker, target, preview);
    battle.lastCollision = {
      id: `collision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      attackerId: attacker.id,
      targetId: target.id,
      attackerEnd: { x: Number(attacker.x ?? 0), y: Number(attacker.y ?? 0), heading: Number(attacker.heading ?? 0) },
      targetEnd: { x: Number(target.x ?? 0), y: Number(target.y ?? 0), heading: Number(target.heading ?? 0) },
      contactType: preview.contactType,
      relativeSpeed: preview.relativeSpeed,
      impactStrength: preview.impactStrength,
      attackerMass: preview.attackerMass,
      targetMass: preview.targetMass,
      grappled: Boolean(auto.grappled)
    };
    const grappleText = auto.grappled ? " Корабли автоматически сцепились." : "";
    const text = `${preview.label}: относительная скорость ${Number(preview.relativeSpeed).toFixed(1)}; ${attacker.name} получает ${preview.attackerDamage} урона (${this.sectionLabel(preview.attackerSection)}), ${target.name} — ${preview.targetDamage} (${this.sectionLabel(preview.targetSection)}).${grappleText}${struck.length ? ` ${struck.join(" ")}` : ""}`;
    return { applied: true, attacker, target, autoGrapple: auto, text };
  }

  static applySectionDamage(ship, sectionId, damage, reason) {
    const section = ship?.sections?.[sectionId] ?? Object.values(ship?.sections ?? {})[0];
    if (!section) return;
    section.hp ??= { value: 0, max: 0 };
    section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - Math.max(0, Number(damage ?? 0)));
    if (Number(damage ?? 0) >= 6) DamageEngine.addBreachOrFlooding(ship, section, 1, reason);
  }

  static sectionLabel(sectionId) {
    return { bow: "нос", midship: "центр", stern: "корма" }[sectionId] ?? sectionId;
  }
}
