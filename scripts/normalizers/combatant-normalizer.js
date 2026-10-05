import { COMBATANT_TYPES } from "../utils/constants.js";
import { enumValue, isPlainObject } from "../utils/schema.js";
import { ShipNormalizer } from "./ship-normalizer.js";
import { CreatureNormalizer } from "./creature-normalizer.js";

export class CombatantNormalizer {
  static normalize(unit, options = {}) {
    unit = isPlainObject(unit) ? unit : {};
    const type = enumValue(String(unit.unitType ?? "ship"), COMBATANT_TYPES, "ship");
    return type === "creature"
      ? CreatureNormalizer.normalize(unit, options)
      : ShipNormalizer.normalize(unit, options);
  }

  static normalizeCreatureScaffold(unit, options = {}) {
    return CreatureNormalizer.normalize(unit, options);
  }
}
