import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { BattleNormalizer } from "../normalizers/battle-normalizer.js";
import { ShipNormalizer } from "../normalizers/ship-normalizer.js";
import { CreatureNormalizer } from "../normalizers/creature-normalizer.js";
import { BattleScenarioService } from "../services/battle-scenario-service.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "../services/document-state-store.js";
import { UnsupportedSchemaVersionError } from "./schema-migrations.js";
import { boundedString } from "../utils/schema.js";
import { repairUniqueIds } from "../utils/identity.js";

function clone(value) {
  if (value == null) return value;
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

function versionOf(value) {
  const version = Number(value?.schemaVersion ?? 0);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

function assertSupported(value, label) {
  const version = versionOf(value);
  if (version > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError(label, version);
  return version;
}

function stableId(value, fallback) {
  return boundedString(value, { fallback, maxLength: 128 }) || fallback;
}

function stableName(value, fallback) {
  return boundedString(value, { fallback, maxLength: 256 }) || fallback;
}

function stableTimestamp(value) {
  return boundedString(value, { fallback: new Date().toISOString(), maxLength: 64 });
}

export class StorageMigrations {
  static async migrateAll({ log = true } = {}) {
    const report = [];
    for (const migrate of [
      () => this.migrateSnapshots(),
      () => this.migrateShipLibrary(),
      () => this.migrateCreatureLibrary(),
      () => this.migrateScenarios()
    ]) {
      const result = await migrate();
      if (result) report.push(result);
    }
    if (log && report.length) console.info(`sailships-combat | Storage migrations: ${report.join(", ")}.`);
    return report;
  }

  static async migrateSnapshots() {
    const source = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, { schemaVersion: 0, battles: [] });
    const from = assertSupported(source, "Snapshots");
    if (from === CURRENT_SCHEMA_VERSION) return null;
    const battles = (Array.isArray(source?.battles) ? source.battles : []).map((entry, index) => ({
      id: stableId(entry?.id, `snapshot-${index + 1}`),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: stableName(entry?.name, "Сохранение боя"),
      saved: stableTimestamp(entry?.saved),
      battle: BattleNormalizer.normalize(clone(entry?.battle ?? {}))
    }));
    repairUniqueIds(battles, { prefix: "snapshot", maxLength: 128 });
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      battles
    });
    return `snapshots v${from}->v${CURRENT_SCHEMA_VERSION}`;
  }

  static async migrateShipLibrary() {
    const source = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, { schemaVersion: 0, ships: [] });
    const from = assertSupported(source, "Ship library");
    if (from === CURRENT_SCHEMA_VERSION) return null;
    const ships = (Array.isArray(source?.ships) ? source.ships : []).map((entry, index) => ({
      id: stableId(entry?.id, `template-${index + 1}`),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: stableName(entry?.name, "Шаблон корабля"),
      saved: stableTimestamp(entry?.saved),
      ship: ShipNormalizer.cleanForLibrary(clone(entry?.ship ?? {}))
    }));
    repairUniqueIds(ships, { prefix: "template", maxLength: 128 });
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ships
    });
    return `ship library v${from}->v${CURRENT_SCHEMA_VERSION}`;
  }

  static async migrateCreatureLibrary() {
    const source = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, { schemaVersion: 0, creatures: [] });
    const from = assertSupported(source, "Creature library");
    if (from === CURRENT_SCHEMA_VERSION) return null;
    const creatures = (Array.isArray(source?.creatures) ? source.creatures : []).map((entry, index) => ({
      id: stableId(entry?.id, `creature-template-${index + 1}`),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: stableName(entry?.name, "Шаблон существа"),
      saved: stableTimestamp(entry?.saved),
      creature: CreatureNormalizer.cleanForLibrary(clone(entry?.creature ?? {}))
    }));
    repairUniqueIds(creatures, { prefix: "creature-template", maxLength: 128 });
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      creatures
    });
    return `creature library v${from}->v${CURRENT_SCHEMA_VERSION}`;
  }

  static async migrateScenarios() {
    const source = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.SCENARIOS, { schemaVersion: 0, scenarios: [] });
    const from = assertSupported(source, "Scenarios");
    if (from === CURRENT_SCHEMA_VERSION) return null;
    const scenarios = (Array.isArray(source?.scenarios) ? source.scenarios : []).map((entry, index) => {
      const battle = BattleNormalizer.normalize(clone(entry?.scenario ?? {}));
      const clean = BattleScenarioService.cleanScenarioFromBattle(battle, stableName(entry?.name, "Сценарий боя"));
      clean.id = stableId(entry?.id, `scenario-${index + 1}`);
      clean.saved = stableTimestamp(entry?.saved);
      clean.schemaVersion = CURRENT_SCHEMA_VERSION;
      return clean;
    });
    repairUniqueIds(scenarios, { prefix: "scenario", maxLength: 128 });
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.SCENARIOS, {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      scenarios
    });
    return `scenarios v${from}->v${CURRENT_SCHEMA_VERSION}`;
  }
}
