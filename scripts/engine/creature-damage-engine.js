import { angleBetween, bearingBetween } from "../board/board-geometry.js";
import { chance, randomChoice } from "../utils/random.js";

function hasTag(section, tag) {
  return Array.isArray(section?.tags) && section.tags.includes(tag);
}

function sectionEntries(creature, predicate = null) {
  return Object.entries(creature?.sections ?? {})
    .filter(([, section]) => section?.enabled !== false)
    .filter(([, section]) => !predicate || predicate(section));
}

export class CreatureDamageEngine {
  static getSection(creature, sectionId = null) {
    if (!creature) return { id: null, section: null };
    if (sectionId && creature.sections?.[sectionId]) return { id: sectionId, section: creature.sections[sectionId] };
    const first = sectionEntries(creature, section => Number(section?.hp?.value ?? 0) > 0)[0] ?? sectionEntries(creature)[0] ?? [null, null];
    return { id: first[0], section: first[1] };
  }

  static chooseDirectionalSection(attacker, creature, { random = Math.random } = {}) {
    const entries = sectionEntries(creature, section => Number(section?.hp?.value ?? 0) > 0);
    if (!entries.length) return Object.keys(creature?.sections ?? {})[0] ?? null;
    const incoming = bearingBetween(creature, attacker);
    const delta = angleBetween(creature?.heading ?? 0, incoming);

    const candidates = [];
    if (delta <= 45) candidates.push(...entries.filter(([, section]) => hasTag(section, "head") || hasTag(section, "sense")));
    else if (delta >= 135) candidates.push(...entries.filter(([, section]) => hasTag(section, "tail") || hasTag(section, "steering")));
    else candidates.push(...entries.filter(([, section]) => hasTag(section, "wing") || hasTag(section, "limb")));

    const pool = candidates.length ? candidates : entries.filter(([, section]) => hasTag(section, "body") || hasTag(section, "vital"));
    return (randomChoice(pool.length ? pool : entries, random) ?? entries[0])[0];
  }

  static chooseSectionForAmmo(creature, result, { random = Math.random } = {}) {
    const aimed = result?.aimedSection;
    if (aimed && creature?.sections?.[aimed]) return aimed;
    if (result?.targetSection && creature?.sections?.[result.targetSection]) return result.targetSection;
    const ammo = result?.ammo ?? result?.battery?.ammo ?? "roundShot";
    if (ammo === "chainShot") {
      const wings = sectionEntries(creature, section => hasTag(section, "wing") && Number(section?.hp?.value ?? 0) > 0);
      if (wings.length) return (randomChoice(wings, random) ?? wings[0])[0];
    }
    if (ammo === "grapeShot") {
      const exposed = sectionEntries(creature, section => !hasTag(section, "body") && Number(section?.hp?.value ?? 0) > 0);
      if (exposed.length) return (randomChoice(exposed, random) ?? exposed[0])[0];
    }
    return this.chooseDirectionalSection(result?.attacker, creature, { random });
  }

  static armorFor(creature, section, options = {}) {
    const natural = Number(creature?.stats?.armor ?? 0);
    const local = Number(section?.armor ?? 0);
    let armor = Math.max(natural, local);
    if (options.ignoreArmor) armor = 0;
    else if (options.halfArmor) armor = Math.floor(armor / 2);
    return Math.max(0, armor);
  }

  static applyDamage(creature, amount, options = {}) {
    if (!creature || creature.unitType !== "creature") return { ok: false, text: "Цель не является существом." };
    const selected = this.getSection(creature, options.sectionId);
    if (!selected.section) return { ok: false, text: `${creature.name}: нет доступной анатомической секции.` };

    const raw = Math.max(0, Math.floor(Number(amount ?? 0)));
    const armor = this.armorFor(creature, selected.section, options);
    const penetrating = Math.max(0, raw - armor);
    const beforeSection = Number(selected.section.hp?.value ?? 0);
    const beforeVitality = Number(creature.vitality?.current ?? 0);
    selected.section.hp ??= { value: 0, max: 0 };
    selected.section.hp.value = Math.max(0, beforeSection - penetrating);
    creature.vitality ??= { current: 0, max: 1, morale: 0 };
    creature.vitality.current = Math.max(0, beforeVitality - penetrating);

    if (selected.section.hp.value <= 0) selected.section.status = "destroyed";
    else if (selected.section.hp.value <= Math.ceil(Number(selected.section.hp.max ?? 1) / 2)) selected.section.status = "damaged";
    else selected.section.status = "intact";

    creature.flags ??= {};
    const tags = new Set(options.tags ?? []);
    if (penetrating > 0 && (tags.has("bleed") || options.bleeding)) {
      const severity = Math.max(1, Math.ceil(penetrating / 8));
      creature.flags.bleeding = Math.min(20, Number(creature.flags.bleeding ?? 0) + severity);
    }
    if (penetrating > 0 && (tags.has("fire") || options.burning)) creature.flags.burning = true;
    if (penetrating > 0 && (tags.has("stun") || options.stun)) {
      creature.flags.stunned = Math.min(20, Number(creature.flags.stunned ?? 0) + Math.max(1, Number(options.stun ?? 1)));
    }

    const impactMoraleLoss = penetrating >= 12 ? 2 : penetrating >= 5 ? 1 : 0;
    const moraleLoss = Math.max(impactMoraleLoss, Math.max(0, Number(options.moraleDamage ?? 0)));
    if (moraleLoss) creature.vitality.morale = Math.max(0, Number(creature.vitality.morale ?? 0) - moraleLoss);

    const consequences = this.updateConsequences(creature, selected.id);
    const armorText = armor ? ` после брони ${armor}` : "";
    const stateText = [
      creature.flags.bleeding ? `кровотечение ${creature.flags.bleeding}` : "",
      creature.flags.stunned ? `оглушение ${creature.flags.stunned}` : "",
      creature.flags.burning ? "горит" : "",
      creature.flags.falling ? "падает" : ""
    ].filter(Boolean).join(", ");
    return {
      ok: true,
      creature,
      sectionId: selected.id,
      section: selected.section,
      raw,
      armor,
      penetrating,
      text: `${creature.name}: ${selected.section.label ?? selected.id} получает ${penetrating}${armorText}; секция ${beforeSection} → ${selected.section.hp.value}, жизненная сила ${beforeVitality} → ${creature.vitality.current}.${consequences.text}${stateText ? ` Состояния: ${stateText}.` : ""}`
    };
  }

  static updateConsequences(creature, changedSectionId = null) {
    creature.flags ??= {};
    const sections = sectionEntries(creature);
    const destroyed = sections.filter(([, section]) => Number(section?.hp?.value ?? 0) <= 0 || section?.status === "destroyed");
    const flightSections = sections.filter(([, section]) => hasTag(section, "flight") || hasTag(section, "wing") || hasTag(section, "levitation"));
    const intactFlight = flightSections.filter(([, section]) => Number(section?.hp?.value ?? 0) > 0 && section?.status !== "destroyed");
    const vitalDestroyed = destroyed.some(([, section]) => hasTag(section, "vital") || hasTag(section, "body"));
    const headDestroyed = destroyed.some(([, section]) => hasTag(section, "head") || hasTag(section, "sense"));
    const steeringDestroyed = destroyed.some(([, section]) => hasTag(section, "steering") || hasTag(section, "tail"));
    const messages = [];

    if (flightSections.length && !intactFlight.length && Number(creature.altitude ?? 0) > 0) {
      creature.flags.falling = true;
      creature.flags.fallReason = "flightFailure";
      creature.speed = 0;
      messages.push(" Несущие органы уничтожены: начинается падение.");
    }
    if (headDestroyed && !creature.flags.struck) {
      creature.flags.stunned = Math.max(2, Number(creature.flags.stunned ?? 0));
      messages.push(" Голова тяжело повреждена: оглушение.");
    }
    if (steeringDestroyed) messages.push(" Орган управления уничтожен: маневренность снижена.");
    if (vitalDestroyed || Number(creature.vitality?.current ?? 0) <= 0) {
      creature.flags.struck = true;
      creature.speed = 0;
      messages.push(" Существо смертельно ранено и выбывает из боя.");
    } else if (Number(creature.vitality?.morale ?? 0) <= 0) {
      creature.flags.withdrawn = true;
      creature.speed = 0;
      messages.push(" Существо обращается в бегство и покидает бой.");
    }

    return { changedSectionId, text: messages.join("") };
  }

  static applyGunneryAttackResult(result, { random = Math.random } = {}) {
    if (!result?.hit || result?.target?.unitType !== "creature") return null;
    const ammo = result.ammo ?? result.battery?.ammo ?? "roundShot";
    const sectionId = this.chooseSectionForAmmo(result.target, result, { random });
    let amount = Number(result.damage ?? 0);
    const options = { sectionId, tags: [] };
    if (result.target.size === "swarm" && !["grapeShot", "shellBomb"].includes(ammo)) amount = Math.max(1, Math.ceil(amount * 0.55));

    if (ammo === "chainShot") {
      amount = Math.ceil(amount * 1.45);
      options.halfArmor = true;
      options.tags.push("bleed");
    } else if (ammo === "grapeShot") {
      amount = Math.ceil(amount * (result.target.size === "swarm" ? 2.2 : 1.35));
      options.halfArmor = true;
      options.tags.push("bleed");
    } else if (ammo === "shellBomb") {
      amount = Math.ceil(amount * 1.15);
      options.tags.push("stun", "fire");
      options.stun = 1;
    } else if (ammo === "heatedShot") {
      options.tags.push("fire", "bleed");
      options.burning = true;
    } else {
      options.tags.push("bleed");
    }

    const primary = this.applyDamage(result.target, amount, options);
    const notes = [primary?.text].filter(Boolean);
    if (ammo === "shellBomb" && primary?.penetrating > 0) {
      const others = sectionEntries(result.target, section => section !== primary.section && Number(section?.hp?.value ?? 0) > 0);
      const splash = randomChoice(others, random);
      if (splash) {
        const secondary = this.applyDamage(result.target, Math.max(1, Math.ceil(primary.penetrating / 3)), { sectionId: splash[0], ignoreArmor: true, tags: ["stun"] });
        if (secondary?.text) notes.push(`Осколки: ${secondary.text}`);
      }
    }
    return { ...primary, ammo, text: notes.join(" ") };
  }

  static advanceEndOfRound(creature, { random = Math.random } = {}) {
    if (!creature || creature.unitType !== "creature" || creature.flags?.struck || creature.flags?.withdrawn) return [];
    const entries = [];
    creature.flags ??= {};

    const bleeding = Number(creature.flags.bleeding ?? 0);
    if (bleeding > 0) {
      const living = sectionEntries(creature, section => Number(section?.hp?.value ?? 0) > 0);
      const chosen = randomChoice(living, random) ?? living[0];
      const section = this.getSection(creature, chosen?.[0]);
      const damage = Math.max(1, Math.ceil(bleeding / 2));
      const result = this.applyDamage(creature, damage, { sectionId: section.id, ignoreArmor: true });
      creature.flags.bleeding = Math.max(0, bleeding - 1);
      entries.push(`${creature.name}: кровотечение наносит ${damage} урона; интенсивность ${bleeding} → ${creature.flags.bleeding}.${result?.penetrating ? "" : ""}`);
    }

    if (creature.flags.burning) {
      const result = this.applyDamage(creature, 3, { ignoreArmor: true, tags: ["stun"] });
      entries.push(`${creature.name}: огонь наносит 3 урона.${result?.section ? ` Поражена секция «${result.section.label}».` : ""}`);
      if (chance(0.35, random)) {
        creature.flags.burning = false;
        entries.push(`${creature.name}: пламя гаснет в воздушном потоке.`);
      }
    }

    if (Number(creature.flags.stunned ?? 0) > 0) {
      creature.flags.stunned = Math.max(0, Number(creature.flags.stunned) - 1);
      entries.push(`${creature.name}: оглушение уменьшается до ${creature.flags.stunned}.`);
    }
    this.updateConsequences(creature);
    return entries;
  }

  static recover(creature, mode = "steady") {
    if (!creature || creature.unitType !== "creature") return { ok: false, text: "Существо не выбрано." };
    creature.flags ??= {};
    if (mode === "stopBleeding") {
      const before = Number(creature.flags.bleeding ?? 0);
      creature.flags.bleeding = Math.max(0, before - 2);
      return { ok: before > creature.flags.bleeding, text: `${creature.name}: кровотечение ${before} → ${creature.flags.bleeding}.` };
    }
    if (mode === "shakeOff") {
      const before = Number(creature.flags.stunned ?? 0);
      creature.flags.stunned = Math.max(0, before - 2);
      return { ok: before > creature.flags.stunned, text: `${creature.name}: оглушение ${before} → ${creature.flags.stunned}.` };
    }
    if (mode === "extinguish") {
      const before = Boolean(creature.flags.burning);
      creature.flags.burning = false;
      return { ok: before, text: `${creature.name}: сбивает с себя пламя.` };
    }
    const before = Number(creature.vitality?.morale ?? 0);
    creature.vitality.morale = Math.min(10, before + 2);
    return { ok: creature.vitality.morale > before, text: `${creature.name}: приходит в себя, мораль ${before} → ${creature.vitality.morale}.` };
  }
}
