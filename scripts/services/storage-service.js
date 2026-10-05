import { CURRENT_SCHEMA_VERSION, MODULE_ID, SETTING_BATTLE, SETTING_SAVED_BATTLES, SETTING_SHIP_LIBRARY, SETTING_CREATURE_LIBRARY, SETTING_BATTLE_SCENARIOS } from "../utils/constants.js";
import { createDefaultBattle } from "../data/default-battle.js";
import { SocketService } from "./socket-service.js";
import { ShipLibraryService } from "./ship-library-service.js";
import { BattleNormalizer } from "../normalizers/battle-normalizer.js";
import { ShipNormalizer } from "../normalizers/ship-normalizer.js";
import { CreatureNormalizer } from "../normalizers/creature-normalizer.js";
import { CreatureLibraryService } from "./creature-library-service.js";
import { BattleScenarioService } from "./battle-scenario-service.js";
import { BattleProjectionService } from "./battle-projection-service.js";
import { VisibilityEngine } from "../engine/visibility-engine.js";
import { boundedString, jsonSize } from "../utils/schema.js";
import { repairUniqueIds } from "../utils/identity.js";
import { BattleChangeService } from "./battle-change-service.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "./document-state-store.js";
import { StorageMigrations } from "../migrations/storage-migrations.js";

const SNAPSHOT_LIMIT = 20;
const SNAPSHOT_BYTE_BUDGET = 4_000_000;

class BattleRevisionConflictError extends Error {
  constructor(expected, actual) {
    super(`Battle revision conflict: expected ${expected}, found ${actual}.`);
    this.name = "BattleRevisionConflictError";
    this.expectedRevision = expected;
    this.actualRevision = actual;
  }
}

function clone(value) {
  return foundry.utils.deepClone(value);
}

function snapshotFingerprint(raw) {
  if (!raw || typeof raw !== "object") return "default";
  return `${raw.id ?? ""}:${Number(raw.revision ?? 0)}:${raw.updated ?? ""}`;
}

export class StorageService {
  static mutationQueue = Promise.resolve();
  static battleCache = null;
  static lastChange = { reason: "initial", visibilityDirty: true, fullReplace: true, renderParts: [...BattleChangeService.ALL_PARTS] };

  static registerSettings() {
    game.settings.register(MODULE_ID, SETTING_BATTLE, {
      name: "Active Sailships Combat Battle",
      hint: "Internal storage for the current Sailships Combat battle.",
      scope: "world",
      config: false,
      type: Object,
      default: null
    });

    game.settings.register(MODULE_ID, SETTING_SAVED_BATTLES, {
      name: "Saved Sailships Combat Battles",
      hint: "Internal storage for named Sailships Combat battle snapshots.",
      scope: "world",
      config: false,
      type: Object,
      default: { battles: [] }
    });

    game.settings.register(MODULE_ID, SETTING_SHIP_LIBRARY, {
      name: "Sailships Combat Ship Library",
      hint: "Internal storage for reusable Sailships Combat ship templates.",
      scope: "world",
      config: false,
      type: Object,
      default: { ships: [] }
    });

    game.settings.register(MODULE_ID, SETTING_CREATURE_LIBRARY, {
      name: "Sailships Combat Creature Library",
      hint: "Internal storage for reusable Sailships Combat creature templates.",
      scope: "world",
      config: false,
      type: Object,
      default: { creatures: [] }
    });

    game.settings.register(MODULE_ID, SETTING_BATTLE_SCENARIOS, {
      name: "Sailships Combat Battle Scenarios",
      hint: "Internal storage for reusable Sailships Combat battle setup scenarios.",
      scope: "world",
      config: false,
      type: Object,
      default: { scenarios: [] }
    });
  }

  static initialized = false;

  static async initialize() {
    if (this.initialized) return true;
    if (!DocumentStateStore.isAvailable()) {
      throw new Error("Sailships Combat requires JournalEntry document storage in Foundry VTT 13+.");
    }

    if (SocketService.isAuthoritativeGm()) {
      const legacyBattle = game.settings.get(MODULE_ID, SETTING_BATTLE);
      const hasLegacyBattle = legacyBattle?.id && legacyBattle?.storageBackend !== "permissioned-journal";
      const initialBattle = this.normalizeBattle(hasLegacyBattle ? clone(legacyBattle) : createDefaultBattle());
      await DocumentStateStore.ensureBattleDocuments(initialBattle);

      const authoritative = this.normalizeBattle(DocumentStateStore.readAuthoritativeBattle() ?? initialBattle);
      await DocumentStateStore.writeAuthoritativeBattle(authoritative);

      const legacySnapshots = game.settings.get(MODULE_ID, SETTING_SAVED_BATTLES);
      const legacyShips = game.settings.get(MODULE_ID, SETTING_SHIP_LIBRARY);
      const legacyCreatures = game.settings.get(MODULE_ID, SETTING_CREATURE_LIBRARY);
      const legacyScenarios = game.settings.get(MODULE_ID, SETTING_BATTLE_SCENARIOS);
      await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, {
        schemaVersion: Number(legacySnapshots?.schemaVersion ?? 0),
        battles: Array.isArray(legacySnapshots?.battles) ? clone(legacySnapshots.battles) : []
      });
      await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY, {
        schemaVersion: Number(legacyShips?.schemaVersion ?? 0),
        ships: Array.isArray(legacyShips?.ships) ? clone(legacyShips.ships) : []
      });
      await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY, {
        schemaVersion: Number(legacyCreatures?.schemaVersion ?? 0),
        creatures: Array.isArray(legacyCreatures?.creatures) ? clone(legacyCreatures.creatures) : []
      });
      await DocumentStateStore.ensureCollection(DOCUMENT_STORAGE_ROLES.SCENARIOS, {
        schemaVersion: Number(legacyScenarios?.schemaVersion ?? 0),
        scenarios: Array.isArray(legacyScenarios?.scenarios) ? clone(legacyScenarios.scenarios) : []
      });
      await StorageMigrations.migrateAll();

      await DocumentStateStore.syncPlayerProjections(authoritative, (battle, user) => BattleProjectionService.project(battle, user));
      await this.#redactLegacySettings(authoritative);
    } else if (game.user?.isGM) {
      await DocumentStateStore.waitForAuthoritativeState({ timeoutMs: 3000 });
    } else {
      await DocumentStateStore.waitForProjection(game.user?.id, { timeoutMs: 3000 });
    }

    this.invalidateBattleCache();
    this.initialized = true;
    return true;
  }

  static async #redactLegacySettings(battle) {
    await DocumentStateStore.redactLegacySetting(SETTING_BATTLE, DOCUMENT_STORAGE_ROLES.BATTLE_CORE);
    await DocumentStateStore.redactLegacySetting(SETTING_SAVED_BATTLES, DOCUMENT_STORAGE_ROLES.SNAPSHOTS);
    await DocumentStateStore.redactLegacySetting(SETTING_SHIP_LIBRARY, DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY);
    await DocumentStateStore.redactLegacySetting(SETTING_CREATURE_LIBRARY, DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY);
    await DocumentStateStore.redactLegacySetting(SETTING_BATTLE_SCENARIOS, DOCUMENT_STORAGE_ROLES.SCENARIOS);
  }

  static invalidateBattleCache() {
    this.battleCache = null;
    DocumentStateStore.invalidateCache();
  }

  static getLastChange() {
    return { ...this.lastChange, renderParts: [...(this.lastChange?.renderParts ?? BattleChangeService.ALL_PARTS)] };
  }

  static invalidateBattleConsumers() {
    const app = game.sailshipsCombat?.app;
    if (!app) return;
    app.renderBattleSnapshot = null;
    app.contextBuilder?.invalidate?.();
  }

  static canWriteBattle({ notify = true } = {}) {
    return SocketService.canCurrentUserWrite({ notify, label: "Состояние боя" });
  }

  static getBattle() {
    return this.#readBattle();
  }

  static getBattleForUser(user = game.user) {
    if (!game.user?.isGM) return this.#readBattle();
    const authoritative = this.#readBattle();
    return user?.isGM ? authoritative : BattleProjectionService.project(authoritative, user);
  }

  static getPlayerActionAuth(userId = game.user?.id) {
    return DocumentStateStore.readProjectionAuth(userId);
  }

  static async waitForRevision(revision, options = {}) {
    const ready = await DocumentStateStore.waitForRevision(revision, options);
    this.invalidateBattleCache();
    return ready;
  }

  static #readBattle({ force = false } = {}) {
    let source;
    if (game.user?.isGM) {
      source = DocumentStateStore.readAuthoritativeBattle();
      if (!source) {
        const legacy = game.settings.get(MODULE_ID, SETTING_BATTLE);
        source = legacy?.id ? legacy : createDefaultBattle();
      }
    } else {
      source = DocumentStateStore.readProjection(game.user?.id);
      if (!source) source = BattleProjectionService.project(createDefaultBattle(), game.user);
    }

    const fingerprint = snapshotFingerprint(source);
    if (!force && this.battleCache?.fingerprint === fingerprint) return clone(this.battleCache.battle);
    const readable = game.user?.isGM ? this.normalizeBattle(clone(source)) : clone(source);
    this.battleCache = { fingerprint: snapshotFingerprint(readable), battle: clone(readable) };
    return clone(readable);
  }

  static #currentStoredRevision() {
    return DocumentStateStore.getAuthoritativeRevision();
  }

  static normalizeBattle(battle) {
    return BattleNormalizer.normalize(battle);
  }

  static async saveBattle(battle, options = {}) {
    if (!this.canWriteBattle()) return this.getBattle();
    const snapshot = clone(battle);
    const operation = () => this.#saveBattleUnqueued(snapshot, options);
    const queued = this.mutationQueue.then(operation, operation);
    this.mutationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  static async #saveBattleUnqueued(battle, {
    broadcast = true,
    fromSocket = false,
    expectedRevision = null,
    previousBattle = null,
    reason = "",
    renderParts = null,
    fullReplace = previousBattle == null
  } = {}) {
    if (!this.canWriteBattle()) return this.getBattle();

    const actualRevision = this.#currentStoredRevision();
    if (expectedRevision != null && actualRevision !== Number(expectedRevision)) {
      this.invalidateBattleCache();
      throw new BattleRevisionConflictError(Number(expectedRevision), actualRevision);
    }

    const previous = previousBattle ? clone(previousBattle) : this.#readBattle();
    battle = this.normalizeBattle(battle);
    battle.revision = expectedRevision == null
      ? Math.max(actualRevision + 1, Number(battle.revision ?? 0))
      : Math.max(Number(expectedRevision) + 1, Number(battle.revision ?? 0));
    battle.updated = new Date().toISOString();

    const change = BattleChangeService.analyze(previous, battle, { reason, fullReplace, renderParts });
    if (change.visibilityDirty) VisibilityEngine.updateContacts(battle);
    else VisibilityEngine.normalizeState(battle);

    const stored = clone(battle);
    await DocumentStateStore.writeAuthoritativeBattle(stored);
    const projectionSync = await DocumentStateStore.syncPlayerProjections(stored, (authoritative, user) => BattleProjectionService.project(authoritative, user));
    if (projectionSync.failures.length) {
      ui.notifications.warn(`Состояние боя сохранено, но не удалось обновить ${projectionSync.failures.length} персональных проекций.`);
    }
    this.battleCache = { fingerprint: snapshotFingerprint(stored), battle: clone(stored) };
    this.lastChange = change;
    this.invalidateBattleConsumers();
    if (broadcast) {
      SocketService.broadcastBattleUpdated({
        revision: stored.revision,
        reason: change.reason,
        renderParts: change.renderParts,
        visibilityDirty: change.visibilityDirty
      });
    }
    return clone(stored);
  }

  static async updateBattle(mutator, { broadcast = true, fromSocket = false, reason = "" } = {}) {
    if (!this.canWriteBattle()) return this.getBattle();

    const operation = async () => {
      const battle = this.#readBattle();
      const previousBattle = clone(battle);
      const previousRevision = Math.max(0, Number(battle.revision ?? 0));
      const result = await mutator(battle, { attempt: 0, previousRevision, reason });
      if (result === false) {
        this.lastChange = { reason, visibilityDirty: false, fullReplace: false, renderParts: [] };
        return battle;
      }

      const nextBattle = result && typeof result === "object" ? result : battle;
      nextBattle.revision = previousRevision + 1;
      try {
        return await this.#saveBattleUnqueued(nextBattle, {
          broadcast,
          fromSocket,
          expectedRevision: previousRevision,
          previousBattle,
          reason,
          fullReplace: false
        });
      } catch (error) {
        if (error instanceof BattleRevisionConflictError) {
          ui.notifications.error("Бой изменился в другом клиенте. Действие отменено без повторного броска; обновите окно и повторите команду.");
        }
        throw error;
      }
    };

    const queued = this.mutationQueue.then(operation, operation);
    this.mutationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  static resetMutationQueueForTests() {
    this.mutationQueue = Promise.resolve();
    this.invalidateBattleCache();
    this.lastChange = { reason: "test-reset", visibilityDirty: true, fullReplace: true, renderParts: [...BattleChangeService.ALL_PARTS] };
  }

  static async resetBattle() {
    const battle = createDefaultBattle();
    return this.saveBattle(battle);
  }

  static async createBlankBattle(options = {}) {
    const battle = BattleScenarioService.createBlankBattle(options);
    return this.saveBattle(battle);
  }

  static #readSnapshotEntries({ cloneEntries = true } = {}) {
    const saved = DocumentStateStore.readCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, { schemaVersion: 0, battles: [] });
    const battles = Array.isArray(saved.battles) ? saved.battles : [];
    return cloneEntries ? clone(battles) : battles;
  }

  static getSavedBattleMetadata() {
    if (!game.user?.isGM) return [];
    return this.#readSnapshotEntries({ cloneEntries: false }).map(entry => ({
      id: boundedString(entry?.id, { maxLength: 128 }),
      name: boundedString(entry?.name, { fallback: "Сохранение боя", maxLength: 256 }) || "Сохранение боя",
      saved: boundedString(entry?.saved, { maxLength: 64 })
    }));
  }

  static getSavedBattles({ includeBattle = false } = {}) {
    if (!includeBattle) return this.getSavedBattleMetadata();
    if (!game.user?.isGM) return [];
    return this.#readSnapshotEntries().map(entry => ({
      ...entry,
      battle: this.normalizeBattle(clone(entry.battle))
    }));
  }

  static #fitSnapshotsToBudget(entries) {
    const clean = entries.slice(-SNAPSHOT_LIMIT);
    while (clean.length > 1 && jsonSize({ battles: clean }) > SNAPSHOT_BYTE_BUDGET) clean.shift();
    if (jsonSize({ battles: clean }) > SNAPSHOT_BYTE_BUDGET) {
      throw new Error(`Сохранение боя превышает лимит ${Math.round(SNAPSHOT_BYTE_BUDGET / 1_000_000)} МБ.`);
    }
    return clean;
  }

  static async saveSavedBattles(battles) {
    const clean = (Array.isArray(battles) ? clone(battles) : []).map((entry, index) => ({
      id: boundedString(entry?.id, { fallback: `snapshot-${index + 1}`, maxLength: 128 }),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(entry?.name, { fallback: "Сохранение боя", maxLength: 256 }) || "Сохранение боя",
      saved: boundedString(entry?.saved, { fallback: new Date().toISOString(), maxLength: 64 }),
      battle: this.normalizeBattle(clone(entry?.battle ?? createDefaultBattle()))
    }));
    repairUniqueIds(clean, { prefix: "snapshot", maxLength: 128 });
    if (!SocketService.canCurrentUserWrite({ label: "Сохранения боя" })) return this.getSavedBattles({ includeBattle: true });
    const fitted = this.#fitSnapshotsToBudget(clean);
    await DocumentStateStore.writeCollection(DOCUMENT_STORAGE_ROLES.SNAPSHOTS, { schemaVersion: CURRENT_SCHEMA_VERSION, battles: fitted });
    SocketService.broadcastUpdate("snapshots");
    return fitted;
  }

  static async saveSnapshot(name, battle = null) {
    battle ??= this.#readBattle();
    const now = new Date().toISOString();
    const battles = this.#readSnapshotEntries();
    const snapshotBattle = clone(battle);
    delete snapshotBattle.lastMovement;
    delete snapshotBattle.lastAudioEvent;
    const entry = {
      id: foundry.utils.randomID?.() ?? String(Date.now()),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: boundedString(name || battle.name || "Сохранение боя", { maxLength: 256 }) || "Сохранение боя",
      saved: now,
      battle: this.normalizeBattle(snapshotBattle)
    };
    battles.push(entry);
    const stored = await this.saveSavedBattles(battles);
    return stored.find(item => item.id === entry.id) ?? stored.at(-1);
  }

  static async loadSnapshot(idOrName = null) {
    const battles = this.#readSnapshotEntries();
    if (!battles.length) return null;
    const entry = idOrName
      ? battles.find(b => b.id === idOrName || b.name === idOrName)
      : battles.at(-1);
    if (!entry) return null;
    const battle = this.normalizeBattle(clone(entry.battle));
    delete battle.lastMovement;
    delete battle.lastAudioEvent;
    const savedBattle = await this.saveBattle(battle);
    return {
      entry: {
        id: entry.id,
        name: entry.name,
        saved: entry.saved
      },
      battle: savedBattle
    };
  }

  static async deleteSnapshot(idOrName = null) {
    const battles = this.#readSnapshotEntries();
    if (!battles.length) return null;
    const index = idOrName
      ? battles.findIndex(b => b.id === idOrName || b.name === idOrName)
      : battles.length - 1;
    if (index < 0) return null;
    const [removed] = battles.splice(index, 1);
    await this.saveSavedBattles(battles);
    return removed;
  }

  static normalizeShip(ship) {
    return ShipNormalizer.normalize(clone(ship ?? {}), { battleRound: 1 });
  }

  static cleanShipForLibrary(ship) {
    return ShipNormalizer.cleanForLibrary(ship);
  }

  static getShipLibrary() {
    return ShipLibraryService.getLibrary();
  }

  static async saveShipLibrary(ships) {
    return ShipLibraryService.saveLibrary(ships);
  }

  static async saveShipTemplate(name, ship) {
    return ShipLibraryService.saveTemplate(name, ship);
  }

  static async deleteShipTemplate(idOrIndex = null) {
    return ShipLibraryService.deleteTemplate(idOrIndex);
  }

  static cloneShipForBattle(ship, battle = null, { side = null } = {}) {
    const cloneShip = this.cleanShipForLibrary(ship);
    cloneShip.id = foundry.utils.randomID?.() ?? String(Date.now());
    cloneShip.name = String(cloneShip.name || "Корабль");
    if (battle) {
      const offset = Number(battle.ships?.length ?? 0);
      const sideIds = BattleScenarioService.getSideIds(battle);
      cloneShip.side = sideIds.includes(side) ? side : sideIds[offset % sideIds.length] ?? cloneShip.side ?? "blue";
      const sideOffset = (battle.ships ?? []).filter(unit => unit.side === cloneShip.side).length;
      const spawn = BattleScenarioService.getSideSpawnPoint(battle, cloneShip.side, sideOffset);
      cloneShip.x = spawn.x;
      cloneShip.y = spawn.y;
      cloneShip.heading = spawn.heading ?? cloneShip.heading;
    }
    return cloneShip;
  }

  static normalizeCreature(creature) {
    return CreatureNormalizer.normalize(clone(creature ?? {}), { battleRound: 1 });
  }

  static cleanCreatureForLibrary(creature) {
    return CreatureNormalizer.cleanForLibrary(creature);
  }

  static getCreatureLibrary() {
    return CreatureLibraryService.getLibrary();
  }

  static async saveCreatureLibrary(creatures) {
    return CreatureLibraryService.saveLibrary(creatures);
  }

  static async saveCreatureTemplate(name, creature) {
    return CreatureLibraryService.saveTemplate(name, creature);
  }

  static async deleteCreatureTemplate(idOrIndex = null) {
    return CreatureLibraryService.deleteTemplate(idOrIndex);
  }

  static cloneCreatureForBattle(creature, battle = null, options = {}) {
    return CreatureLibraryService.cloneCreatureForBattle(creature, battle, options);
  }

}
