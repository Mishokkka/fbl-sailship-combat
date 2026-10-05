import { directionToCell, distanceCells, lineCells, cellKey, rotateHeading } from "../board/board-geometry.js";
import { roll3d6 } from "../utils/random.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { getCombatant, getCombatants } from "../utils/combatants.js";
import { MovementEngine } from "./movement-engine.js";
import { CreatureDamageEngine } from "./creature-damage-engine.js";
import { DamageEngine } from "./damage-engine.js";
import { CreatureGrappleEngine } from "./creature-grapple-engine.js";

const ARC_LABELS = Object.freeze({ bow: "вперед", stern: "назад", port: "левый сектор", starboard: "правый сектор", all: "круговая" });
const TYPE_LABELS = Object.freeze({ natural: "естественная", breath: "дыхание", spit: "плевок", sonic: "звуковая", magic: "магическая", ram: "таран", other: "особая" });

export class CreatureAttackEngine {
  static getAttack(creature, attackId) {
    return (creature?.attacks ?? []).find(attack => attack.id === attackId) ?? null;
  }

  static getArcDirections(creature, arc) {
    const heading = Number(creature?.heading ?? 0);
    if (arc === "bow") return [heading];
    if (arc === "stern") return [rotateHeading(heading, 3)];
    if (arc === "port") return [rotateHeading(heading, -1), rotateHeading(heading, -2)];
    if (arc === "starboard") return [rotateHeading(heading, 1), rotateHeading(heading, 2)];
    return [0, 60, 120, 180, 240, 300];
  }

  static isDirectionInArc(creature, arc, direction) {
    return this.getArcDirections(creature, arc).includes(Number(direction));
  }

  static distance(attacker, target) {
    return Math.max(distanceCells(attacker, target), Math.abs(Number(attacker?.altitude ?? 0) - Number(target?.altitude ?? 0)));
  }

  static blockedByTerrain(battle, attacker, target, attack) {
    if (["magic", "sonic"].includes(attack?.type)) return false;
    if (Number(attack?.range ?? 1) <= 1) return false;
    const altitude = Math.min(Number(attacker?.altitude ?? 0), Number(target?.altitude ?? 0));
    for (const cell of lineCells(attacker, target).slice(1, -1)) {
      const terrain = battle?.board?.terrain?.[cellKey(cell.x, cell.y)];
      if (MovementEngine.hasTerrain(terrain, "rockHigh") && MovementEngine.terrainAffectsAltitude("rockHigh", altitude)) return true;
      if (MovementEngine.hasTerrain(terrain, "skyIsland") && MovementEngine.terrainAffectsAltitude("skyIsland", altitude)) return true;
    }
    return false;
  }

  static getSkill(attacker, target, attack) {
    let skill = 10 + Number(attacker?.stats?.handling ?? 0);
    if (attack?.type === "breath" || attack?.type === "spit") skill += 1;
    if (attack?.type === "sonic" || attack?.type === "magic") skill += 2;
    if (attack?.tags?.includes("swarm")) skill += 1;
    if (Number(attacker?.flags?.stunned ?? 0) > 0) skill -= Math.min(4, Number(attacker.flags.stunned));
    if (Number(attacker?.vitality?.morale ?? 10) <= 3) skill -= 2;
    if (Number(target?.speed ?? 0) >= 5) skill -= 2;
    else if (Number(target?.speed ?? 0) >= 3) skill -= 1;
    if (target?.flags?.stunned || target?.flags?.grappledWith || target?.flags?.inIrons) skill += 1;
    if (Number(target?.flags?.camouflaged ?? 0) > 0) skill -= 2;
    if (attacker?.flags?.attachedTo === target?.id) skill += 3;
    const range = this.distance(attacker, target);
    if (range > Math.max(1, Math.floor(Number(attack?.range ?? 1) * 0.66))) skill -= 1;
    return Math.max(4, Math.min(16, skill));
  }

  static getTargets(battle, attacker, attackId) {
    if (!CombatantRules.supports(attacker, "naturalAttack") || !CombatantRules.isActive(attacker)) return [];
    const attack = this.getAttack(attacker, attackId);
    if (!attack || Number(attack.cooldown ?? 0) > 0) return [];
    const attachedHost = CreatureGrappleEngine.getHost(battle, attacker);
    const maxRange = Number(attack.range ?? 1);
    const targets = [];
    for (const target of getCombatants(battle)) {
      if (target.id === attacker.id
        || target.side === attacker.side
        || !CombatantRules.supports(target, "targetable")
        || !CombatantRules.isActive(target)
        || (attachedHost && target.id !== attachedHost.id)) continue;
      const range = this.distance(attacker, target);
      if (range > maxRange) continue;
      const direction = directionToCell(attacker, target);
      if (!this.isDirectionInArc(attacker, attack.arc, direction)) continue;
      if (this.blockedByTerrain(battle, attacker, target, attack)) continue;
      const skill = this.getSkill(attacker, target, attack);
      targets.push({ target, attack, range, direction, skill, chance: this.probability3d6(skill) });
    }
    return targets.sort((a, b) => a.range - b.range || b.skill - a.skill);
  }

  static getAllTargets(battle, attacker) {
    const byId = new Map();
    for (const attack of attacker?.attacks ?? []) {
      for (const entry of this.getTargets(battle, attacker, attack.id)) {
        const current = byId.get(entry.target.id);
        if (!current || entry.skill > current.skill) byId.set(entry.target.id, entry);
      }
    }
    return [...byId.values()];
  }

  static preview(battle, attacker, attackId, targetId = null) {
    const attack = this.getAttack(attacker, attackId);
    if (!attack) return null;
    const targets = this.getTargets(battle, attacker, attackId);
    const targetInfo = targetId ? targets.find(entry => entry.target.id === targetId) : targets[0];
    return {
      attack,
      target: targetInfo?.target ?? null,
      range: targetInfo?.range ?? null,
      skill: targetInfo?.skill ?? null,
      hitChance: targetInfo?.chance ?? 0,
      typeLabel: TYPE_LABELS[attack.type] ?? attack.type,
      arcLabel: ARC_LABELS[attack.arc] ?? attack.arc,
      ready: Number(attack.cooldown ?? 0) <= 0,
      canAttack: Boolean(targetInfo)
    };
  }

  static resolve(battle, attackerId, attackId, targetId = null, { random = Math.random } = {}) {
    const attacker = getCombatant(battle, attackerId);
    if (!attacker) return { ok: false, text: "Атакующее существо не найдено." };
    if (!CombatantRules.supports(attacker, "naturalAttack")) return { ok: false, text: `${attacker.name}: естественные атаки недоступны.` };
    const attack = this.getAttack(attacker, attackId);
    if (!attack) return { ok: false, text: "Атака не найдена." };
    if (Number(attack.cooldown ?? 0) > 0) return { ok: false, text: `${attack.label}: восстановление еще ${attack.cooldown} раунд.` };
    const targets = this.getTargets(battle, attacker, attackId);
    const targetInfo = targetId ? targets.find(entry => entry.target.id === targetId) : targets[0];
    if (!targetInfo) return { ok: false, text: `${attacker.name}: для «${attack.label}» нет цели в дальности и секторе.` };

    const roll = roll3d6(random);
    const hit = roll <= targetInfo.skill;
    attack.cooldown = Math.max(0, Number(attack.cooldownMax ?? 0));
    const base = Number(attack.damage ?? 1);
    const margin = Math.max(0, targetInfo.skill - roll);
    const damage = Math.max(1, base + Math.floor(margin / 3));
    const result = {
      ok: true,
      hit,
      attacker,
      target: targetInfo.target,
      attack,
      roll,
      skill: targetInfo.skill,
      range: targetInfo.range,
      damage,
      tags: [...(attack.tags ?? [])],
      text: `${attacker.name}: «${attack.label}» по ${targetInfo.target.name}; 3d6=${roll} против ${targetInfo.skill}${hit ? `, попадание, урон ${damage}` : ", мимо"}.`
    };
    if (!hit) return result;

    const damageResult = this.applyDamageToTarget(result, targetInfo.target, damage, { random, primary: true });
    result.damageResult = damageResult;
    if (damageResult?.text) result.text += ` ${damageResult.text}`;

    if (attack.tags?.includes("grapple") && targetInfo.target.unitType === "ship" && CombatantRules.isActive(attacker)) {
      const grapple = CreatureGrappleEngine.attach(battle, attacker.id, targetInfo.target.id);
      result.grappleResult = grapple;
      if (grapple?.text) result.text += ` ${grapple.text}`;
    }

    if (attack.tags?.includes("area") && Number(attack.radius ?? 0) > 0) {
      const splash = this.applyAreaDamage(battle, result, targetInfo.target, { random });
      result.areaResults = splash;
      if (splash.length) result.text += ` Площадной эффект: ${splash.map(entry => entry.text).join(" ")}`;
    }
    return result;
  }

  static applyDamageToTarget(result, target, damage, { random = Math.random, primary = false } = {}) {
    const attack = result.attack ?? {};
    if (target.unitType === "creature") {
      return CreatureDamageEngine.applyDamage(target, damage, {
        sectionId: CreatureDamageEngine.chooseDirectionalSection(result.attacker, target, { random }),
        halfArmor: attack.tags?.includes("piercing"),
        tags: attack.tags,
        bleeding: primary && (attack.type === "natural" || attack.type === "ram"),
        burning: attack.type === "breath" && attack.tags?.includes("fire"),
        stun: attack.type === "sonic" ? 2 : attack.tags?.includes("stun") || attack.tags?.includes("poison") ? 1 : 0,
        moraleDamage: attack.tags?.includes("morale") ? 2 : attack.tags?.includes("poison") ? 1 : 0
      });
    }
    return DamageEngine.applyCreatureAttackResult({ ...result, target, damage });
  }

  static applyAreaDamage(battle, result, primaryTarget, { random = Math.random } = {}) {
    const radius = Math.max(1, Number(result.attack?.radius ?? 1));
    const friendlyFire = result.attack?.tags?.includes("friendlyFire");
    const splashDamage = Math.max(1, Math.ceil(Number(result.damage ?? 1) / 2));
    const entries = [];
    for (const target of getCombatants(battle)) {
      if (target.id === result.attacker.id || target.id === primaryTarget.id || !CombatantRules.isActive(target)) continue;
      if (!friendlyFire && target.side === result.attacker.side) continue;
      const distance = Math.max(distanceCells(primaryTarget, target), Math.abs(Number(primaryTarget.altitude ?? 0) - Number(target.altitude ?? 0)));
      if (distance > radius) continue;
      const damageResult = this.applyDamageToTarget(result, target, splashDamage, { random, primary: false });
      entries.push({ target, damageResult, text: `${target.name}: ${damageResult?.text ?? `${splashDamage} урона`}` });
    }
    return entries;
  }

  static probability3d6(skill) {
    let successes = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) if (a + b + c <= skill) successes += 1;
    return Math.round((successes / 216) * 100);
  }
}
