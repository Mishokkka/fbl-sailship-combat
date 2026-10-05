import { directionToCell, distanceCells } from "../board/board-geometry.js";
import { getCombatants } from "../utils/combatants.js";
import { MovementEngine } from "./movement-engine.js";
import { CreatureAttackEngine } from "./creature-attack-engine.js";
import { CreatureDamageEngine } from "./creature-damage-engine.js";
import { CreatureGrappleEngine } from "./creature-grapple-engine.js";
import { CreatureAbilityEngine } from "./creature-ability-engine.js";
import { CreatureMovementEngine } from "./creature-movement-engine.js";

function livingEnemies(battle, creature) {
  return getCombatants(battle).filter(unit => unit.id !== creature.id && unit.side !== creature.side && !unit.flags?.struck && !unit.flags?.withdrawn);
}

export class CreatureAIEngine {
  static chooseTarget(battle, creature) {
    const enemies = livingEnemies(battle, creature);
    const policy = creature?.behavior?.targetPolicy ?? "nearest";
    return enemies.sort((a, b) => {
      if (policy === "weakest") {
        const ahp = a.unitType === "creature" ? Number(a.vitality?.current ?? 9999) : Object.values(a.sections ?? {}).reduce((sum, section) => sum + Number(section.hp?.value ?? 0), 0);
        const bhp = b.unitType === "creature" ? Number(b.vitality?.current ?? 9999) : Object.values(b.sections ?? {}).reduce((sum, section) => sum + Number(section.hp?.value ?? 0), 0);
        return ahp - bhp;
      }
      if (policy === "largest") return Number(b.stats?.sm ?? 0) - Number(a.stats?.sm ?? 0);
      return distanceCells(creature, a) - distanceCells(creature, b);
    })[0] ?? null;
  }

  static runMovement(battle, creature, { random = Math.random } = {}) {
    const entries = [];
    if (creature.flags?.falling) {
      const recovery = CreatureMovementEngine.recoverFromFall(battle, creature, { random });
      entries.push(recovery.text);
      if (!recovery.ok || !recovery.success) return { ok: recovery.ok, moved: false, recovered: false, text: entries.join(" ") };
    }
    if (CreatureGrappleEngine.isAttached(creature)) return { ok: true, text: `${creature.name}: остается на корпусе захваченного корабля.` };
    const target = this.chooseTarget(battle, creature);
    if (!target) return { ok: entries.length > 0, moved: false, recovered: entries.length > 0, text: [...entries, `${creature.name}: ИИ не видит противников.`].join(" ") };
    const behavior = String(creature.behavior?.mode ?? "manual");
    const preferred = Math.max(1, Number(creature.behavior?.preferredRange ?? 1));
    const currentDistance = Math.max(distanceCells(creature, target), Math.abs(Number(creature.altitude ?? 0) - Number(target.altitude ?? 0)));

    if (behavior === "coward" && Number(creature.vitality?.morale ?? 10) <= 3) {
      creature.flags ??= {};
      creature.flags.withdrawn = true;
      return { ok: true, moved: false, text: [...entries, `${creature.name}: ломается и покидает бой.`].join(" ") };
    }

    if (Number(creature.speed ?? 0) <= 0) MovementEngine.increaseSpeed(battle, creature.id);
    const targetAltitude = Number(target.altitude ?? creature.altitude ?? 0);
    if (targetAltitude > Number(creature.altitude ?? 0) && Number(creature.movement?.climb ?? 0) > 0) {
      const after = Math.min(targetAltitude, Number(creature.altitude ?? 0) + Number(creature.movement.climb));
      creature.altitude = after;
    } else if (targetAltitude < Number(creature.altitude ?? 0) && Number(creature.movement?.dive ?? 0) > 0) {
      creature.altitude = Math.max(targetAltitude, Number(creature.altitude ?? 0) - Number(creature.movement.dive));
    }
    const reachable = MovementEngine.getReachableCells(battle, creature);
    if (!reachable.length) {
      const desired = directionToCell(creature, target);
      creature.heading = desired;
      return { ok: true, moved: false, text: [...entries, `${creature.name}: разворачивается к ${target.name}, но не может продвинуться.`].join(" ") };
    }

    const wantsDistance = behavior === "skirmisher" || behavior === "coward" || Number(creature.behavior?.aggression ?? 5) <= 3;
    const desiredRange = behavior === "predator" ? 1 : preferred;
    const chosen = reachable.sort((a, b) => {
      const aDistance = distanceCells(a, target);
      const bDistance = distanceCells(b, target);
      const aScore = wantsDistance && currentDistance <= preferred
        ? -aDistance
        : Math.abs(aDistance - desiredRange);
      const bScore = wantsDistance && currentDistance <= preferred
        ? -bDistance
        : Math.abs(bDistance - desiredRange);
      return aScore - bScore || Number(b.steps ?? 0) - Number(a.steps ?? 0);
    })[0];
    const result = MovementEngine.getMoveResult(battle, creature.id, chosen.x, chosen.y);
    const applied = MovementEngine.applyMoveResult(battle, result);
    return {
      ok: Boolean(applied.ok),
      moved: Boolean(applied.ok),
      recovered: entries.length > 0,
      text: [...entries, applied.ok ? `${creature.name}: ИИ движется к ${target.name} (${chosen.x + 1}:${chosen.y + 1}).${applied.terrain?.text ?? ""}` : `${creature.name}: ИИ не смог выполнить движение.`].join(" ")
    };
  }

  static chooseAbility(battle, creature, phase) {
    const active = CreatureAbilityEngine.getActiveAbilities(creature, phase)
      .filter(ability => CreatureAbilityEngine.canUse(battle, creature, ability));
    if (!active.length) return null;
    if (phase === "movement") {
      const target = this.chooseTarget(battle, creature);
      const distance = target ? Math.max(distanceCells(creature, target), Math.abs(Number(creature.altitude ?? 0) - Number(target.altitude ?? 0))) : 0;
      return active.find(ability => ability.effect === "breakaway" && CreatureGrappleEngine.isAttached(creature))
        ?? active.find(ability => ability.effect === "cloak" && distance <= Math.max(2, Number(creature.behavior?.preferredRange ?? 1) + 1))
        ?? active.find(ability => ability.effect === "dash" && distance > Number(creature.behavior?.preferredRange ?? 1) + 1)
        ?? null;
    }
    if (phase === "gunnery") {
      return active.find(ability => ability.effect === "shockwave" && livingEnemies(battle, creature)
        .filter(target => Math.max(distanceCells(creature, target), Math.abs(Number(creature.altitude ?? 0) - Number(target.altitude ?? 0))) <= Number(ability.radius ?? 1)).length >= 2) ?? null;
    }
    if (phase === "crew") {
      const vitalityRatio = Number(creature.vitality?.current ?? 0) / Math.max(1, Number(creature.vitality?.max ?? 1));
      return active.find(ability => ["heal", "regenerate"].includes(ability.effect) && vitalityRatio < 0.75)
        ?? active.find(ability => ability.effect === "rally" && Number(creature.vitality?.morale ?? 10) < 7)
        ?? null;
    }
    return null;
  }

  static runGunnery(battle, creature, { random = Math.random } = {}) {
    const ability = this.chooseAbility(battle, creature, "gunnery");
    if (ability) return CreatureAbilityEngine.resolve(battle, creature.id, ability.id);
    const options = [];
    for (const attack of creature.attacks ?? []) {
      for (const entry of CreatureAttackEngine.getTargets(battle, creature, attack.id)) {
        const areaBonus = attack.tags?.includes("area") ? 4 : 0;
        const grappleBonus = attack.tags?.includes("grapple") && entry.target.unitType === "ship" ? 5 : 0;
        options.push({ attack, entry, score: Number(entry.chance ?? 0) * Number(attack.damage ?? 1) + areaBonus + grappleBonus });
      }
    }
    options.sort((a, b) => b.score - a.score);
    const best = options[0];
    if (!best) return { ok: false, text: `${creature.name}: ИИ не нашёл доступной атаки.` };
    return CreatureAttackEngine.resolve(battle, creature.id, best.attack.id, best.entry.target.id, { random });
  }

  static runCrew(_battle, creature) {
    if (Number(creature.flags?.burning)) return CreatureDamageEngine.recover(creature, "extinguish");
    if (Number(creature.flags?.bleeding ?? 0) > 0) return CreatureDamageEngine.recover(creature, "stopBleeding");
    if (Number(creature.flags?.stunned ?? 0) > 0) return CreatureDamageEngine.recover(creature, "shakeOff");
    if (Number(creature.vitality?.morale ?? 10) < 10) return CreatureDamageEngine.recover(creature, "steady");
    return { ok: true, text: `${creature.name}: не нуждается в восстановлении.` };
  }

  static runPhase(battle, creature, { random = Math.random } = {}) {
    if (!creature?.behavior?.controlledByAI) return { ok: false, text: `${creature?.name ?? "Существо"}: управление ИИ отключено.` };
    if (battle.phase === "movement") {
      const entries = [];
      // Выход из падения уже занимает первое ОД, а последующее движение — второе.
      // ИИ не должен дополнительно активировать способность и получать три действия.
      const ability = creature.flags?.falling ? null : this.chooseAbility(battle, creature, "movement");
      if (ability) {
        const abilityResult = CreatureAbilityEngine.resolve(battle, creature.id, ability.id);
        if (abilityResult.ok) entries.push(abilityResult.text);
      }
      if (CreatureGrappleEngine.isAttached(creature)) {
        return entries.length
          ? { ok: true, text: entries.join(" ") }
          : { ok: true, text: `${creature.name}: остается на корпусе захваченного корабля.` };
      }
      const movement = this.runMovement(battle, creature, { random });
      if (movement.ok) entries.push(movement.text);
      return { ok: movement.ok || entries.length > 0, moved: Boolean(movement.moved), recovered: Boolean(movement.recovered), text: entries.join(" ") || movement.text };
    }
    if (battle.phase === "gunnery") return this.runGunnery(battle, creature, { random });
    if (battle.phase === "crew") {
      const entries = [];
      const ability = this.chooseAbility(battle, creature, "crew");
      if (ability) {
        const abilityResult = CreatureAbilityEngine.resolve(battle, creature.id, ability.id);
        if (abilityResult.ok) entries.push(abilityResult.text);
      }
      const recovery = this.runCrew(battle, creature);
      if (recovery.ok && !recovery.text?.includes("не нуждается")) entries.push(recovery.text);
      return { ok: entries.length > 0 || recovery.ok, text: entries.join(" ") || recovery.text };
    }
    return { ok: false, text: "В этой фазе ИИ существа не действует." };
  }
}
