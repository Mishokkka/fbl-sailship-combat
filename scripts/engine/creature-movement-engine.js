import { cellKey, headingToVector, rotateHeading, withinBoard } from "../board/board-geometry.js";
import { ALTITUDE_MAX, ALTITUDE_MIN } from "../utils/constants.js";
import { OccupancyEngine } from "./occupancy-engine.js";
import { CreatureDamageEngine } from "./creature-damage-engine.js";
import { CreatureGrappleEngine } from "./creature-grapple-engine.js";
import { roll3d6 } from "../utils/random.js";

const PROFILE = Object.freeze({
  flier: { label: "активный полет", acceleration: 2, braking: 2, requiredLoss: 3 },
  glider: { label: "планирование", acceleration: 1, braking: 1, requiredLoss: 2 },
  hover: { label: "зависание", acceleration: 2, braking: 3, requiredLoss: 99 },
  stormborn: { label: "штормовой полет", acceleration: 2, braking: 2, requiredLoss: 3 },
  swarm: { label: "стая", acceleration: 3, braking: 3, requiredLoss: 99 },
  levitating: { label: "левитация", acceleration: 1, braking: 2, requiredLoss: 99 }
});

const WIND_RATING = Object.freeze({ calm: 0, light: 1, moderate: 2, strong: 3, storm: 4 });

function hasTag(section, tag) {
  return Array.isArray(section?.tags) && section.tags.includes(tag);
}

export class CreatureMovementEngine {
  static profile(creature) {
    return PROFILE[creature?.movement?.profile] ?? PROFILE.flier;
  }

  static sectionState(creature) {
    const sections = Object.values(creature?.sections ?? {}).filter(section => section?.enabled !== false);
    const flight = sections.filter(section => hasTag(section, "flight") || hasTag(section, "wing") || hasTag(section, "levitation"));
    const destroyedFlight = flight.filter(section => Number(section?.hp?.value ?? 0) <= 0 || section.status === "destroyed");
    const steering = sections.filter(section => hasTag(section, "steering") || hasTag(section, "tail"));
    const destroyedSteering = steering.filter(section => Number(section?.hp?.value ?? 0) <= 0 || section.status === "destroyed");
    return { sections, flight, destroyedFlight, steering, destroyedSteering };
  }

  static getEffectiveMaxSpeedDetails(battle, creature, { ignoreFalling = false } = {}) {
    if (!creature || creature.flags?.struck || creature.flags?.withdrawn) return { value: 0, title: "Существо выбыло из боя.", modifiers: [] };
    if (creature.flags?.attachedTo) return { value: 0, title: "Существо держится за корабль.", modifiers: ["захват корабля: ход 0"] };
    if (creature.flags?.falling && !ignoreFalling) return { value: 0, title: "Существо падает.", modifiers: ["падение: ход 0"] };
    const profile = this.profile(creature);
    const state = this.sectionState(creature);
    let value = Number(creature.maxSpeed ?? 0);
    const modifiers = [];

    if (state.flight.length) {
      const lost = state.destroyedFlight.length;
      if (lost >= state.flight.length) {
        value = 0;
        modifiers.push("несущие органы уничтожены: ход 0");
      } else if (lost > 0) {
        value -= lost * 2;
        modifiers.push(`поврежденные крылья ${lost}/${state.flight.length}: -${lost * 2}`);
      }
    }
    if (state.destroyedSteering.length) {
      value -= 1;
      modifiers.push("поврежден орган управления: -1");
    }
    if (Number(creature.flags?.stunned ?? 0) > 0) {
      value -= Math.min(2, Number(creature.flags.stunned));
      modifiers.push(`оглушение: -${Math.min(2, Number(creature.flags.stunned))}`);
    }

    const wind = battle?.wind?.strength ?? "moderate";
    const rating = WIND_RATING[wind] ?? 2;
    const response = creature?.movement?.windResponse ?? "light";
    if (response === "strong") {
      if (rating === 0) { value -= 2; modifiers.push("штиль мешает планированию: -2"); }
      else if (rating === 1) { value -= 1; modifiers.push("слабый ветер: -1"); }
      else if (rating === 3) { value += 1; modifiers.push("сильный ветер: +1"); }
      else if (rating === 4) { value += 1; modifiers.push("штормовой поток: +1"); }
    } else if (response === "light" && rating === 4) {
      value -= 1;
      modifiers.push("шторм мешает полету: -1");
    } else if (response === "drifting" && rating >= 3) {
      value -= 1;
      modifiers.push("сильный снос: -1");
    } else if (response === "resistant" && rating === 4) {
      modifiers.push("устойчиво к шторму");
    }

    const finalValue = Math.max(0, value);
    return {
      value: finalValue,
      baseMax: Number(creature.maxSpeed ?? 0),
      profileLabel: profile.label,
      modifiers,
      title: `Базовый максимум ${Number(creature.maxSpeed ?? 0)}; профиль ${profile.label}${modifiers.length ? `; ${modifiers.join("; ")}` : ""}; итог ${finalValue}.`
    };
  }


  static getFallRecoveryProfile(battle, creature) {
    if (!creature || creature.unitType !== "creature") return { canAttempt: false, reason: "Существо не выбрано." };
    if (!creature.flags?.falling) return { canAttempt: false, reason: "Существо не падает." };
    if (creature.flags?.struck || creature.flags?.withdrawn) return { canAttempt: false, reason: "Существо выбыло из боя." };
    if (Number(creature.altitude ?? 0) <= 0) return { canAttempt: false, reason: "Существо уже достигло поверхности." };
    const state = this.sectionState(creature);
    const intactFlight = state.flight.filter(section => Number(section?.hp?.value ?? 0) > 0 && section.status !== "destroyed");
    if (state.flight.length && !intactFlight.length) {
      return { canAttempt: false, reason: "Все несущие органы уничтожены. Сначала их нужно восстановить." };
    }
    const canHover = Boolean(creature.movement?.canHover || ["hover", "swarm", "levitating"].includes(creature.movement?.profile));
    const lostFlight = state.destroyedFlight.length;
    const handling = Number(creature.stats?.handling ?? 0);
    const stability = Number(creature.stats?.stability ?? 0);
    const stunned = Math.min(3, Number(creature.flags?.stunned ?? 0));
    const skill = Math.max(4, Math.min(17, 9 + handling + Math.floor(stability / 2) - lostFlight * 2 - stunned));
    const effectiveMax = this.getEffectiveMaxSpeedDetails(battle, creature, { ignoreFalling: true }).value;
    const recoverySpeed = Math.max(1, Math.min(effectiveMax, creature.movement?.profile === "glider" ? 2 : 1));
    return {
      canAttempt: effectiveMax > 0,
      reason: effectiveMax > 0 ? "" : "Повреждения не оставляют достаточной подъёмной силы.",
      automatic: canHover,
      skill,
      recoverySpeed,
      lostFlight,
      altitude: Number(creature.altitude ?? 0),
      fallReason: creature.flags?.fallReason ?? "stall"
    };
  }

  static resolveFallImpact(creature, fallHeight = null) {
    const height = Math.max(1, Number(fallHeight ?? creature?.altitude ?? 1));
    const damage = CreatureDamageEngine.applyDamage(creature, 12 + height * 2, { ignoreArmor: true, tags: ["stun"] });
    creature.altitude = 0;
    creature.speed = 0;
    creature.flags ??= {};
    creature.flags.falling = false;
    creature.flags.fallReason = null;
    return { ok: true, damage, text: `${creature.name}: удар о поверхность. ${damage.text}` };
  }

  static recoverFromFall(battle, creature, { random = Math.random } = {}) {
    const profile = this.getFallRecoveryProfile(battle, creature);
    if (!profile.canAttempt) return { ok: false, success: false, text: `${creature?.name ?? "Существо"}: ${profile.reason}`, profile };
    const beforeAltitude = Number(creature.altitude ?? 0);
    const roll = profile.automatic ? null : roll3d6(random);
    const success = profile.automatic || roll <= profile.skill;
    creature.flags ??= {};
    if (success) {
      const altitudeLoss = beforeAltitude > 1 ? 1 : 0;
      creature.altitude = Math.max(1, beforeAltitude - altitudeLoss);
      creature.flags.falling = false;
      creature.flags.fallReason = null;
      creature.speed = profile.recoverySpeed;
      return {
        ok: true, success: true, roll, skill: profile.skill, beforeAltitude, afterAltitude: creature.altitude,
        text: `${creature.name}: восстанавливает подъёмную силу${roll == null ? "" : ` (3d6=${roll} ≤ ${profile.skill})`}, высота H${beforeAltitude} → H${creature.altitude}, ход ${creature.speed}.`
      };
    }
    creature.altitude = Math.max(0, beforeAltitude - 1);
    if (creature.altitude <= 0) {
      const impact = this.resolveFallImpact(creature, beforeAltitude);
      return { ok: true, success: false, roll, skill: profile.skill, beforeAltitude, afterAltitude: 0, text: `${creature.name}: не выходит из падения (3d6=${roll} > ${profile.skill}). ${impact.text}` };
    }
    return {
      ok: true, success: false, roll, skill: profile.skill, beforeAltitude, afterAltitude: creature.altitude,
      text: `${creature.name}: не выходит из падения (3d6=${roll} > ${profile.skill}) и теряет высоту H${beforeAltitude} → H${creature.altitude}.`
    };
  }

  static getEffectiveMaxSpeed(battle, creature) {
    return this.getEffectiveMaxSpeedDetails(battle, creature).value;
  }

  static getTurnLimit(creature) {
    if (!creature || creature.flags?.struck || creature.flags?.withdrawn || creature.flags?.falling || creature.flags?.attachedTo) return 0;
    const state = this.sectionState(creature);
    let limit = Number(creature.movement?.turnLimit ?? 1);
    if (state.destroyedFlight.length) limit -= 1;
    if (state.destroyedSteering.length) limit -= 1;
    if (Number(creature.flags?.stunned ?? 0) > 0) limit -= 1;
    return Math.max(0, Math.min(3, limit));
  }

  static getInertiaProfile(battle, creature, { speed = null } = {}) {
    const profile = this.profile(creature);
    const effectiveMax = this.getEffectiveMaxSpeed(battle, creature);
    // Повреждения или ветер снижают доступную тягу, но уже набранная скорость
    // должна быть погашена движением или торможением, а не исчезать мгновенно.
    const current = Math.max(0, Number(speed ?? creature?.speed ?? 0));
    const canHover = Boolean(creature?.movement?.canHover || ["hover", "swarm", "levitating"].includes(creature?.movement?.profile));
    const requiredAdvance = canHover ? 0 : Math.max(1, current - Number(profile.requiredLoss ?? 2));
    return {
      speed: current,
      effectiveMax,
      acceleration: Number(profile.acceleration ?? 1),
      braking: Number(profile.braking ?? 1),
      requiredAdvance: current > 0 ? Math.min(current, requiredAdvance) : 0,
      safeTurnSpeed: effectiveMax,
      turnDelay: 0,
      turnStep: current > 0 ? 1 : null,
      turnText: "поворот доступен с начала движения",
      massClass: creature?.size ?? "creature",
      profileKey: creature?.movement?.profile ?? "flier",
      profileLabel: profile.label,
      modifiers: [],
      modifiersText: ""
    };
  }

  static getReachableCells(battle, creature, movementApi) {
    if (!creature || creature.flags?.struck || creature.flags?.withdrawn || creature.flags?.falling) return [];
    const speed = Math.max(0, Number(creature.speed ?? 0));
    if (speed <= 0) return [];
    const inertia = this.getInertiaProfile(battle, creature, { speed });
    const turnLimit = Math.min(1, this.getTurnLimit(creature));
    const steering = [0, ...(turnLimit ? [-1, 1] : [])];
    const candidates = [];

    for (const delta of steering) {
      const heading = rotateHeading(creature.heading, delta);
      let current = { x: Number(creature.x ?? 0), y: Number(creature.y ?? 0) };
      const path = [];
      for (let step = 1; step <= speed; step++) {
        const vector = headingToVector(heading, current.x, current.y);
        const x = current.x + vector.dx;
        const y = current.y + vector.dy;
        if (!withinBoard(battle.board, x, y)) break;
        const terrain = movementApi.getTerrain(battle, x, y);
        if (movementApi.isBlockingTerrain(terrain, Number(creature.altitude ?? 0))) break;
        const cell = { x, y, key: cellKey(x, y), step, terrain, heading };
        const conflict = OccupancyEngine.findConflict(battle, creature, cell, { ...current, step: step - 1 });
        if (conflict) break;
        path.push(cell);
        if (step >= inertia.requiredAdvance) {
          candidates.push({
            x, y, key: cell.key, heading, steps: step, terrain,
            requiredAdvance: inertia.requiredAdvance,
            resultingSpeed: step,
            brakingCost: Math.max(0, speed - step),
            steeringDelta: delta,
            turnDelay: 0,
            turnStep: delta ? 1 : null,
            path: path.map(entry => ({ ...entry }))
          });
        }
        current = { x, y };
      }
    }
    const unique = new Map();
    for (const candidate of candidates) if (!unique.has(candidate.key)) unique.set(candidate.key, candidate);
    return [...unique.values()];
  }

  static resolveTurn(creature, delta) {
    const limit = this.getTurnLimit(creature);
    if (limit <= 0) return { ok: false, text: "Повреждения или оглушение не позволяют изменить курс." };
    const before = Number(creature.heading ?? 0);
    creature.heading = rotateHeading(before, Math.max(-limit, Math.min(limit, Number(delta ?? 0))));
    return { ok: true, changed: creature.heading !== before, text: `курс ${before}° → ${creature.heading}°.` };
  }

  static getTurnPreview(creature, delta) {
    const nextHeading = rotateHeading(creature?.heading ?? 0, delta);
    const allowed = this.getTurnLimit(creature) > 0;
    return {
      direction: delta < 0 ? "влево" : "вправо",
      nextHeading,
      severity: allowed ? "normal" : "danger",
      requirement: allowed ? "без проверки" : "поворот заблокирован",
      summary: `${delta < 0 ? "влево" : "вправо"}: курс ${nextHeading}°`,
      notesText: "",
      tooltip: allowed ? `Поворот существа на 60°, новый курс ${nextHeading}°.` : "Существо не может повернуть."
    };
  }

  static getManeuverAdvice(battle, creature) {
    const details = this.getEffectiveMaxSpeedDetails(battle, creature);
    const inertia = this.getInertiaProfile(battle, creature);
    const turnLimit = this.getTurnLimit(creature);
    return {
      inIrons: false,
      canGainSail: Number(creature.speed ?? 0) < details.value,
      turnLimit,
      currentPoint: null,
      effectiveMaxSpeed: details.value,
      safeTurnSpeed: details.value,
      speed: Number(creature.speed ?? 0),
      inertia,
      left: turnLimit ? this.getTurnPreview(creature, -1) : null,
      right: turnLimit ? this.getTurnPreview(creature, 1) : null,
      last: null,
      notice: `${details.profileLabel}. ${details.modifiers.join("; ") || "Полет без дополнительных модификаторов."}`
    };
  }

  static increaseSpeed(battle, creature) {
    const inertia = this.getInertiaProfile(battle, creature);
    const before = Number(creature.speed ?? 0);
    if (before >= inertia.effectiveMax) return { ok: false, before, after: before, effectiveMax: inertia.effectiveMax, acceleration: inertia.acceleration, reason: "Предел скорости достигнут." };
    creature.speed = Math.min(inertia.effectiveMax, before + inertia.acceleration);
    return { ok: creature.speed > before, before, after: creature.speed, effectiveMax: inertia.effectiveMax, acceleration: inertia.acceleration, reason: creature.speed > before ? "" : "Предел скорости достигнут." };
  }

  static reduceSpeed(battle, creature) {
    const inertia = this.getInertiaProfile(battle, creature);
    const before = Number(creature.speed ?? 0);
    creature.speed = Math.max(0, before - inertia.braking);
    return { ok: creature.speed < before, before, after: creature.speed, braking: inertia.braking };
  }

  static applyMoveResult(battle, result, movementApi) {
    if (!result?.ok || !result.creature || !result.candidate) return { ok: false };
    const creature = result.creature;
    const candidate = result.candidate;
    const start = { x: Number(creature.x ?? 0), y: Number(creature.y ?? 0), heading: Number(creature.heading ?? 0), speed: Number(creature.speed ?? 0) };
    creature.speed = Math.min(start.speed, Number(candidate.steps ?? 0));
    const notes = [];
    for (const step of result.path ?? []) {
      const terrain = movementApi.terrainList(step.terrain);
      if (terrain.includes("stormCloud")) {
        const damage = CreatureDamageEngine.applyDamage(creature, 2, { ignoreArmor: true, tags: ["stun"] });
        notes.push(`[${step.x + 1}:${step.y + 1}] грозовое облако: ${damage.penetrating} урона.`);
      }
      if (terrain.includes("turbulence")) {
        creature.flags ??= {};
        creature.flags.stunned = Math.min(20, Number(creature.flags.stunned ?? 0) + 1);
        notes.push(`[${step.x + 1}:${step.y + 1}] турбулентность: оглушение +1.`);
      }
    }
    creature.x = Number(candidate.x);
    creature.y = Number(candidate.y);
    creature.heading = Number(candidate.heading ?? creature.heading ?? 0);
    OccupancyEngine.reserveMovement(battle, creature, result.path ?? [], { startX: start.x, startY: start.y, startHeading: start.heading, stopX: creature.x, stopY: creature.y });
    movementApi.recordMovementEvent?.(battle, creature, { start, path: result.path ?? [], collision: null });
    return {
      ok: true,
      ship: creature,
      candidate,
      start,
      inertia: { before: start.speed, after: creature.speed, traveled: Number(candidate.steps ?? 0), brakingCost: Math.max(0, start.speed - creature.speed) },
      terrain: { notes, text: notes.length ? ` ${notes.join(" ")}` : "" },
      collision: { applied: false, text: "" }
    };
  }

  static verticalManeuver(battle, creature, mode, movementApi) {
    if (!creature || creature.flags?.struck || creature.flags?.withdrawn || creature.flags?.falling || creature.flags?.attachedTo) return { ok: false, reason: "Существо не может менять высоту." };
    const before = Number(creature.altitude ?? 0);
    let amount = mode === "climb" ? Number(creature.movement?.climb ?? 1) : Number(creature.movement?.dive ?? 1);
    const state = this.sectionState(creature);
    if (mode === "climb" && state.destroyedFlight.length) amount = Math.max(0, amount - 1);
    if (amount <= 0) return { ok: false, reason: "Повреждения не позволяют выполнить вертикальный маневр." };
    const after = Math.max(ALTITUDE_MIN, Math.min(ALTITUDE_MAX, before + (mode === "climb" ? amount : -amount)));
    if (after === before) return { ok: false, reason: mode === "climb" ? "Достигнут верхний предел поля." : "Достигнута поверхность." };
    const occupied = OccupancyEngine.findShipAt(battle, creature.x, creature.y, after, { excludeShipId: creature.id });
    if (occupied) return { ok: false, reason: `Высота H${after} занята: ${occupied.name}.` };
    const terrain = movementApi.getTerrain(battle, creature.x, creature.y);
    if (movementApi.isBlockingTerrain(terrain, after)) return { ok: false, reason: `Террейн блокирует высоту H${after}.` };
    creature.altitude = after;
    return { ok: true, before, after, amount: Math.abs(after - before), text: `${mode === "climb" ? "набор высоты" : "снижение"} H${before} → H${after}.` };
  }

  static driftSteps(battle, creature) {
    const strength = battle?.wind?.strength ?? "moderate";
    const rating = WIND_RATING[strength] ?? 2;
    const response = creature?.movement?.windResponse ?? "light";
    if (response === "none" || response === "resistant") return 0;
    if (response === "drifting") return rating >= 4 ? 2 : rating >= 2 ? 1 : 0;
    if (response === "strong") return rating >= 4 ? 1 : 0;
    return rating >= 4 ? 1 : 0;
  }

  static advanceEndOfRound(battle, creature, movementApi, options = {}) {
    if (!creature || creature.flags?.struck || creature.flags?.withdrawn) return [];
    const entries = [];
    if (CreatureGrappleEngine.isAttached(creature)) {
      CreatureGrappleEngine.syncAttached(battle);
      entries.push(...CreatureDamageEngine.advanceEndOfRound(creature, options));
      return entries;
    }
    creature.flags ??= {};
    const canHover = Boolean(creature.movement?.canHover || ["hover", "swarm", "levitating"].includes(creature.movement?.profile));
    if (!canHover && Number(creature.speed ?? 0) <= 0 && Number(creature.altitude ?? 0) > 0) {
      creature.flags.falling = true;
      creature.flags.fallReason = "stall";
      entries.push(`${creature.name}: потеря воздушной скорости приводит к сваливанию.`);
    }

    if (creature.flags.falling) {
      const before = Number(creature.altitude ?? 0);
      creature.altitude = Math.max(0, before - 2);
      entries.push(`${creature.name}: падает H${before} → H${creature.altitude}.`);
      if (creature.altitude <= 0) {
        const impact = this.resolveFallImpact(creature, before);
        entries.push(impact.text);
      }
    } else {
      const steps = this.driftSteps(battle, creature);
      let moved = 0;
      for (let i = 0; i < steps; i++) {
        const vector = headingToVector(battle?.wind?.direction ?? 0, creature.x, creature.y);
        const x = Number(creature.x ?? 0) + vector.dx;
        const y = Number(creature.y ?? 0) + vector.dy;
        if (!withinBoard(battle.board, x, y) || movementApi.isBlockingTerrain(movementApi.getTerrain(battle, x, y), creature.altitude)) break;
        if (OccupancyEngine.findShipAt(battle, x, y, creature.altitude, { excludeShipId: creature.id })) break;
        creature.x = x;
        creature.y = y;
        moved += 1;
      }
      if (moved) entries.push(`${creature.name}: сносится ветром на ${moved} клетк${moved === 1 ? "у" : "и"}.`);
    }
    entries.push(...CreatureDamageEngine.advanceEndOfRound(creature, options));
    return entries;
  }
}
