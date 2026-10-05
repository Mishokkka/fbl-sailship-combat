import { ALTITUDE_MAX, ALTITUDE_MIN, BOARD_LIMITS, CURRENT_SCHEMA_VERSION, TERRAIN_TYPES } from "../utils/constants.js";
import { isPlainObject, jsonSize } from "../utils/schema.js";
import { assertUniqueIds } from "../utils/identity.js";

const MAX_IMPORT_BYTES = 2_000_000;
const MAX_SHIPS = 200;
const MAX_SECTIONS = 32;
const MAX_SYSTEMS_PER_SECTION = 100;
const MAX_WEAPONS = 100;

function isObject(value) {
  return isPlainObject(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNumber(value, message, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false } = {}) {
  const number = Number(value);
  assert(Number.isFinite(number) && (!integer || Number.isInteger(number)) && number >= min && number <= max, message);
}

function validateOptionalNumber(owner, field, label, options = {}) {
  if (owner?.[field] == null) return;
  assertNumber(owner[field], `${label}: поле ${field} содержит недопустимое число.`, options);
}

export class ImportValidationService {
  static parseJson(raw, label = "JSON") {
    assert(typeof raw === "string", `${label}: ожидалась строка JSON.`);
    assert(jsonSize(raw) <= MAX_IMPORT_BYTES, `${label}: файл слишком велик, максимум ${Math.round(MAX_IMPORT_BYTES / 1_000_000)} МБ.`);
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`${label}: не удалось разобрать JSON.`);
    }
  }



  static assertSupportedSchema(data, { label = "Данные", allowFuture = false } = {}) {
    const version = Number(data?.schemaVersion ?? 0);
    if (!Number.isFinite(version) || version <= 0) return 0;
    if (version > CURRENT_SCHEMA_VERSION && !allowFuture) {
      throw new Error(`${label}: схема v${version} новее поддерживаемой v${CURRENT_SCHEMA_VERSION}. Обновите модуль перед импортом.`);
    }
    return version;
  }

  static getSchemaWarning(data, { label = "Данные" } = {}) {
    const version = Number(data?.schemaVersion ?? 0);
    if (!Number.isFinite(version) || version <= 0) {
      return `${label}: старая схема без schemaVersion. Данные будут мигрированы при сохранении.`;
    }
    if (version < CURRENT_SCHEMA_VERSION) {
      return `${label}: старая схема v${version}. Данные будут мигрированы до v${CURRENT_SCHEMA_VERSION}.`;
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      return `${label}: схема v${version} новее текущей v${CURRENT_SCHEMA_VERSION}.`;
    }
    return null;
  }

  static validateBoard(board) {
    assert(isObject(board), "Бой не содержит объект board.");
    const width = Number(board.width ?? 0);
    const height = Number(board.height ?? 0);
    const cellSize = Number(board.cellSize ?? BOARD_LIMITS.defaultCellSize);
    assert(Number.isInteger(width) && width >= BOARD_LIMITS.minWidth && width <= BOARD_LIMITS.maxWidth, `Ширина поля должна быть целым числом от ${BOARD_LIMITS.minWidth} до ${BOARD_LIMITS.maxWidth}.`);
    assert(Number.isInteger(height) && height >= BOARD_LIMITS.minHeight && height <= BOARD_LIMITS.maxHeight, `Высота поля должна быть целым числом от ${BOARD_LIMITS.minHeight} до ${BOARD_LIMITS.maxHeight}.`);
    assert(Number.isInteger(cellSize) && cellSize >= BOARD_LIMITS.minCellSize && cellSize <= BOARD_LIMITS.maxCellSize, `Размер клетки должен быть целым числом от ${BOARD_LIMITS.minCellSize} до ${BOARD_LIMITS.maxCellSize} пикселей.`);
    this.validateBoardBackground(board.background);
  }

  static validateBoardBackground(background) {
    if (background == null) return;
    assert(isObject(background), "Фон поля board.background должен быть объектом.");
    if (background.src != null) assert(String(background.src).length <= 512, "Путь к фоновой текстуре поля слишком длинный.");
    if (background.opacity != null) assert(Number.isFinite(Number(background.opacity)), "Прозрачность фоновой текстуры должна быть числом.");
    if (background.tileSize != null) assert(Number.isFinite(Number(background.tileSize)), "Размер плитки фоновой текстуры должен быть числом.");
  }

  static validateShip(ship, { label = "Корабль", board = null } = {}) {
    assert(isObject(ship), `${label}: данные корабля должны быть объектом.`);
    const unitType = String(ship.unitType ?? "ship");
    assert(unitType === "ship", `${label}: ожидался unitType=ship, получено ${unitType}.`);
    this.assertSupportedSchema(ship, { label });
    if (ship.id != null) assert(String(ship.id).length <= 128, `${label}: id слишком длинный.`);
    if (ship.name != null) assert(String(ship.name).length <= 256, `${label}: имя слишком длинное.`);
    validateOptionalNumber(ship, "x", label, { min: 0, max: board ? Number(board.width) - 1 : BOARD_LIMITS.maxWidth - 1, integer: true });
    validateOptionalNumber(ship, "y", label, { min: 0, max: board ? Number(board.height) - 1 : BOARD_LIMITS.maxHeight - 1, integer: true });
    validateOptionalNumber(ship, "heading", label);
    validateOptionalNumber(ship, "speed", label, { min: 0, max: 20, integer: true });
    validateOptionalNumber(ship, "maxSpeed", label, { min: 0, max: 12, integer: true });
    validateOptionalNumber(ship, "altitude", label, { min: ALTITUDE_MIN, max: ALTITUDE_MAX, integer: true });
    validateOptionalNumber(ship, "verticalVelocity", label, { min: -3, max: 2, integer: true });

    if (ship.stats != null) {
      assert(isObject(ship.stats), `${label}: stats должен быть объектом.`);
      validateOptionalNumber(ship.stats, "sm", `${label}.stats`, { min: 0, max: 30, integer: true });
      validateOptionalNumber(ship.stats, "ht", `${label}.stats`, { min: 1, max: 30, integer: true });
      validateOptionalNumber(ship.stats, "handling", `${label}.stats`, { min: -10, max: 10, integer: true });
      validateOptionalNumber(ship.stats, "stability", `${label}.stats`, { min: 0, max: 20, integer: true });
      validateOptionalNumber(ship.stats, "crewQuality", `${label}.stats`, { min: -5, max: 5, integer: true });
    }

    if (ship.crew != null) {
      assert(isObject(ship.crew), `${label}: crew должен быть объектом.`);
      for (const field of ["current", "required", "casualties", "rescued"]) validateOptionalNumber(ship.crew, field, `${label}.crew`, { min: 0, max: 100000, integer: true });
      validateOptionalNumber(ship.crew, "morale", `${label}.crew`, { min: 0, max: 10, integer: true });
    }

    if (ship.crystal != null) {
      assert(isObject(ship.crystal), `${label}: crystal должен быть объектом.`);
      validateOptionalNumber(ship.crystal, "heat", `${label}.crystal`, { min: 0, max: 105, integer: true });
      validateOptionalNumber(ship.crystal, "maxHeat", `${label}.crystal`, { min: 4, max: 100, integer: true });
      validateOptionalNumber(ship.crystal, "integrity", `${label}.crystal`, { min: 0, max: 1000, integer: true });
      validateOptionalNumber(ship.crystal, "maxIntegrity", `${label}.crystal`, { min: 1, max: 1000, integer: true });
      validateOptionalNumber(ship.crystal, "armor", `${label}.crystal`, { min: 0, max: 100, integer: true });
    }

    if (ship.equipment != null) {
      assert(isObject(ship.equipment), `${label}: equipment должен быть объектом.`);
      if (ship.equipment.heatedShotFurnace != null) assert(typeof ship.equipment.heatedShotFurnace === "boolean", `${label}: equipment.heatedShotFurnace должен быть boolean.`);
    }

    assert(isObject(ship.sections), `${label}: отсутствуют секции корпуса.`);
    assert(Object.keys(ship.sections).length > 0, `${label}: список секций корпуса пуст.`);
    assert(Object.keys(ship.sections).length <= MAX_SECTIONS, `${label}: слишком много секций корпуса.`);
    for (const [sectionId, section] of Object.entries(ship.sections)) {
      assert(isObject(section), `${label}: секция ${sectionId} должна быть объектом.`);
      if (section.hp != null) {
        assert(isObject(section.hp), `${label}: HP секции ${sectionId} должен быть объектом.`);
        validateOptionalNumber(section.hp, "max", `${label}.sections.${sectionId}.hp`, { min: 1, max: 10000, integer: true });
        validateOptionalNumber(section.hp, "value", `${label}.sections.${sectionId}.hp`, { min: 0, max: 10000, integer: true });
      }
      for (const field of ["dr", "fire", "flooding", "breaches", "mastWreckage"]) validateOptionalNumber(section, field, `${label}.sections.${sectionId}`, { min: 0, max: 100, integer: true });
      if (section.systems != null) {
        assert(Array.isArray(section.systems), `${label}: systems секции ${sectionId} должен быть массивом.`);
        assert(section.systems.length <= MAX_SYSTEMS_PER_SECTION, `${label}: в секции ${sectionId} слишком много систем.`);
      }
    }

    if (ship.weapons != null) {
      assert(Array.isArray(ship.weapons), `${label}: weapons должен быть массивом.`);
      assert(ship.weapons.length <= MAX_WEAPONS, `${label}: слишком много батарей.`);
      ship.weapons.forEach((weapon, index) => {
        assert(isObject(weapon), `${label}: батарея #${index + 1} должна быть объектом.`);
        if (weapon.id != null) assert(String(weapon.id).length <= 128, `${label}: id батареи #${index + 1} слишком длинный.`);
        validateOptionalNumber(weapon, "reload", `${label}.weapons[${index}]`, { min: 0, max: 100, integer: true });
        validateOptionalNumber(weapon, "reloadMax", `${label}.weapons[${index}]`, { min: 0, max: 100, integer: true });
        if (weapon.reload != null && weapon.reloadMax != null) {
          assert(Number(weapon.reload) <= Number(weapon.reloadMax), `${label}: reload батареи #${index + 1} не может превышать reloadMax.`);
        }
        validateOptionalNumber(weapon, "damage", `${label}.weapons[${index}]`, { min: 1, max: 1000, integer: true });
        validateOptionalNumber(weapon, "range", `${label}.weapons[${index}]`, { min: 1, max: 100, integer: true });
        validateOptionalNumber(weapon, "crewRequired", `${label}.weapons[${index}]`, { min: 0, max: 10000, integer: true });
      });
      assertUniqueIds(ship.weapons, { label: `${label}: батареи`, allowMissing: true });
    }
    return ship;
  }

  static validateCreature(creature, { label = "Существо", board = null } = {}) {
    assert(isObject(creature), `${label}: данные существа должны быть объектом.`);
    const unitType = String(creature.unitType ?? "creature");
    assert(unitType === "creature", `${label}: ожидался unitType=creature, получено ${unitType}.`);
    this.assertSupportedSchema(creature, { label });
    if (creature.id != null) assert(String(creature.id).length <= 128, `${label}: id слишком длинный.`);
    if (creature.name != null) assert(String(creature.name).length <= 256, `${label}: имя слишком длинное.`);
    if (creature.creatureType != null) assert(String(creature.creatureType).length <= 128, `${label}: creatureType слишком длинный.`);
    validateOptionalNumber(creature, "x", label, { min: 0, max: board ? Number(board.width) - 1 : BOARD_LIMITS.maxWidth - 1, integer: true });
    validateOptionalNumber(creature, "y", label, { min: 0, max: board ? Number(board.height) - 1 : BOARD_LIMITS.maxHeight - 1, integer: true });
    validateOptionalNumber(creature, "heading", label);
    validateOptionalNumber(creature, "speed", label, { min: 0, max: 20, integer: true });
    validateOptionalNumber(creature, "maxSpeed", label, { min: 0, max: 20, integer: true });
    validateOptionalNumber(creature, "altitude", label, { min: ALTITUDE_MIN, max: ALTITUDE_MAX, integer: true });
    validateOptionalNumber(creature, "verticalVelocity", label, { min: -3, max: 3, integer: true });

    if (creature.stats != null) {
      assert(isObject(creature.stats), `${label}: stats должен быть объектом.`);
      validateOptionalNumber(creature.stats, "sm", `${label}.stats`, { min: 0, max: 30, integer: true });
      validateOptionalNumber(creature.stats, "ht", `${label}.stats`, { min: 1, max: 30, integer: true });
      validateOptionalNumber(creature.stats, "handling", `${label}.stats`, { min: -10, max: 10, integer: true });
      validateOptionalNumber(creature.stats, "stability", `${label}.stats`, { min: 0, max: 20, integer: true });
      validateOptionalNumber(creature.stats, "armor", `${label}.stats`, { min: 0, max: 100, integer: true });
    }

    assert(isObject(creature.vitality), `${label}: vitality должен быть объектом.`);
    validateOptionalNumber(creature.vitality, "max", `${label}.vitality`, { min: 1, max: 10000, integer: true });
    validateOptionalNumber(creature.vitality, "current", `${label}.vitality`, { min: 0, max: 10000, integer: true });
    if (creature.vitality.current != null && creature.vitality.max != null) {
      assert(Number(creature.vitality.current) <= Number(creature.vitality.max), `${label}: vitality.current не может превышать vitality.max.`);
    }
    validateOptionalNumber(creature.vitality, "morale", `${label}.vitality`, { min: 0, max: 10, integer: true });

    assert(isObject(creature.sections), `${label}: отсутствуют анатомические секции.`);
    const sectionEntries = Object.entries(creature.sections);
    assert(sectionEntries.length > 0, `${label}: список анатомических секций пуст.`);
    assert(sectionEntries.length <= MAX_SECTIONS, `${label}: слишком много анатомических секций.`);
    for (const [sectionId, section] of sectionEntries) {
      assert(isObject(section), `${label}: секция ${sectionId} должна быть объектом.`);
      if (section.hp != null) {
        assert(isObject(section.hp), `${label}: HP секции ${sectionId} должен быть объектом.`);
        validateOptionalNumber(section.hp, "max", `${label}.sections.${sectionId}.hp`, { min: 1, max: 10000, integer: true });
        validateOptionalNumber(section.hp, "value", `${label}.sections.${sectionId}.hp`, { min: 0, max: 10000, integer: true });
        if (section.hp.value != null && section.hp.max != null) assert(Number(section.hp.value) <= Number(section.hp.max), `${label}: HP секции ${sectionId} превышает максимум.`);
      }
      validateOptionalNumber(section, "armor", `${label}.sections.${sectionId}`, { min: 0, max: 100, integer: true });
      if (section.tags != null) assert(Array.isArray(section.tags), `${label}: tags секции ${sectionId} должен быть массивом.`);
    }

    if (creature.attacks != null) {
      assert(Array.isArray(creature.attacks), `${label}: attacks должен быть массивом.`);
      assert(creature.attacks.length <= MAX_WEAPONS, `${label}: слишком много атак.`);
      creature.attacks.forEach((attack, index) => {
        assert(isObject(attack), `${label}: атака #${index + 1} должна быть объектом.`);
        if (attack.id != null) assert(String(attack.id).length <= 128, `${label}: id атаки #${index + 1} слишком длинный.`);
        validateOptionalNumber(attack, "range", `${label}.attacks[${index}]`, { min: 1, max: 100, integer: true });
        validateOptionalNumber(attack, "damage", `${label}.attacks[${index}]`, { min: 1, max: 1000, integer: true });
        validateOptionalNumber(attack, "cooldown", `${label}.attacks[${index}]`, { min: 0, max: 100, integer: true });
        validateOptionalNumber(attack, "cooldownMax", `${label}.attacks[${index}]`, { min: 0, max: 100, integer: true });
        if (attack.cooldown != null && attack.cooldownMax != null) assert(Number(attack.cooldown) <= Number(attack.cooldownMax), `${label}: cooldown атаки #${index + 1} не может превышать cooldownMax.`);
      });
      assertUniqueIds(creature.attacks, { label: `${label}: атаки`, allowMissing: true });
    }

    if (creature.abilities != null) {
      assert(Array.isArray(creature.abilities), `${label}: abilities должен быть массивом.`);
      assert(creature.abilities.length <= 100, `${label}: слишком много способностей.`);
      assertUniqueIds(creature.abilities, { label: `${label}: способности`, allowMissing: true });
    }
    return creature;
  }

  static validateCombatant(unit, options = {}) {
    const type = String(unit?.unitType ?? "ship");
    return type === "creature"
      ? this.validateCreature(unit, options)
      : this.validateShip(unit, options);
  }

  static validateBattle(battle) {
    assert(isObject(battle), "Бой должен быть объектом.");
    this.assertSupportedSchema(battle, { label: "Бой" });
    this.validateBoard(battle.board);
    this.validateTerrain(battle.board);
    assert(Array.isArray(battle.ships), "Бой не содержит массив ships.");
    assert(battle.ships.length > 0, "Бой должен содержать хотя бы одну боевую единицу.");
    assert(battle.ships.length <= MAX_SHIPS, `Бой содержит слишком много боевых единиц, максимум ${MAX_SHIPS}.`);
    battle.ships.forEach((unit, index) => this.validateCombatant(unit, { label: `Боевая единица #${index + 1}`, board: battle.board }));
    assertUniqueIds(battle.ships, { label: "Боевые единицы боя", allowMissing: true });
    if (battle.setup?.heatedShot != null) {
      assert(isObject(battle.setup.heatedShot), "setup.heatedShot должен быть объектом.");
      for (const [sideId, enabled] of Object.entries(battle.setup.heatedShot)) assert(typeof enabled === "boolean", `heatedShot.${sideId} должен быть boolean.`);
    }
    return battle;
  }

  static validateSetup(setup, board) {
    assert(isObject(setup), "Сценарий не содержит объект setup.");
    const mode = setup.mode ?? "mixed";
    assert(["sea", "air", "mixed"].includes(mode), "Режим сценария должен быть sea, air или mixed.");
    assert(isObject(setup.sides), "Сценарий не содержит стороны setup.sides.");
    const sideIds = [...new Set([...(Array.isArray(setup.sideOrder) ? setup.sideOrder : []), ...Object.keys(setup.sides)])]
      .map(sideId => String(sideId ?? "").trim())
      .filter(Boolean);
    assert(sideIds.length >= 2, "Сценарий должен содержать минимум две стороны.");
    for (const sideId of sideIds) {
      const side = setup.sides[sideId];
      assert(isObject(side), `Сторона ${sideId} отсутствует.`);
      assert(isObject(side.zone), `Сторона ${sideId} не содержит зону расстановки.`);
      const z = side.zone;
      const x1 = Number(z.x1);
      const y1 = Number(z.y1);
      const x2 = Number(z.x2);
      const y2 = Number(z.y2);
      assert([x1, y1, x2, y2].every(Number.isFinite), `Зона ${sideId} содержит нечисловые координаты.`);
      assert(x1 >= 0 && y1 >= 0 && x2 < Number(board.width) && y2 < Number(board.height) && x1 <= x2 && y1 <= y2, `Зона ${sideId} выходит за пределы поля.`);
      if (setup.heatedShot?.[sideId] != null) assert(typeof setup.heatedShot[sideId] === "boolean", `heatedShot.${sideId} должен быть boolean.`);
    }
  }

  static validateTerrain(board) {
    const terrain = board?.terrain ?? {};
    assert(isObject(terrain), "Террейн должен быть объектом board.terrain.");
    const allowedTerrain = new Set(TERRAIN_TYPES);
    for (const [key, raw] of Object.entries(terrain)) {
      const [xRaw, yRaw] = String(key).split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      assert(Number.isInteger(x) && Number.isInteger(y), `Некорректный ключ террейна: ${key}.`);
      assert(x >= 0 && y >= 0 && x < Number(board.width) && y < Number(board.height), `Террейн ${key} вне поля.`);
      const layers = Array.isArray(raw) ? raw : [raw];
      assert(layers.length <= 6, `В клетке ${key} слишком много слоев террейна.`);
      for (const layer of layers) assert(allowedTerrain.has(layer), `Неизвестный тип террейна: ${layer}.`);
    }
  }

  static validateScenario(entryOrScenario) {
    assert(isObject(entryOrScenario), "Сценарий должен быть объектом.");
    this.assertSupportedSchema(entryOrScenario, { label: "Сценарий" });
    const scenario = entryOrScenario.scenario ?? entryOrScenario;
    this.assertSupportedSchema(scenario, { label: "Данные сценария" });
    assert(isObject(scenario), "Сценарий не содержит данные боя.");
    this.validateBoard(scenario.board);
    this.validateTerrain(scenario.board);
    this.validateSetup(scenario.setup, scenario.board);
    assert(Array.isArray(scenario.ships), "Сценарий должен содержать массив ships, даже если он пустой.");
    assert(scenario.ships.length <= MAX_SHIPS, `Сценарий содержит слишком много боевых единиц, максимум ${MAX_SHIPS}.`);
    scenario.ships.forEach((unit, index) => this.validateCombatant(unit, { label: `Боевая единица сценария #${index + 1}`, board: scenario.board }));
    assertUniqueIds(scenario.ships, { label: "Боевые единицы сценария", allowMissing: true });
    return entryOrScenario;
  }

}
