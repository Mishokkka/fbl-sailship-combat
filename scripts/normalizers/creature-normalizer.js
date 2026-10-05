import { ALTITUDE_MAX, ALTITUDE_MIN, BOARD_LIMITS, CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { normalizeHeading } from "../board/board-geometry.js";
import { boundedArray, boundedInteger, boundedString, enumValue, finiteNumber, isPlainObject, plainRecord } from "../utils/schema.js";
import { repairUniqueIds } from "../utils/identity.js";
import { SchemaMigrations } from "../migrations/schema-migrations.js";

const SIZE_IDS = Object.freeze(["tiny", "small", "medium", "large", "huge", "swarm"]);
const MOVEMENT_PROFILES = Object.freeze(["flier", "glider", "hover", "stormborn", "swarm", "levitating"]);
const WIND_RESPONSES = Object.freeze(["none", "light", "strong", "resistant", "drifting"]);
const SECTION_STATUSES = Object.freeze(["intact", "damaged", "destroyed", "disabled"]);
const ATTACK_TYPES = Object.freeze(["natural", "breath", "spit", "sonic", "magic", "ram", "other"]);
const ATTACK_ARCS = Object.freeze(["bow", "stern", "port", "starboard", "all"]);
const ABILITY_TYPES = Object.freeze(["active", "passive", "reaction"]);
const ABILITY_EFFECTS = Object.freeze(["none", "heal", "rally", "dash", "cloak", "shockwave", "regenerate", "breakaway"]);
const ABILITY_PHASES = Object.freeze(["any", "movement", "gunnery", "crew"]);
const ABILITY_TARGETS = Object.freeze(["self", "enemy", "area"]);
const BEHAVIOR_MODES = Object.freeze(["manual", "predator", "guardian", "skirmisher", "coward"]);
const TARGET_POLICIES = Object.freeze(["nearest", "weakest", "largest"]);
const SILHOUETTES = Object.freeze(["beast", "bird", "ray", "jelly", "swarm"]);
const FALL_REASONS = Object.freeze(["stall", "flightFailure", "forced"]);

function newId(prefix = "creature") {
  return globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function clone(value) {
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

function normalizeTags(value, max = 16) {
  return [...new Set(boundedArray(value, { maxLength: max }).map(tag => boundedString(tag, { maxLength: 64 })).filter(Boolean))];
}

export class CreatureNormalizer {
  static normalize(creature, { battleRound = 1 } = {}) {
    creature = isPlainObject(creature) ? creature : {};
    SchemaMigrations.migrateCombatant(creature);
    creature.schemaVersion = CURRENT_SCHEMA_VERSION;
    creature.unitType = "creature";
    creature.id = boundedString(creature.id, { fallback: newId("creature"), maxLength: 128 });
    creature.name = boundedString(creature.name, { fallback: "Летающее существо", maxLength: 256 }) || "Летающее существо";
    creature.creatureType = boundedString(creature.creatureType, { fallback: "custom", maxLength: 128 }) || "custom";
    creature.size = enumValue(creature.size, SIZE_IDS, "large");
    creature.side = boundedString(creature.side, { fallback: "wild", maxLength: 64 }) || "wild";
    creature.x = boundedInteger(creature.x, { fallback: 0, min: 0, max: BOARD_LIMITS.maxWidth - 1 });
    creature.y = boundedInteger(creature.y, { fallback: 0, min: 0, max: BOARD_LIMITS.maxHeight - 1 });
    creature.heading = normalizeHeading(creature.heading ?? 0);
    creature.speed = boundedInteger(creature.speed, { fallback: 0, min: 0, max: 20 });
    creature.maxSpeed = boundedInteger(creature.maxSpeed, { fallback: 3, min: 0, max: 20 });
    creature.speed = Math.min(creature.speed, creature.maxSpeed);
    creature.altitude = boundedInteger(creature.altitude, { fallback: 3, min: ALTITUDE_MIN, max: ALTITUDE_MAX });
    creature.verticalVelocity = boundedInteger(creature.verticalVelocity, { fallback: 0, min: -3, max: 3 });

    creature.token = plainRecord(creature.token);
    creature.token.img = boundedString(creature.token.img, { fallback: "", maxLength: 512 });
    creature.token.scale = finiteNumber(creature.token.scale, { fallback: 1, min: 0.35, max: 3 });
    const tint = boundedString(creature.token.tint, { fallback: "#d7d4c7", maxLength: 32 });
    creature.token.tint = /^#[0-9a-f]{3,8}$/i.test(tint) ? tint : "#d7d4c7";
    creature.token.silhouette = enumValue(creature.token.silhouette, SILHOUETTES, "beast");
    creature.token.showName = creature.token.showName !== false;

    creature.stats = plainRecord(creature.stats);
    creature.stats.sm = boundedInteger(creature.stats.sm, { fallback: 5, min: 0, max: 30 });
    creature.stats.ht = boundedInteger(creature.stats.ht, { fallback: 10, min: 1, max: 30 });
    creature.stats.handling = boundedInteger(creature.stats.handling, { fallback: 0, min: -10, max: 10 });
    creature.stats.stability = boundedInteger(creature.stats.stability, { fallback: 4, min: 0, max: 20 });
    creature.stats.armor = boundedInteger(creature.stats.armor, { fallback: 0, min: 0, max: 100 });

    creature.movement = plainRecord(creature.movement);
    creature.movement.profile = enumValue(creature.movement.profile, MOVEMENT_PROFILES, "flier");
    creature.movement.windResponse = enumValue(creature.movement.windResponse, WIND_RESPONSES, "light");
    creature.movement.canHover = Boolean(creature.movement.canHover);
    creature.movement.turnLimit = boundedInteger(creature.movement.turnLimit, { fallback: 2, min: 0, max: 6 });
    creature.movement.climb = boundedInteger(creature.movement.climb, { fallback: 1, min: 0, max: 4 });
    creature.movement.dive = boundedInteger(creature.movement.dive, { fallback: 1, min: 0, max: 4 });

    creature.sections = this.normalizeSections(creature.sections);
    const sectionVitality = Object.values(creature.sections).reduce((sum, section) => sum + Number(section.hp?.max ?? 0), 0);
    creature.vitality = plainRecord(creature.vitality);
    creature.vitality.max = boundedInteger(creature.vitality.max, { fallback: Math.max(1, sectionVitality), min: 1, max: 10000 });
    creature.vitality.current = boundedInteger(creature.vitality.current, { fallback: creature.vitality.max, min: 0, max: creature.vitality.max });
    creature.vitality.morale = boundedInteger(creature.vitality.morale, { fallback: 8, min: 0, max: 10 });

    creature.attacks = this.normalizeAttacks(creature.attacks);
    creature.abilities = this.normalizeAbilities(creature.abilities);

    creature.behavior = plainRecord(creature.behavior);
    creature.behavior.mode = enumValue(creature.behavior.mode, BEHAVIOR_MODES, "manual");
    creature.behavior.controlledByAI = Boolean(creature.behavior.controlledByAI);
    creature.behavior.preferredRange = boundedInteger(creature.behavior.preferredRange, { fallback: 1, min: 1, max: 20 });
    creature.behavior.aggression = boundedInteger(creature.behavior.aggression, { fallback: 5, min: 0, max: 10 });
    creature.behavior.targetPolicy = enumValue(creature.behavior.targetPolicy, TARGET_POLICIES, "nearest");

    creature.flags = plainRecord(creature.flags);
    creature.flags.rulesPending = false;
    creature.flags.struck = Boolean(creature.flags.struck);
    creature.flags.withdrawn = Boolean(creature.flags.withdrawn);
    creature.flags.falling = Boolean(creature.flags.falling);
    creature.flags.fallReason = creature.flags.falling
      ? enumValue(creature.flags.fallReason, FALL_REASONS, this.inferFallReason(creature))
      : null;
    creature.flags.burning = Boolean(creature.flags.burning);
    creature.flags.bleeding = boundedInteger(creature.flags.bleeding, { fallback: 0, min: 0, max: 20 });
    creature.flags.stunned = boundedInteger(creature.flags.stunned, { fallback: 0, min: 0, max: 20 });
    creature.flags.camouflaged = boundedInteger(creature.flags.camouflaged, { fallback: 0, min: 0, max: 20 });
    creature.flags.attachedTo = creature.flags.attachedTo == null ? null : boundedString(creature.flags.attachedTo, { maxLength: 128 });

    creature.turn = plainRecord(creature.turn);
    creature.turn.round = boundedInteger(creature.turn.round, { fallback: battleRound, min: 1, max: 1_000_000 });
    creature.turn.actions = plainRecord(creature.turn.actions);
    return creature;
  }

  static inferFallReason(creature) {
    const sections = Object.values(creature?.sections ?? {}).filter(section => section?.enabled !== false);
    const flight = sections.filter(section => section.tags?.some?.(tag => ["flight", "wing", "levitation"].includes(tag)));
    if (flight.length && flight.every(section => Number(section?.hp?.value ?? 0) <= 0 || section.status === "destroyed")) return "flightFailure";
    return "stall";
  }

  static normalizeSections(raw) {
    const source = isPlainObject(raw) && Object.keys(raw).length ? raw : {
      body: { label: "Тело", enabled: true, hp: { value: 20, max: 20 }, armor: 0, tags: ["vital", "body"], status: "intact" }
    };
    const sections = {};
    for (const [rawId, value] of Object.entries(source).slice(0, 32)) {
      const id = boundedString(rawId, { fallback: newId("section"), maxLength: 128 });
      if (!id || sections[id]) continue;
      const section = plainRecord(value);
      section.label = boundedString(section.label, { fallback: id, maxLength: 128 }) || id;
      section.enabled = section.enabled !== false;
      section.hp = plainRecord(section.hp);
      section.hp.max = boundedInteger(section.hp.max, { fallback: 10, min: 1, max: 10000 });
      section.hp.value = boundedInteger(section.hp.value, { fallback: section.hp.max, min: 0, max: section.hp.max });
      section.armor = boundedInteger(section.armor, { fallback: 0, min: 0, max: 100 });
      section.tags = normalizeTags(section.tags);
      section.status = enumValue(section.status, SECTION_STATUSES, section.hp.value <= 0 ? "destroyed" : "intact");
      if (section.hp.value <= 0) section.status = "destroyed";
      sections[id] = section;
    }
    return sections;
  }

  static normalizeAttacks(raw) {
    const attacks = boundedArray(raw, { maxLength: 100 }).filter(isPlainObject).map((source, index) => {
      const attack = plainRecord(source);
      return {
        id: boundedString(attack.id, { fallback: `attack-${index + 1}`, maxLength: 128 }),
        label: boundedString(attack.label, { fallback: `Атака ${index + 1}`, maxLength: 128 }) || `Атака ${index + 1}`,
        type: enumValue(attack.type, ATTACK_TYPES, "natural"),
        arc: enumValue(attack.arc, ATTACK_ARCS, "bow"),
        range: boundedInteger(attack.range, { fallback: 1, min: 1, max: 100 }),
        damage: boundedInteger(attack.damage, { fallback: 1, min: 1, max: 1000 }),
        cooldownMax: boundedInteger(attack.cooldownMax, { fallback: 0, min: 0, max: 100 }),
        cooldown: boundedInteger(attack.cooldown, { fallback: 0, min: 0, max: boundedInteger(attack.cooldownMax, { fallback: 0, min: 0, max: 100 }) }),
        radius: boundedInteger(attack.radius, { fallback: attack.tags?.includes?.("area") ? 1 : 0, min: 0, max: 20 }),
        tags: normalizeTags(attack.tags)
      };
    });
    repairUniqueIds(attacks, { prefix: "attack", maxLength: 128 });
    return attacks;
  }

  static normalizeAbilities(raw) {
    const abilities = boundedArray(raw, { maxLength: 100 }).filter(isPlainObject).map((source, index) => {
      const ability = plainRecord(source);
      const cooldownMax = boundedInteger(ability.cooldownMax, { fallback: 0, min: 0, max: 100 });
      const usesMax = boundedInteger(ability.usesMax, { fallback: 0, min: 0, max: 100 });
      return {
        id: boundedString(ability.id, { fallback: `ability-${index + 1}`, maxLength: 128 }),
        label: boundedString(ability.label, { fallback: `Способность ${index + 1}`, maxLength: 128 }) || `Способность ${index + 1}`,
        type: enumValue(ability.type, ABILITY_TYPES, "passive"),
        effect: enumValue(ability.effect, ABILITY_EFFECTS, "none"),
        phase: enumValue(ability.phase, ABILITY_PHASES, ability.type === "active" ? "gunnery" : "any"),
        target: enumValue(ability.target, ABILITY_TARGETS, "self"),
        range: boundedInteger(ability.range, { fallback: 0, min: 0, max: 100 }),
        radius: boundedInteger(ability.radius, { fallback: 1, min: 0, max: 20 }),
        power: boundedInteger(ability.power, { fallback: 1, min: 0, max: 1000 }),
        cooldownMax,
        cooldown: boundedInteger(ability.cooldown, { fallback: 0, min: 0, max: cooldownMax }),
        usesMax,
        uses: boundedInteger(ability.uses, { fallback: usesMax, min: 0, max: usesMax || 100 }),
        description: boundedString(ability.description, { fallback: "", maxLength: 2000 }),
        tags: normalizeTags(ability.tags)
      };
    });
    repairUniqueIds(abilities, { prefix: "ability", maxLength: 128 });
    return abilities;
  }

  static cleanForLibrary(creature) {
    const clean = this.normalize(clone(creature ?? {}), { battleRound: 1 });
    clean.id = boundedString(clean.id, { fallback: newId("creature-template"), maxLength: 128 });
    clean.x = 0;
    clean.y = 0;
    clean.heading = 0;
    clean.speed = 0;
    clean.verticalVelocity = 0;
    clean.vitality.current = clean.vitality.max;
    for (const section of Object.values(clean.sections)) {
      section.hp.value = section.hp.max;
      section.status = "intact";
    }
    for (const attack of clean.attacks) attack.cooldown = 0;
    for (const ability of clean.abilities) {
      ability.cooldown = 0;
      ability.uses = ability.usesMax;
    }
    clean.flags = { rulesPending: false, struck: false, withdrawn: false, falling: false, fallReason: null, burning: false, bleeding: 0, stunned: 0, camouflaged: 0, attachedTo: null };
    clean.turn = { round: 1, actions: {} };
    return clean;
  }
}
