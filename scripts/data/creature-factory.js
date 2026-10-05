import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { uid } from "../utils/random.js";
import { CreatureNormalizer } from "../normalizers/creature-normalizer.js";

function clone(value) {
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

function section(label, hp, armor = 0, tags = []) {
  return {
    label,
    enabled: true,
    hp: { value: hp, max: hp },
    armor,
    tags,
    status: "intact"
  };
}

export const CREATURE_TEMPLATES = Object.freeze({
  skyRay: Object.freeze({
    id: "skyRay",
    category: "Крупные летуны",
    label: "Воздушный скат",
    description: "Большой парящий хищник, использующий восходящие потоки и широкие крылья.",
    creatureType: "skyRay",
    size: "large",
    maxSpeed: 5,
    altitude: 4,
    token: { img: "", scale: 1.22, tint: "#d7d4c7", silhouette: "ray" },
    stats: { sm: 6, ht: 12, handling: 2, stability: 5, armor: 1 },
    movement: { profile: "glider", windResponse: "strong", canHover: false, turnLimit: 2, climb: 1, dive: 2 },
    vitality: { current: 46, max: 46, morale: 8 },
    sections: {
      head: section("Голова", 8, 1, ["vital", "sense"]),
      body: section("Тело", 18, 2, ["vital", "body"]),
      leftWing: section("Левое крыло", 9, 0, ["flight", "wing"]),
      rightWing: section("Правое крыло", 9, 0, ["flight", "wing"]),
      tail: section("Хвост", 6, 0, ["steering", "tail"])
    },
    attacks: [
      { id: "bite", label: "Укус", type: "natural", arc: "bow", range: 1, damage: 8, cooldown: 0, cooldownMax: 0, radius: 0, tags: ["melee"] },
      { id: "tail", label: "Удар хвостом", type: "natural", arc: "stern", range: 1, damage: 6, cooldown: 0, cooldownMax: 1, radius: 0, tags: ["melee"] }
    ],
    abilities: [
      { id: "thermalSoaring", label: "Парение в потоках", type: "passive", effect: "none", phase: "any", target: "self", power: 0, cooldown: 0, cooldownMax: 0, uses: 0, usesMax: 0, description: "Получает преимущество от восходящих потоков.", tags: ["updraft"] },
      { id: "diveBurst", label: "Пикирующий рывок", type: "active", effect: "dash", phase: "movement", target: "self", power: 2, cooldown: 0, cooldownMax: 2, uses: 0, usesMax: 0, description: "Резко набирает скорость перед атакой.", tags: ["movement"] }
    ],
    behavior: { mode: "predator", controlledByAI: false, preferredRange: 1, aggression: 7, targetPolicy: "nearest" }
  }),
  stormRoc: Object.freeze({
    id: "stormRoc",
    category: "Крупные летуны",
    label: "Грозовой рух",
    description: "Тяжелая хищная птица корабельного размера, способная выдерживать штормовой ветер.",
    creatureType: "stormRoc",
    size: "huge",
    maxSpeed: 6,
    altitude: 5,
    token: { img: "", scale: 1.35, tint: "#c8c1ad", silhouette: "bird" },
    stats: { sm: 7, ht: 14, handling: 1, stability: 7, armor: 2 },
    movement: { profile: "flier", windResponse: "resistant", canHover: false, turnLimit: 2, climb: 2, dive: 3 },
    vitality: { current: 62, max: 62, morale: 9 },
    sections: {
      head: section("Голова", 10, 2, ["vital", "sense"]),
      body: section("Тело", 24, 3, ["vital", "body"]),
      leftWing: section("Левое крыло", 13, 1, ["flight", "wing"]),
      rightWing: section("Правое крыло", 13, 1, ["flight", "wing"]),
      tail: section("Хвост", 8, 1, ["steering", "tail"])
    },
    attacks: [
      { id: "talons", label: "Когти", type: "natural", arc: "bow", range: 1, damage: 10, cooldown: 0, cooldownMax: 0, radius: 0, tags: ["melee", "grapple"] },
      { id: "thunderCry", label: "Грозовой крик", type: "sonic", arc: "bow", range: 3, damage: 5, cooldown: 0, cooldownMax: 3, radius: 1, tags: ["area", "morale"] }
    ],
    abilities: [
      { id: "stormborn", label: "Рожденный бурей", type: "passive", effect: "none", phase: "any", target: "self", power: 0, cooldown: 0, cooldownMax: 0, uses: 0, usesMax: 0, description: "Слабо зависит от силы ветра.", tags: ["storm"] },
      { id: "battleFury", label: "Боевая ярость", type: "active", effect: "rally", phase: "crew", target: "self", power: 3, cooldown: 0, cooldownMax: 3, uses: 0, usesMax: 0, description: "Возвращает волю к бою.", tags: ["morale"] }
    ],
    behavior: { mode: "predator", controlledByAI: false, preferredRange: 1, aggression: 9, targetPolicy: "largest" }
  }),
  cloudJelly: Object.freeze({
    id: "cloudJelly",
    category: "Необычные существа",
    label: "Облачная медуза",
    description: "Медленное левитирующее существо с мягким телом и длинными стрекательными щупальцами.",
    creatureType: "cloudJelly",
    size: "large",
    maxSpeed: 2,
    altitude: 4,
    token: { img: "", scale: 1.18, tint: "#cbd6dc", silhouette: "jelly" },
    stats: { sm: 6, ht: 11, handling: -1, stability: 8, armor: 0 },
    movement: { profile: "levitating", windResponse: "drifting", canHover: true, turnLimit: 3, climb: 1, dive: 1 },
    vitality: { current: 38, max: 38, morale: 6 },
    sections: {
      bell: section("Купол", 22, 1, ["vital", "body", "levitation"]),
      tendrils: section("Щупальца", 16, 0, ["weapon", "limb"])
    },
    attacks: [
      { id: "sting", label: "Стрекание", type: "natural", arc: "all", range: 1, damage: 7, cooldown: 0, cooldownMax: 1, radius: 0, tags: ["melee", "poison"] }
    ],
    abilities: [
      { id: "cloudCamouflage", label: "Облачная маскировка", type: "active", effect: "cloak", phase: "movement", target: "self", power: 2, cooldown: 0, cooldownMax: 3, uses: 0, usesMax: 0, description: "Сливается с облаками и туманом на два раунда.", tags: ["concealment"] },
      { id: "slowRegeneration", label: "Медленная регенерация", type: "passive", effect: "regenerate", phase: "any", target: "self", power: 1, cooldown: 0, cooldownMax: 0, uses: 0, usesMax: 0, description: "Восстанавливает 1 жизненную силу в конце раунда.", tags: ["healing"] }
    ],
    behavior: { mode: "guardian", controlledByAI: false, preferredRange: 1, aggression: 4, targetPolicy: "nearest" }
  }),
  razorSwarm: Object.freeze({
    id: "razorSwarm",
    category: "Стаи",
    label: "Стая резкокрылов",
    description: "Множество мелких летающих хищников, действующих как единая боевая единица.",
    creatureType: "razorSwarm",
    size: "swarm",
    maxSpeed: 5,
    altitude: 3,
    token: { img: "", scale: 1.0, tint: "#b9b7ad", silhouette: "swarm" },
    stats: { sm: 4, ht: 10, handling: 4, stability: 2, armor: 0 },
    movement: { profile: "swarm", windResponse: "light", canHover: true, turnLimit: 1, climb: 1, dive: 1 },
    vitality: { current: 28, max: 28, morale: 7 },
    sections: {
      swarm: section("Стая", 28, 0, ["swarm", "body"])
    },
    attacks: [
      { id: "swarmBite", label: "Налет стаи", type: "natural", arc: "all", range: 1, damage: 6, cooldown: 0, cooldownMax: 0, radius: 0, tags: ["melee", "swarm"] }
    ],
    abilities: [
      { id: "dispersedBody", label: "Рассеянное тело", type: "passive", effect: "none", phase: "any", target: "self", power: 0, cooldown: 0, cooldownMax: 0, uses: 0, usesMax: 0, description: "Стая плохо уязвима для одиночных попаданий.", tags: ["swarm"] },
      { id: "scatter", label: "Рассыпаться", type: "active", effect: "cloak", phase: "movement", target: "self", power: 1, cooldown: 0, cooldownMax: 2, uses: 0, usesMax: 0, description: "Стая рассеивается, затрудняя прицеливание.", tags: ["concealment"] }
    ],
    behavior: { mode: "skirmisher", controlledByAI: false, preferredRange: 1, aggression: 6, targetPolicy: "weakest" }
  })
});

export function getCreatureTemplate(id = "skyRay") {
  return CREATURE_TEMPLATES[id] ?? CREATURE_TEMPLATES.skyRay;
}

export function createCreature(options = {}) {
  const template = clone(getCreatureTemplate(options.template ?? options.creatureType ?? "skyRay"));
  const source = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    unitType: "creature",
    id: options.id ?? uid("creature"),
    name: options.name ?? template.label,
    side: options.side ?? "wild",
    x: options.x ?? 0,
    y: options.y ?? 0,
    heading: options.heading ?? 0,
    altitude: options.altitude ?? template.altitude ?? 3,
    speed: options.speed ?? 0,
    maxSpeed: options.maxSpeed ?? template.maxSpeed ?? 3,
    creatureType: options.creatureType ?? template.creatureType ?? template.id,
    size: options.size ?? template.size ?? "large",
    token: { ...template.token, ...(options.token ?? {}) },
    stats: { ...template.stats, ...(options.stats ?? {}) },
    movement: { ...template.movement, ...(options.movement ?? {}) },
    vitality: { ...template.vitality, ...(options.vitality ?? {}) },
    sections: options.sections ?? template.sections,
    attacks: options.attacks ?? template.attacks,
    abilities: options.abilities ?? template.abilities,
    behavior: { ...(template.behavior ?? {}), ...(options.behavior ?? {}) },
    flags: { rulesPending: false, ...(options.flags ?? {}) },
    turn: { round: 1, actions: {} }
  };
  return CreatureNormalizer.normalize(source, { battleRound: options.battleRound ?? 1 });
}
