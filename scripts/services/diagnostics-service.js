import {
  CURRENT_SCHEMA_VERSION,
  MODULE_ID,
  SETTING_BATTLE,
  SETTING_SAVED_BATTLES,
  SETTING_SHIP_LIBRARY,
  SETTING_CREATURE_LIBRARY,
  SETTING_BATTLE_SCENARIOS
} from "../utils/constants.js";
import { DocumentStateStore, DOCUMENT_STORAGE_ROLES } from "./document-state-store.js";
import { SocketService } from "./socket-service.js";
import { jsonSize } from "../utils/schema.js";

const REQUIRED_GM_ROLES = Object.freeze([
  DOCUMENT_STORAGE_ROLES.BATTLE_CORE,
  DOCUMENT_STORAGE_ROLES.BATTLE_LOG,
  DOCUMENT_STORAGE_ROLES.BATTLE_RUNTIME,
  DOCUMENT_STORAGE_ROLES.SNAPSHOTS,
  DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY,
  DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY,
  DOCUMENT_STORAGE_ROLES.SCENARIOS
]);

const COLLECTION_ROLES = Object.freeze([
  DOCUMENT_STORAGE_ROLES.SNAPSHOTS,
  DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY,
  DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY,
  DOCUMENT_STORAGE_ROLES.SCENARIOS
]);

const LEGACY_SETTINGS = Object.freeze([
  [SETTING_BATTLE, DOCUMENT_STORAGE_ROLES.BATTLE_CORE],
  [SETTING_SAVED_BATTLES, DOCUMENT_STORAGE_ROLES.SNAPSHOTS],
  [SETTING_SHIP_LIBRARY, DOCUMENT_STORAGE_ROLES.SHIP_LIBRARY],
  [SETTING_CREATURE_LIBRARY, DOCUMENT_STORAGE_ROLES.CREATURE_LIBRARY],
  [SETTING_BATTLE_SCENARIOS, DOCUMENT_STORAGE_ROLES.SCENARIOS]
]);

function users() {
  const contents = game.users?.contents ?? Array.from(game.users ?? []);
  return Array.from(contents ?? []).map(entry => Array.isArray(entry) ? entry[1] : entry).filter(Boolean);
}

function check(id, status, message, details = null) {
  return { id, status, message, ...(details == null ? {} : { details }) };
}

function ownershipLevel(entry, userId) {
  return Number(entry?.ownership?.[String(userId)] ?? entry?.ownership?.default ?? 0);
}

function collectionVersion(role) {
  return Number(DocumentStateStore.readCollection(role, { schemaVersion: 0 })?.schemaVersion ?? 0);
}

export class DiagnosticsService {
  static run({ log = true } = {}) {
    const checks = [];
    const currentUser = game.user;
    const authorityId = SocketService.getAuthoritativeGmId();

    if (!currentUser?.isGM) {
      checks.push(check("gm-access", "error", "Полная диагностика доступна только ГМу."));
      return this.finish(checks, { log });
    }

    checks.push(check(
      "authority",
      authorityId ? "ok" : "error",
      authorityId === currentUser.id
        ? "Текущий клиент является ведущим записывающим ГМом."
        : authorityId
          ? `Ведущий записывающий ГМ: ${game.users?.get?.(authorityId)?.name ?? authorityId}.`
          : "Нет активного ведущего ГМа.",
      { authorityId, currentUserId: currentUser.id }
    ));

    for (const role of REQUIRED_GM_ROLES) {
      const entry = DocumentStateStore.findEntry(role);
      const defaultLevel = Number(entry?.ownership?.default ?? 0);
      checks.push(check(
        `document:${role}`,
        entry && defaultLevel === 0 ? "ok" : "error",
        entry
          ? defaultLevel === 0
            ? `Служебный документ ${role} существует и закрыт по умолчанию.`
            : `Служебный документ ${role} доступен обычным пользователям на уровне ${defaultLevel}.`
          : `Служебный документ ${role} отсутствует.`,
        entry ? { id: entry.id, defaultOwnership: defaultLevel } : null
      ));
    }

    const battle = DocumentStateStore.readAuthoritativeBattle();
    if (!battle) {
      checks.push(check("battle", "error", "Авторитетное состояние боя не читается."));
    } else {
      const unitIds = (battle.ships ?? []).map(unit => String(unit?.id ?? "")).filter(Boolean);
      const duplicateIds = unitIds.filter((id, index) => unitIds.indexOf(id) !== index);
      const invalidSchemas = (battle.ships ?? []).filter(unit => Number(unit?.schemaVersion ?? 0) !== CURRENT_SCHEMA_VERSION).map(unit => unit?.id ?? unit?.name);
      checks.push(check(
        "battle-schema",
        Number(battle.schemaVersion) === CURRENT_SCHEMA_VERSION ? "ok" : "error",
        `Схема активного боя: v${Number(battle.schemaVersion ?? 0)}, ожидается v${CURRENT_SCHEMA_VERSION}.`,
        { revision: Number(battle.revision ?? 0), units: unitIds.length }
      ));
      checks.push(check(
        "battle-unit-ids",
        duplicateIds.length ? "error" : "ok",
        duplicateIds.length ? `Найдены повторяющиеся ID: ${[...new Set(duplicateIds)].join(", ")}.` : "ID боевых единиц уникальны."
      ));
      checks.push(check(
        "battle-unit-schemas",
        invalidSchemas.length ? "error" : "ok",
        invalidSchemas.length ? `Неактуальная схема у единиц: ${invalidSchemas.join(", ")}.` : "Все боевые единицы используют текущую схему."
      ));
      const bytes = jsonSize(battle);
      checks.push(check(
        "battle-size",
        bytes > 3_000_000 ? "warning" : "ok",
        `Размер активного состояния: ${(bytes / 1_000_000).toFixed(2)} МБ.`,
        { bytes }
      ));

      for (const user of users().filter(candidate => !candidate.isGM)) {
        const entry = DocumentStateStore.findEntry(DOCUMENT_STORAGE_ROLES.PLAYER_PROJECTION, user.id);
        const projection = DocumentStateStore.readProjection(user.id);
        const auth = DocumentStateStore.readProjectionAuth(user.id);
        const projectionRevision = Number(projection?.revision ?? -1);
        const expectedRevision = Number(battle.revision ?? 0);
        const privateEnough = entry && Number(entry.ownership?.default ?? 0) === 0 && ownershipLevel(entry, user.id) >= 2;
        checks.push(check(
          `projection:${user.id}`,
          entry && projection && auth?.secret && projectionRevision === expectedRevision && privateEnough ? "ok" : "error",
          entry && projection
            ? `Проекция ${user.name ?? user.id}: revision ${projectionRevision}/${expectedRevision}, права ${privateEnough ? "корректны" : "некорректны"}.`
            : `Проекция для ${user.name ?? user.id} отсутствует.`,
          { userId: user.id, projectionRevision, expectedRevision, hasAuth: Boolean(auth?.secret), privateEnough }
        ));
      }
    }

    for (const role of COLLECTION_ROLES) {
      const version = collectionVersion(role);
      checks.push(check(
        `collection:${role}`,
        version === CURRENT_SCHEMA_VERSION ? "ok" : "error",
        `Схема коллекции ${role}: v${version}, ожидается v${CURRENT_SCHEMA_VERSION}.`
      ));
    }

    for (const [settingKey, expectedRole] of LEGACY_SETTINGS) {
      let value = null;
      try {
        value = game.settings.get(MODULE_ID, settingKey);
      } catch (_error) {
        continue;
      }
      const redacted = value?.storageBackend === "permissioned-journal" && value?.storageRole === expectedRole;
      checks.push(check(
        `legacy-setting:${settingKey}`,
        redacted ? "ok" : "warning",
        redacted ? `World setting ${settingKey} очищен.` : `World setting ${settingKey} ещё не заменён безопасным указателем.`
      ));
    }

    return this.finish(checks, { log });
  }

  static finish(checks, { log = true } = {}) {
    const counts = {
      ok: checks.filter(item => item.status === "ok").length,
      warning: checks.filter(item => item.status === "warning").length,
      error: checks.filter(item => item.status === "error").length
    };
    const report = {
      ok: counts.error === 0,
      generatedAt: new Date().toISOString(),
      counts,
      checks
    };
    if (log) {
      console.groupCollapsed?.(`Sailships Combat diagnostics: ${counts.error} errors, ${counts.warning} warnings`);
      console.table?.(checks.map(item => ({ status: item.status, check: item.id, message: item.message })));
      console.groupEnd?.();
    }
    return report;
  }
}
