import { distanceCells } from "../board/board-geometry.js";
import { getCombatant, getCombatants } from "../utils/combatants.js";
import { CreatureDamageEngine } from "./creature-damage-engine.js";
import { DamageEngine } from "./damage-engine.js";
import { CreatureGrappleEngine } from "./creature-grapple-engine.js";

const EFFECT_LABELS = Object.freeze({
  none: "особая",
  heal: "исцеление",
  rally: "подъём духа",
  dash: "рывок",
  cloak: "маскировка",
  shockwave: "площадной удар",
  regenerate: "регенерация",
  breakaway: "отцепление"
});

function healCreature(creature, amount) {
  const power = Math.max(1, Number(amount ?? 1));
  const before = Number(creature.vitality?.current ?? 0);
  creature.vitality.current = Math.min(Number(creature.vitality?.max ?? before), before + power);
  const damaged = Object.entries(creature.sections ?? {})
    .filter(([, section]) => Number(section.hp?.value ?? 0) < Number(section.hp?.max ?? 0))
    .sort((a, b) => (Number(a[1].hp.value) / Math.max(1, Number(a[1].hp.max))) - (Number(b[1].hp.value) / Math.max(1, Number(b[1].hp.max))))[0];
  let sectionText = "";
  if (damaged) {
    const [id, section] = damaged;
    const sectionBefore = Number(section.hp.value ?? 0);
    section.hp.value = Math.min(Number(section.hp.max ?? sectionBefore), sectionBefore + Math.max(1, Math.ceil(power / 2)));
    if (section.hp.value > 0 && section.status === "destroyed") section.status = "damaged";
    sectionText = ` ${section.label ?? id}: ${sectionBefore} → ${section.hp.value}.`;
  }
  CreatureDamageEngine.updateConsequences(creature);
  return `${creature.name}: жизненная сила ${before} → ${creature.vitality.current}.${sectionText}`;
}

export class CreatureAbilityEngine {
  static getAbility(creature, abilityId) {
    return (creature?.abilities ?? []).find(ability => ability.id === abilityId) ?? null;
  }

  static phaseMatches(ability, phase) {
    return ability?.phase === "any" || ability?.phase === phase;
  }

  static getActiveAbilities(creature, phase) {
    return (creature?.abilities ?? []).filter(ability => ability.type === "active" && this.phaseMatches(ability, phase));
  }

  static canUse(battle, creature, ability, targetId = null) {
    if (!creature || creature.unitType !== "creature" || creature.flags?.struck || creature.flags?.withdrawn) return false;
    if (!ability || ability.type !== "active" || !this.phaseMatches(ability, battle?.phase)) return false;
    if (Number(ability.cooldown ?? 0) > 0) return false;
    if (Number(ability.usesMax ?? 0) > 0 && Number(ability.uses ?? 0) <= 0) return false;
    if (ability.effect === "breakaway") return CreatureGrappleEngine.isAttached(creature);
    if (["heal", "regenerate"].includes(ability.effect)) {
      const vitalityMissing = Number(creature.vitality?.current ?? 0) < Number(creature.vitality?.max ?? 0);
      const sectionMissing = Object.values(creature.sections ?? {}).some(section => Number(section.hp?.value ?? 0) < Number(section.hp?.max ?? 0));
      if (!vitalityMissing && !sectionMissing) return false;
    }
    if (ability.effect === "rally" && Number(creature.vitality?.morale ?? 10) >= 10) return false;
    if (ability.effect === "dash" && (creature.flags?.falling || Number(creature.speed ?? 0) >= Number(creature.maxSpeed ?? 0))) return false;
    if (ability.effect === "shockwave") {
      const radius = Math.max(1, Number(ability.radius ?? 1));
      const hasTarget = getCombatants(battle).some(target => target.id !== creature.id
        && target.side !== creature.side
        && !target.flags?.struck
        && !target.flags?.withdrawn
        && Math.max(distanceCells(creature, target), Math.abs(Number(creature.altitude ?? 0) - Number(target.altitude ?? 0))) <= radius);
      if (!hasTarget) return false;
    }
    if (ability.target === "enemy") {
      const target = getCombatant(battle, targetId);
      const distance = target ? Math.max(distanceCells(creature, target), Math.abs(Number(creature.altitude ?? 0) - Number(target.altitude ?? 0))) : Infinity;
      return Boolean(target && target.side !== creature.side && distance <= Number(ability.range ?? 0));
    }
    return true;
  }

  static resolve(battle, creatureId, abilityId, targetId = null) {
    const creature = getCombatant(battle, creatureId);
    const ability = this.getAbility(creature, abilityId);
    if (!this.canUse(battle, creature, ability, targetId)) return { ok: false, text: "Способность сейчас недоступна." };
    const power = Math.max(1, Number(ability.power ?? 1));
    let text = `${creature.name}: «${ability.label}».`;
    const affected = [];

    if (ability.effect === "heal" || ability.effect === "regenerate") {
      text += ` ${healCreature(creature, power)}`;
    } else if (ability.effect === "rally") {
      const before = Number(creature.vitality?.morale ?? 0);
      creature.vitality.morale = Math.min(10, before + power);
      text += ` Мораль ${before} → ${creature.vitality.morale}.`;
    } else if (ability.effect === "dash") {
      const before = Number(creature.speed ?? 0);
      creature.speed = Math.min(Number(creature.maxSpeed ?? before + power), before + power);
      text += ` Скорость ${before} → ${creature.speed}.`;
    } else if (ability.effect === "cloak") {
      creature.flags ??= {};
      creature.flags.camouflaged = Math.max(Number(creature.flags.camouflaged ?? 0), power);
      text += ` Маскировка действует ${creature.flags.camouflaged} раунд.`;
    } else if (ability.effect === "breakaway") {
      const result = CreatureGrappleEngine.detach(battle, creature.id);
      if (!result.ok) return result;
      text += ` ${result.text}`;
    } else if (ability.effect === "shockwave") {
      const radius = Math.max(1, Number(ability.radius ?? 1));
      for (const target of getCombatants(battle)) {
        if (target.id === creature.id || target.side === creature.side || target.flags?.struck || target.flags?.withdrawn) continue;
        const distance = Math.max(distanceCells(creature, target), Math.abs(Number(creature.altitude ?? 0) - Number(target.altitude ?? 0)));
        if (distance > radius) continue;
        const result = target.unitType === "creature"
          ? CreatureDamageEngine.applyDamage(target, power, { ignoreArmor: ability.tags?.includes("ignoreArmor"), tags: ability.tags })
          : DamageEngine.applyCreatureAttackResult({
            hit: true,
            attacker: creature,
            target,
            damage: power,
            tags: ability.tags ?? [],
            attack: { label: ability.label, type: "magic", tags: ability.tags ?? [] }
          });
        if (result?.text) affected.push(result.text);
      }
      text += affected.length ? ` Поражено целей: ${affected.length}. ${affected.join(" ")}` : " Целей в радиусе нет.";
    } else {
      text += " Эффект фиксируется в журнале без автоматического изменения параметров.";
    }

    ability.cooldown = Math.max(0, Number(ability.cooldownMax ?? 0));
    if (Number(ability.usesMax ?? 0) > 0) ability.uses = Math.max(0, Number(ability.uses ?? 0) - 1);
    return { ok: true, creature, ability, affected, text };
  }

  static advanceEndOfRound(creature) {
    if (!creature || creature.unitType !== "creature" || creature.flags?.struck || creature.flags?.withdrawn) return [];
    const entries = [];
    for (const ability of creature.abilities ?? []) {
      ability.cooldown = Math.max(0, Number(ability.cooldown ?? 0) - 1);
      if (ability.type === "passive" && ability.effect === "regenerate" && Number(ability.power ?? 0) > 0) {
        entries.push(`${ability.label}: ${healCreature(creature, ability.power)}`);
      }
    }
    if (Number(creature.flags?.camouflaged ?? 0) > 0) {
      creature.flags.camouflaged = Math.max(0, Number(creature.flags.camouflaged) - 1);
      if (!creature.flags.camouflaged) entries.push(`${creature.name}: маскировка рассеивается.`);
    }
    return entries;
  }

  static effectLabel(effect) {
    return EFFECT_LABELS[effect] ?? effect;
  }
}
