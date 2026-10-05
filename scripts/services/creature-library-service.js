import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { SocketService } from "./socket-service.js";
import { boundedString, jsonSize } from "../utils/schema.js";
import { repairUniqueIds } from "../utils/identity.js";
import { CreatureNormalizer } from "../normalizers/creature-normalizer.js";
import { BattleScenarioService } from "./battle-scenario-service.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "./document-state-store.js";

const LIBRARY_LIMIT = 80;
const LIBRARY_BYTE_BUDGET = 4_000_000;

function clone(value) {
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

export class CreatureLibraryService {
  static cleanCreatureForLibrary(creature) {
    return CreatureNormalizer.cleanForLibrary(creature);
  }

  static cloneCreatureForBattle(creature, battle = null, { side = null } = {}) {
    const cloneCreature = this.cleanCreatureForLibrary(creature);
    cloneCreature.id = foundry.utils.randomID?.() ?? String(Date.now());
    cloneCreature.name = String(cloneCreature.name || "Летающее существо");
    if (battle) {
      const offset = Number(battle.ships?.length ?? 0);
      const sideIds = BattleScenarioService.getSideIds(battle);
      cloneCreature.side = sideIds.includes(side) ? side : sideIds[offset % sideIds.length] ?? cloneCreature.side ?? "wild";
      const sideOffset = (battle.ships ?? []).filter(unit => unit.side === cloneCreature.side).length;
      const spawn = BattleScenarioService.getSideSpawnPoint(battle, cloneCreature.side, sideOffset);
      cloneCreature.x = spawn.x;
      cloneCreature.y = spawn.y;
      cloneCreature.heading = spawn.heading ?? cloneCreature.heading;
      cloneCreature.turn.round = battle.round ?? 1;
    }
    return CreatureNormalizer.normalize(cloneCreature, { battleRound: battle?.round ?? 1 });
  }

  static getLibrary() {
    if (!game.user?.isGM) return [];
    const saved = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, { schemaVersion: 0, creatures: [] });
    const entries = Array.isArray(saved.creatures) ? saved.creatures : [];
    const clean = entries.map((entry, index) => ({
      id: boundedString(entry?.id, { fallback: `creature-template-${index + 1}`, maxLength: 128 }),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(entry?.name, { fallback: "Шаблон существа", maxLength: 256 }) || "Шаблон существа",
      saved: boundedString(entry?.saved, { maxLength: 64 }),
      creature: this.cleanCreatureForLibrary(clone(entry?.creature ?? {}))
    }));
    repairUniqueIds(clean, { prefix: "creature-template", maxLength: 128 });
    return clean;
  }

  static #fitToBudget(entries) {
    const clean = entries.slice(-LIBRARY_LIMIT);
    while (clean.length > 1 && jsonSize({ creatures: clean }) > LIBRARY_BYTE_BUDGET) clean.shift();
    if (jsonSize({ creatures: clean }) > LIBRARY_BYTE_BUDGET) {
      throw new Error(`Бестиарий превышает лимит ${Math.round(LIBRARY_BYTE_BUDGET / 1_000_000)} МБ.`);
    }
    return clean;
  }

  static async saveLibrary(entries) {
    const clean = (Array.isArray(entries) ? entries : []).map((entry, index) => ({
      id: boundedString(entry?.id, { fallback: `creature-template-${index + 1}`, maxLength: 128 }),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(entry?.name, { fallback: "Шаблон существа", maxLength: 256 }) || "Шаблон существа",
      saved: boundedString(entry?.saved, { fallback: new Date().toISOString(), maxLength: 64 }),
      creature: this.cleanCreatureForLibrary(entry?.creature ?? {})
    }));
    repairUniqueIds(clean, { prefix: "creature-template", maxLength: 128 });
    if (!SocketService.canCurrentUserWrite({ label: "Бестиарий" })) return this.getLibrary();
    const fitted = this.#fitToBudget(clean);
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, { schemaVersion: CURRENT_SCHEMA_VERSION, creatures: fitted });
    SocketService.broadcastUpdate("creatureLibrary");
    return fitted;
  }

  static async saveTemplate(name, creature) {
    const library = this.getLibrary();
    const clean = this.cleanCreatureForLibrary(creature);
    const entry = {
      id: foundry.utils.randomID?.() ?? String(Date.now()),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(name || clean.name || "Шаблон существа", { maxLength: 256 }) || "Шаблон существа",
      saved: new Date().toISOString(),
      creature: clean
    };
    library.push(entry);
    const stored = await this.saveLibrary(library);
    return stored.find(item => item.id === entry.id) ?? stored.at(-1);
  }

  static async deleteTemplate(idOrIndex = null) {
    const library = this.getLibrary();
    if (!library.length) return null;
    const asIndex = Number(idOrIndex);
    const index = Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= library.length
      ? asIndex - 1
      : idOrIndex
        ? library.findIndex(entry => entry.id === idOrIndex || entry.name === idOrIndex)
        : library.length - 1;
    if (index < 0) return null;
    const [removed] = library.splice(index, 1);
    await this.saveLibrary(library);
    return removed;
  }
}
