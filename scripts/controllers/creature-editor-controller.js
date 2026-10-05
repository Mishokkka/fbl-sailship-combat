import { ALTITUDE_MAX, ALTITUDE_MIN } from "../utils/constants.js";
import { CreatureNormalizer } from "../normalizers/creature-normalizer.js";

export class CreatureEditorController {
  constructor(root) {
    this.root = root;
  }

  applyEdits(creature) {
    const oldName = creature.name;
    creature.name = String(this.get("name") ?? creature.name).trim() || creature.name;
    creature.creatureType = String(this.get("creatureType") ?? creature.creatureType ?? "custom").trim() || "custom";
    creature.size = String(this.get("size") ?? creature.size ?? "large");
    creature.maxSpeed = Math.round(this.clamp(this.get("maxSpeed"), 0, 20, Number(creature.maxSpeed ?? 3)));
    creature.speed = Math.min(Number(creature.speed ?? 0), creature.maxSpeed);
    creature.altitude = Math.round(this.clamp(this.get("altitude"), ALTITUDE_MIN, ALTITUDE_MAX, Number(creature.altitude ?? 3)));

    creature.token ??= {};
    creature.token.img = String(this.get("tokenImg") ?? creature.token.img ?? "").trim().slice(0, 512);
    creature.token.scale = this.clamp(this.get("tokenScale"), 0.35, 3, Number(creature.token.scale ?? 1));
    creature.token.tint = String(this.get("tokenTint") ?? creature.token.tint ?? "#d7d4c7").trim().slice(0, 32) || "#d7d4c7";
    creature.token.silhouette = String(this.get("silhouette") ?? creature.token.silhouette ?? "beast");
    creature.token.showName = this.getChecked("showName", creature.token.showName !== false);

    creature.stats ??= {};
    creature.stats.sm = Math.round(this.clamp(this.get("sm"), 0, 30, Number(creature.stats.sm ?? 5)));
    creature.stats.ht = Math.round(this.clamp(this.get("ht"), 1, 30, Number(creature.stats.ht ?? 10)));
    creature.stats.handling = Math.round(this.clamp(this.get("handling"), -10, 10, Number(creature.stats.handling ?? 0)));
    creature.stats.stability = Math.round(this.clamp(this.get("stability"), 0, 20, Number(creature.stats.stability ?? 4)));
    creature.stats.armor = Math.round(this.clamp(this.get("armor"), 0, 100, Number(creature.stats.armor ?? 0)));

    creature.movement ??= {};
    creature.movement.profile = String(this.get("movementProfile") ?? creature.movement.profile ?? "flier");
    creature.movement.windResponse = String(this.get("windResponse") ?? creature.movement.windResponse ?? "light");
    creature.movement.canHover = this.getChecked("canHover", Boolean(creature.movement.canHover));
    creature.movement.turnLimit = Math.round(this.clamp(this.get("turnLimit"), 0, 6, Number(creature.movement.turnLimit ?? 2)));
    creature.movement.climb = Math.round(this.clamp(this.get("climb"), 0, 4, Number(creature.movement.climb ?? 1)));
    creature.movement.dive = Math.round(this.clamp(this.get("dive"), 0, 4, Number(creature.movement.dive ?? 1)));

    creature.vitality ??= {};
    creature.vitality.max = Math.round(this.clamp(this.get("vitalityMax"), 1, 10000, Number(creature.vitality.max ?? 20)));
    creature.vitality.current = Math.round(this.clamp(this.get("vitalityCurrent"), 0, creature.vitality.max, Number(creature.vitality.current ?? creature.vitality.max)));
    creature.vitality.morale = Math.round(this.clamp(this.get("morale"), 0, 10, Number(creature.vitality.morale ?? 8)));

    creature.behavior ??= {};
    creature.behavior.mode = String(this.get("behaviorMode") ?? creature.behavior.mode ?? "manual");
    creature.behavior.controlledByAI = this.getChecked("controlledByAI", Boolean(creature.behavior.controlledByAI));
    creature.behavior.preferredRange = Math.round(this.clamp(this.get("preferredRange"), 1, 20, Number(creature.behavior.preferredRange ?? 1)));
    creature.behavior.aggression = Math.round(this.clamp(this.get("aggression"), 0, 10, Number(creature.behavior.aggression ?? 5)));
    creature.behavior.targetPolicy = String(this.get("targetPolicy") ?? creature.behavior.targetPolicy ?? "nearest");

    this.applySectionEdits(creature);
    this.applyAttackEdits(creature);
    this.applyAbilityEdits(creature);

    const normalized = CreatureNormalizer.normalize(creature, { battleRound: creature.turn?.round ?? 1 });
    for (const key of Object.keys(creature)) delete creature[key];
    Object.assign(creature, normalized);
    return { oldName, newName: creature.name, renamed: oldName !== creature.name };
  }

  applySectionEdits(creature) {
    for (const [sectionId, section] of Object.entries(creature.sections ?? {})) {
      const get = field => this.findScoped("creatureSectionEdit", field, "sectionId", sectionId)?.value;
      const checked = field => this.findScoped("creatureSectionEdit", field, "sectionId", sectionId)?.checked;
      section.label = String(get("label") ?? section.label ?? sectionId).trim() || sectionId;
      section.enabled = checked("enabled") ?? section.enabled !== false;
      section.hp ??= { value: 1, max: 1 };
      section.hp.max = Math.round(this.clamp(get("hpMax"), 1, 10000, Number(section.hp.max ?? 1)));
      section.hp.value = Math.round(this.clamp(get("hpValue"), 0, section.hp.max, Number(section.hp.value ?? section.hp.max)));
      section.armor = Math.round(this.clamp(get("armor"), 0, 100, Number(section.armor ?? 0)));
      section.tags = String(get("tags") ?? (section.tags ?? []).join(", "))
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)
        .slice(0, 16);
      section.status = String(get("status") ?? section.status ?? "intact");
    }
  }

  applyAttackEdits(creature) {
    for (const attack of creature.attacks ?? []) {
      const get = field => this.findScoped("creatureAttackEdit", field, "attackId", attack.id)?.value;
      attack.label = String(get("label") ?? attack.label ?? attack.id).trim() || attack.id;
      attack.type = String(get("type") ?? attack.type ?? "natural");
      attack.arc = String(get("arc") ?? attack.arc ?? "bow");
      attack.range = Math.round(this.clamp(get("range"), 1, 100, Number(attack.range ?? 1)));
      attack.damage = Math.round(this.clamp(get("damage"), 1, 1000, Number(attack.damage ?? 1)));
      attack.cooldownMax = Math.round(this.clamp(get("cooldownMax"), 0, 100, Number(attack.cooldownMax ?? 0)));
      attack.radius = Math.round(this.clamp(get("radius"), 0, 20, Number(attack.radius ?? 0)));
      attack.cooldown = Math.min(Number(attack.cooldown ?? 0), attack.cooldownMax);
      attack.tags = String(get("tags") ?? (attack.tags ?? []).join(", ")).split(",").map(value => value.trim()).filter(Boolean).slice(0, 16);
    }
  }

  applyAbilityEdits(creature) {
    for (const ability of creature.abilities ?? []) {
      const get = field => this.findScoped("creatureAbilityEdit", field, "abilityId", ability.id)?.value;
      ability.label = String(get("label") ?? ability.label ?? ability.id).trim() || ability.id;
      ability.type = String(get("type") ?? ability.type ?? "passive");
      ability.effect = String(get("effect") ?? ability.effect ?? "none");
      ability.phase = String(get("phase") ?? ability.phase ?? "any");
      ability.target = String(get("target") ?? ability.target ?? "self");
      ability.range = Math.round(this.clamp(get("range"), 0, 100, Number(ability.range ?? 0)));
      ability.radius = Math.round(this.clamp(get("radius"), 0, 20, Number(ability.radius ?? 1)));
      ability.power = Math.round(this.clamp(get("power"), 0, 1000, Number(ability.power ?? 1)));
      ability.cooldownMax = Math.round(this.clamp(get("cooldownMax"), 0, 100, Number(ability.cooldownMax ?? 0)));
      ability.cooldown = Math.min(Number(ability.cooldown ?? 0), ability.cooldownMax);
      ability.usesMax = Math.round(this.clamp(get("usesMax"), 0, 100, Number(ability.usesMax ?? 0)));
      ability.uses = ability.usesMax > 0 ? Math.min(Number(ability.uses ?? ability.usesMax), ability.usesMax) : 0;
      ability.description = String(get("description") ?? ability.description ?? "").trim().slice(0, 2000);
      ability.tags = String(get("tags") ?? (ability.tags ?? []).join(", ")).split(",").map(value => value.trim()).filter(Boolean).slice(0, 16);
    }
  }

  resetCombatState(creature) {
    creature.vitality ??= {};
    creature.vitality.current = Number(creature.vitality.max ?? 1);
    creature.vitality.morale = Math.max(0, Math.min(10, Number(creature.vitality.morale ?? 8)));
    for (const section of Object.values(creature.sections ?? {})) {
      section.hp ??= { value: 1, max: 1 };
      section.hp.value = section.hp.max;
      section.status = "intact";
    }
    for (const attack of creature.attacks ?? []) attack.cooldown = 0;
    for (const ability of creature.abilities ?? []) { ability.cooldown = 0; ability.uses = ability.usesMax; }
    creature.flags = {
      rulesPending: false,
      struck: false,
      withdrawn: false,
      falling: false,
      burning: false,
      bleeding: 0,
      stunned: 0,
      camouflaged: 0,
      attachedTo: null
    };
    creature.verticalVelocity = 0;
    creature.turn = { round: 1, actions: {} };
  }


  findScoped(fieldDataset, field, idDataset, id) {
    return [...this.root.querySelectorAll(`[data-${this.toKebab(fieldDataset)}="${field}"]`)]
      .find(node => String(node.dataset?.[idDataset] ?? "") === String(id ?? ""));
  }

  toKebab(value) {
    return String(value ?? "").replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  }

  get(name) {
    return this.root.querySelector(`[data-creature-edit="${name}"]`)?.value;
  }

  getChecked(name, fallback = false) {
    return this.root.querySelector(`[data-creature-edit="${name}"]`)?.checked ?? fallback;
  }

  clamp(value, min, max, fallback) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  }
}
