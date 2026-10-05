import { MODULE_ID } from "../utils/constants.js";
import { uid } from "../utils/random.js";

const FLAG_ROLE = "storageRole";
const FLAG_USER_ID = "projectionUserId";
const FLAG_STATE = "state";
const STORAGE_VERSION = 1;

export const DOCUMENT_STORAGE_ROLES = Object.freeze({
  BATTLE_CORE: "battle-core",
  BATTLE_LOG: "battle-log",
  BATTLE_RUNTIME: "battle-runtime",
  SNAPSHOTS: "battle-snapshots",
  SHIP_LIBRARY: "ship-library",
  CREATURE_LIBRARY: "creature-library",
  SCENARIOS: "battle-scenarios",
  PLAYER_PROJECTION: "player-projection"
});

const DOCUMENT_NAMES = Object.freeze({
  [DOCUMENT_STORAGE_ROLES.BATTLE_CORE]: "Sailships Combat · Авторитетное состояние",
  [DOCUMENT_STORAGE_ROLES.BATTLE_LOG]: "Sailships Combat · Журнал боя",
  [DOCUMENT_STORAGE_ROLES.BATTLE_RUNTIME]: "Sailships Combat · События представления",
  [DOCUMENT_STORAGE_ROLES.SNAPSHOTS]: "Sailships Combat · Сохранения",
  [DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY]: "Sailships Combat · Библиотека кораблей",
  [DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY]: "Sailships Combat · Бестиарий",
  [DOCUMENT_STORAGE_ROLES.SCENARIOS]: "Sailships Combat · Сценарии"
});

function clone(value) {
  if (value == null) return value;
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return structuredClone(value);
}

function journalEntries() {
  const collection = game.journal;
  if (!collection) return [];
  if (Array.isArray(collection.contents)) return collection.contents;
  return Array.from(collection.values?.() ?? collection ?? []);
}

function getFlag(entry, key) {
  if (!entry) return undefined;
  if (typeof entry.getFlag === "function") return entry.getFlag(MODULE_ID, key);
  return entry.flags?.[MODULE_ID]?.[key];
}

function ownershipLevel(name, fallback) {
  return Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.[name] ?? fallback);
}

function gmOnlyOwnership() {
  return { default: ownershipLevel("NONE", 0) };
}

function projectionOwnership(userId) {
  return {
    default: ownershipLevel("NONE", 0),
    [String(userId)]: ownershipLevel("OBSERVER", 2)
  };
}

function normalizedRevision(value) {
  return Math.max(0, Number(value) || 0);
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    const fallback = `${uid("secret")}:${Date.now()}:${Math.random()}`;
    return btoa(unescape(encodeURIComponent(fallback))).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function splitBattle(battle) {
  const core = clone(battle ?? {});
  const log = Array.isArray(core.log) ? core.log : [];
  const runtime = {};
  for (const key of ["lastMovement", "lastAudioEvent", "lastCollision"]) {
    if (core[key] != null) runtime[key] = core[key];
    delete core[key];
  }
  delete core.log;
  return { core, log, runtime };
}

function componentForRevision(state, revision, key, fallback) {
  for (const candidate of [state?.current, state?.previous]) {
    if (normalizedRevision(candidate?.revision) === revision && candidate?.[key] != null) return clone(candidate[key]);
  }
  return clone(fallback);
}

export class DocumentStateStore {
  static roleCache = new Map();

  static invalidateCache() {
    this.roleCache.clear();
  }

  static isStorageEntry(entry) {
    return Boolean(getFlag(entry, FLAG_ROLE));
  }

  static hideStorageEntriesInDirectory(html) {
    const HTMLElementClass = globalThis.HTMLElement;
    const root = HTMLElementClass && html instanceof HTMLElementClass ? html : html?.[0] ?? html;
    if (!root?.querySelectorAll) return;
    for (const entry of journalEntries().filter(candidate => this.isStorageEntry(candidate))) {
      const id = String(entry.id ?? "").replace(/"/g, "");
      if (!id) continue;
      for (const node of root.querySelectorAll(`[data-entry-id="${id}"], [data-document-id="${id}"]`)) node.remove();
    }
  }

  static isAvailable() {
    return Boolean(game.journal && globalThis.JournalEntry?.create);
  }

  static findEntry(role, userId = null) {
    const key = `${role}:${userId ?? ""}`;
    const cachedId = this.roleCache.get(key);
    if (cachedId) {
      const cached = game.journal?.get?.(cachedId);
      if (cached && getFlag(cached, FLAG_ROLE) === role && (userId == null || getFlag(cached, FLAG_USER_ID) === String(userId))) return cached;
      this.roleCache.delete(key);
    }

    const found = journalEntries().find(entry => {
      if (getFlag(entry, FLAG_ROLE) !== role) return false;
      return userId == null || getFlag(entry, FLAG_USER_ID) === String(userId);
    }) ?? null;
    if (found?.id) this.roleCache.set(key, found.id);
    return found;
  }

  static readState(role, { userId = null } = {}) {
    return clone(getFlag(this.findEntry(role, userId), FLAG_STATE));
  }

  static async createEntry(role, state, { userId = null, name = null, ownership = null } = {}) {
    if (!this.isAvailable()) throw new Error("JournalEntry storage is unavailable.");
    const data = {
      name: name ?? DOCUMENT_NAMES[role] ?? `Sailships Combat · ${role}`,
      ownership: ownership ?? gmOnlyOwnership(),
      flags: {
        [MODULE_ID]: {
          [FLAG_ROLE]: role,
          ...(userId == null ? {} : { [FLAG_USER_ID]: String(userId) }),
          storageVersion: STORAGE_VERSION,
          [FLAG_STATE]: clone(state)
        }
      }
    };
    const created = await JournalEntry.create(data, { renderSheet: false });
    this.invalidateCache();
    return created;
  }

  static async ensureEntry(role, state, options = {}) {
    const existing = this.findEntry(role, options.userId ?? null);
    if (existing) return existing;
    return this.createEntry(role, state, options);
  }

  static async updateEntry(entry, state, { ownership = null, name = null } = {}) {
    if (!entry) throw new Error("Sailships Combat storage entry is missing.");
    const update = {
      [`flags.${MODULE_ID}.${FLAG_STATE}`]: clone(state),
      [`flags.${MODULE_ID}.storageVersion`]: STORAGE_VERSION
    };
    if (ownership) update.ownership = ownership;
    if (name) update.name = name;
    await entry.update(update, { render: false });
    return entry;
  }

  static async ensureBattleDocuments(initialBattle) {
    const revision = normalizedRevision(initialBattle?.revision);
    const { core, log, runtime } = splitBattle(initialBattle);
    await this.ensureEntry(DOCUMENT_STORAGE_ROLES.BATTLE_CORE, {
      current: { revision, battle: core }
    });
    await this.ensureEntry(DOCUMENT_STORAGE_ROLES.BATTLE_LOG, {
      current: { revision, entries: log },
      previous: null
    });
    await this.ensureEntry(DOCUMENT_STORAGE_ROLES.BATTLE_RUNTIME, {
      current: { revision, events: runtime },
      previous: null
    });
  }

  static readAuthoritativeBattle() {
    const coreState = this.readState(DOCUMENT_STORAGE_ROLES.BATTLE_CORE);
    const core = coreState?.current?.battle;
    if (!core || typeof core !== "object") return null;
    const revision = normalizedRevision(coreState.current.revision ?? core.revision);
    const battle = clone(core);
    battle.revision = revision;
    battle.log = componentForRevision(this.readState(DOCUMENT_STORAGE_ROLES.BATTLE_LOG), revision, "entries", []);
    const runtime = componentForRevision(this.readState(DOCUMENT_STORAGE_ROLES.BATTLE_RUNTIME), revision, "events", {});
    for (const key of ["lastMovement", "lastAudioEvent", "lastCollision"]) {
      if (runtime?.[key] != null) battle[key] = clone(runtime[key]);
    }
    return battle;
  }

  static getAuthoritativeRevision() {
    return normalizedRevision(this.readState(DOCUMENT_STORAGE_ROLES.BATTLE_CORE)?.current?.revision);
  }

  static async writeAuthoritativeBattle(battle) {
    await this.ensureBattleDocuments(battle);
    const revision = normalizedRevision(battle?.revision);
    const { core, log, runtime } = splitBattle(battle);
    const coreEntry = this.findEntry(DOCUMENT_STORAGE_ROLES.BATTLE_CORE);
    const logEntry = this.findEntry(DOCUMENT_STORAGE_ROLES.BATTLE_LOG);
    const runtimeEntry = this.findEntry(DOCUMENT_STORAGE_ROLES.BATTLE_RUNTIME);
    const previousRevision = this.getAuthoritativeRevision();

    const oldLogState = this.readState(DOCUMENT_STORAGE_ROLES.BATTLE_LOG);
    const oldRuntimeState = this.readState(DOCUMENT_STORAGE_ROLES.BATTLE_RUNTIME);
    const previousLog = componentForRevision(oldLogState, previousRevision, "entries", []);
    const previousRuntime = componentForRevision(oldRuntimeState, previousRevision, "events", {});

    await this.updateEntry(logEntry, {
      current: { revision, entries: log },
      previous: { revision: previousRevision, entries: previousLog }
    });
    await this.updateEntry(runtimeEntry, {
      current: { revision, events: runtime },
      previous: { revision: previousRevision, events: previousRuntime }
    });
    await this.updateEntry(coreEntry, {
      current: { revision, battle: core }
    });
    return clone(battle);
  }

  static async ensureCollection(role, initialValue) {
    await this.ensureEntry(role, { value: clone(initialValue) });
  }

  static readCollection(role, fallback) {
    const value = this.readState(role)?.value;
    return value == null ? clone(fallback) : clone(value);
  }

  static async writeCollection(role, value) {
    await this.ensureCollection(role, value);
    const entry = this.findEntry(role);
    await this.updateEntry(entry, { value: clone(value) });
    return clone(value);
  }

  static readProjection(userId = game.user?.id) {
    return clone(this.readState(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, { userId })?.battle ?? null);
  }

  static readProjectionAuth(userId = game.user?.id) {
    const state = this.readState(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, { userId });
    if (!state) return null;
    return {
      secret: String(state.authSecret ?? ""),
      keyVersion: String(state.keyVersion ?? ""),
      revision: normalizedRevision(state.revision)
    };
  }

  static async syncPlayerProjections(battle, projector) {
    const users = game.users?.contents ?? Array.from(game.users ?? []);
    const players = Array.from(users ?? [])
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(user => user && !user.isGM);
    const failures = [];

    for (const user of players) {
      try {
        let entry = this.findEntry(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, user.id);
        const previous = this.readState(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, { userId: user.id }) ?? {};
        const authSecret = String(previous.authSecret || randomSecret());
        const keyVersion = String(previous.keyVersion || uid("key"));
        const projection = projector(battle, user);
        const state = {
          revision: normalizedRevision(battle?.revision),
          userId: String(user.id),
          authSecret,
          keyVersion,
          battle: clone(projection)
        };
        const name = `Sailships Combat · Проекция · ${user.name ?? user.id}`;
        if (!entry) {
          entry = await this.createEntry(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, state, {
            userId: user.id,
            name,
            ownership: projectionOwnership(user.id)
          });
        } else {
          await this.updateEntry(entry, state, {
            name,
            ownership: projectionOwnership(user.id)
          });
        }
      } catch (error) {
        failures.push({ userId: user.id, error });
        console.error(`Sailships Combat | Failed to update projection for ${user.id}`, error);
      }
    }
    return { updated: players.length - failures.length, failures };
  }



  static async waitForAuthoritativeState({ timeoutMs = 3000, intervalMs = 50 } = {}) {
    const started = Date.now();
    do {
      if (this.readAuthoritativeBattle()) return true;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() - started < timeoutMs);
    return false;
  }

  static async waitForProjection(userId = game.user?.id, { timeoutMs = 3000, intervalMs = 50 } = {}) {
    const started = Date.now();
    do {
      if (this.readProjection(userId)) return true;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() - started < timeoutMs);
    return false;
  }

  static async waitForRevision(revision, { timeoutMs = 1500, intervalMs = 50, user = game.user } = {}) {
    const target = normalizedRevision(revision);
    const started = Date.now();
    do {
      const current = user?.isGM
        ? this.getAuthoritativeRevision()
        : normalizedRevision(this.readProjection(user?.id)?.revision);
      if (current >= target) return true;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() - started < timeoutMs);
    return false;
  }

  static async redactLegacySetting(settingKey, role, metadata = {}) {
    try {
      const current = game.settings.get(MODULE_ID, settingKey);
      if (current?.storageBackend === "permissioned-journal" && current?.storageRole === role) return true;
      await game.settings.set(MODULE_ID, settingKey, {
        storageBackend: "permissioned-journal",
        storageRole: role,
        migratedAt: new Date().toISOString(),
        ...clone(metadata)
      });
      return true;
    } catch (error) {
      console.warn(`Sailships Combat | Could not redact legacy setting ${settingKey}`, error);
      return false;
    }
  }
}
