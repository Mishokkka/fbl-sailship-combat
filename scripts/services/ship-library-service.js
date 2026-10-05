import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { SocketService } from "./socket-service.js";
import { boundedString, jsonSize } from "../utils/schema.js";
import { repairUniqueIds } from "../utils/identity.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "./document-state-store.js";

const LIBRARY_LIMIT = 60;
const LIBRARY_BYTE_BUDGET = 4_000_000;

function getStorage() {
  return game.sailshipsCombat?.storage ?? null;
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

export class ShipLibraryService {
  static cleanShipForLibrary(ship) {
    const storage = getStorage();
    if (!storage?.cleanShipForLibrary) throw new Error("Sailships storage service is not ready.");
    return storage.cleanShipForLibrary(ship);
  }

  static cloneShipForBattle(ship, battle = null, options = {}) {
    const storage = getStorage();
    if (!storage?.cloneShipForBattle) throw new Error("Sailships storage service is not ready.");
    return storage.cloneShipForBattle(ship, battle, options);
  }

  static getLibrary() {
    if (!game.user?.isGM) return [];
    const saved = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, { schemaVersion: 0, ships: [] });
    const ships = Array.isArray(saved.ships) ? saved.ships : [];
    const clean = ships.map((entry, index) => ({
      id: boundedString(entry?.id, { fallback: `template-${index + 1}`, maxLength: 128 }),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(entry?.name, { fallback: "Шаблон корабля", maxLength: 256 }) || "Шаблон корабля",
      saved: boundedString(entry?.saved, { maxLength: 64 }),
      ship: this.cleanShipForLibrary(clone(entry?.ship ?? {}))
    }));
    repairUniqueIds(clean, { prefix: "template", maxLength: 128 });
    return clean;
  }

  static #fitToBudget(entries) {
    const clean = entries.slice(-LIBRARY_LIMIT);
    while (clean.length > 1 && jsonSize({ ships: clean }) > LIBRARY_BYTE_BUDGET) clean.shift();
    if (jsonSize({ ships: clean }) > LIBRARY_BYTE_BUDGET) {
      throw new Error(`Библиотека кораблей превышает лимит ${Math.round(LIBRARY_BYTE_BUDGET / 1_000_000)} МБ.`);
    }
    return clean;
  }

  static async saveLibrary(ships) {
    const clean = (Array.isArray(ships) ? ships : []).map((entry, index) => ({
      id: boundedString(entry?.id, { fallback: `template-${index + 1}`, maxLength: 128 }),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(entry?.name, { fallback: "Шаблон корабля", maxLength: 256 }) || "Шаблон корабля",
      saved: boundedString(entry?.saved, { fallback: new Date().toISOString(), maxLength: 64 }),
      ship: this.cleanShipForLibrary(entry?.ship ?? {})
    }));
    repairUniqueIds(clean, { prefix: "template", maxLength: 128 });
    if (!SocketService.canCurrentUserWrite({ label: "Библиотека кораблей" })) return this.getLibrary();
    const fitted = this.#fitToBudget(clean);
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, { schemaVersion: CURRENT_SCHEMA_VERSION, ships: fitted });
    SocketService.broadcastUpdate("library");
    return fitted;
  }

  static async saveTemplate(name, ship) {
    const now = new Date().toISOString();
    const library = this.getLibrary();
    const clean = this.cleanShipForLibrary(ship);
    const entry = {
      id: foundry.utils.randomID?.() ?? String(Date.now()),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(name || clean.name || "Шаблон корабля", { maxLength: 256 }) || "Шаблон корабля",
      saved: now,
      ship: clean
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
