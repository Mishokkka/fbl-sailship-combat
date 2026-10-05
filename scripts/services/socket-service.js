import {
  MODULE_ID,
  ORDER_LABELS,
  SOCKET_NAME,
  SOCKET_PROTOCOL_VERSION,
  SOCKET_UPDATE_SCOPES
} from "../utils/constants.js";
import { uid } from "../utils/random.js";
import { PlayerControlService } from "./player-control-service.js";
import { SocketIntentValidator } from "./socket-intent-validator.js";

const UPDATE_SCOPES = new Set(SOCKET_UPDATE_SCOPES);
const BATTLE_RENDER_PARTS = new Set(["fleet", "board", "summary", "controls"]);
const ACTION_RESPONSE_TIMEOUT_MS = 10_000;

function decodeBase64Url(value) {
  const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function actionSigningMessage(payload) {
  const action = payload?.action ?? {};
  return JSON.stringify([
    "sailships-player-action-v1",
    payload?.module,
    payload?.protocol,
    payload?.type,
    payload?.userId,
    payload?.clientId,
    payload?.keyVersion,
    action.type,
    action.shipId,
    action.order,
    action.actionId,
    action.baseRevision,
    action.baseRound,
    action.basePhase,
    payload?.ts
  ]);
}

function resultSigningMessage(payload) {
  return JSON.stringify([
    "sailships-player-action-result-v1",
    payload?.module,
    payload?.protocol,
    payload?.type,
    payload?.userId,
    payload?.clientId,
    payload?.recipientUserId,
    payload?.recipientClientId,
    payload?.actionId,
    payload?.status,
    payload?.reason,
    payload?.currentRevision,
    payload?.keyVersion,
    payload?.ts
  ]);
}

async function importHmacKey(secret, usages) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto HMAC is unavailable.");
  return crypto.subtle.importKey(
    "raw",
    decodeBase64Url(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

async function signMessage(secret, message) {
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return encodeBase64Url(signature);
}

async function verifyMessage(secret, message, signature) {
  try {
    const key = await importHmacKey(secret, ["verify"]);
    return crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(message)
    );
  } catch (error) {
    console.warn("Sailships Combat | Socket signature verification failed", error);
    return false;
  }
}

export class SocketService {
  static clientId = uid("client");
  static pendingActions = new Map();

  static getTransportTrustModel() {
    return {
      mode: "permissionedDocuments",
      senderIdentityVerified: true,
      recipientPrivacyVerified: true,
      reason: "Authoritative state and player projections use Foundry document ownership. Player commands and GM acknowledgements are authenticated with HMAC keys stored only in the matching projection document.",
      limitations: "Core sockets still expose non-secret update metadata to connected clients. Document ownership remains the security boundary."
    };
  }

  static getAuthoritativeGmId() {
    const contents = game.users?.contents ?? (game.users ? Array.from(game.users) : []);
    const users = Array.isArray(contents) ? contents : Array.from(contents ?? []);
    const activeGms = users
      .map(entry => Array.isArray(entry) ? entry[1] : entry)
      .filter(user => user?.isGM && user?.active !== false)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return activeGms[0]?.id ?? (game.user?.isGM ? game.user.id : null);
  }

  static getAuthoritativeGm() {
    const id = this.getAuthoritativeGmId();
    return id ? game.users?.get?.(id) ?? null : null;
  }

  static isAuthoritativeGm(user = game.user) {
    return Boolean(user?.isGM && user.id === this.getAuthoritativeGmId());
  }

  static canCurrentUserWrite({ notify = true, label = "Состояние модуля" } = {}) {
    if (!game.user?.isGM) {
      if (notify) ui.notifications.warn(`${label}: доступно только ГМу.`);
      return false;
    }
    if (!this.isAuthoritativeGm()) {
      const authority = this.getAuthoritativeGm();
      if (notify) {
        ui.notifications.warn(`${label} изменяет ведущий активный ГМ${authority?.name ? `: ${authority.name}` : ""}. Закройте его клиент или передайте ему управление.`);
      }
      return false;
    }
    return true;
  }

  static register() {
    game.socket.on(SOCKET_NAME, async payload => {
      if (!payload || payload.module !== MODULE_ID) return;
      if (payload.clientId && payload.clientId === this.clientId) return;

      if (payload.type === "battleUpdated") {
        await this.handleExternalUpdate("battle", payload);
        return;
      }

      if (payload.type === "stateUpdated"
        && payload.protocol === SOCKET_PROTOCOL_VERSION
        && UPDATE_SCOPES.has(payload.scope)) {
        await this.handleExternalUpdate(payload.scope, payload);
        return;
      }

      if (payload.type === "playerActionResult") {
        await this.handlePlayerActionResult(payload);
        return;
      }

      if (payload.type === "playerAction" && this.isAuthoritativeGm()) {
        await this.handlePlayerAction(payload);
      }
    });
  }

  static async handlePlayerAction(payload) {
    if (!this.isAuthoritativeGm()) return;
    const validation = SocketIntentValidator.validatePlayerAction(payload);
    if (!validation.ok) return;
    payload = validation.value;

    const acceptance = await this.canAcceptPlayerAction(payload);
    if (!acceptance.ok) {
      await this.sendPlayerActionResult(payload, {
        status: "rejected",
        reason: acceptance.reason,
        currentRevision: game.sailshipsCombat?.storage?.getBattle?.()?.revision ?? 0
      });
      return;
    }

    const action = payload.action;
    if (action.type !== "submitOrder") return;

    const submittedAt = new Date().toISOString();
    let outcome = { ok: false, reason: "invalid-submit-order" };

    try {
      const savedBattle = await game.sailshipsCombat.storage.updateBattle(battle => {
        PlayerControlService.normalizePlayerState(battle);
        battle.processedActionIds ??= [];

        if (battle.processedActionIds.includes(action.actionId)) {
          outcome = { ok: true, duplicate: true, reason: "duplicate" };
          return false;
        }

        const ship = battle.ships.find(candidate => candidate.id === action.shipId);
        const result = PlayerControlService.submitPendingOrder(battle, {
          userId: payload.userId,
          shipId: action.shipId,
          order: action.order,
          actionId: action.actionId,
          baseRevision: action.baseRevision,
          baseRound: action.baseRound,
          basePhase: action.basePhase,
          submittedAt
        });

        if (!ship || !result.ok) {
          outcome = { ok: false, reason: result.reason ?? "invalid-submit-order" };
          return false;
        }
        if (result.duplicate) {
          outcome = { ok: true, duplicate: true, reason: "duplicate" };
          return false;
        }

        battle.processedActionIds.push(action.actionId);
        battle.processedActionIds = battle.processedActionIds.slice(-200);

        const user = game.users?.get?.(payload.userId);
        const userName = user?.name ?? payload.userId;
        const orderLabel = ORDER_LABELS[action.order] ?? action.order;
        battle.log ??= [];
        battle.log.push({
          id: uid("log"),
          round: battle.round ?? 1,
          phase: battle.phase ?? "orders",
          text: `${ship.name}: игрок ${userName} отправил приказ «${orderLabel}».`,
          ts: submittedAt
        });
        outcome = { ok: true, duplicate: false, reason: "accepted" };
        return battle;
      }, {
        broadcast: true,
        fromSocket: true,
        reason: "socket-submit-order"
      });

      await this.sendPlayerActionResult(payload, {
        status: outcome.ok ? "accepted" : "rejected",
        reason: outcome.reason,
        currentRevision: Number(savedBattle?.revision ?? 0)
      });
    } catch (error) {
      console.error("Sailships Combat | Failed to process player action", error);
      await this.sendPlayerActionResult(payload, {
        status: "rejected",
        reason: error?.name === "BattleRevisionConflictError" ? "storage-conflict" : "internal-error",
        currentRevision: game.sailshipsCombat?.storage?.getBattle?.()?.revision ?? 0
      });
    }
  }

  static async canAcceptPlayerAction(payload) {
    if (!payload?.userId) return { ok: false, reason: "invalid-user" };
    const user = game.users?.get?.(payload.userId);
    if (!user || user.isGM || user.active === false) return { ok: false, reason: "inactive-user" };
    const age = Math.abs(Date.now() - Number(payload.ts ?? 0));
    if (age > 60_000) return { ok: false, reason: "expired-action" };

    const auth = game.sailshipsCombat?.storage?.getPlayerActionAuth?.(payload.userId);
    if (!auth?.secret || auth.keyVersion !== payload.keyVersion) return { ok: false, reason: "projection-auth-unavailable" };
    const verified = await verifyMessage(auth.secret, actionSigningMessage(payload), payload.signature);
    if (!verified) return { ok: false, reason: "invalid-action-signature" };
    return { ok: true };
  }

  static async sendPlayerActionResult(requestPayload, {
    status,
    reason,
    currentRevision = 0
  } = {}) {
    if (!game.socket || !requestPayload?.action?.actionId) return false;
    const auth = game.sailshipsCombat?.storage?.getPlayerActionAuth?.(requestPayload.userId);
    if (!auth?.secret || !auth.keyVersion) return false;

    const result = {
      module: MODULE_ID,
      protocol: SOCKET_PROTOCOL_VERSION,
      type: "playerActionResult",
      userId: game.user.id,
      clientId: this.clientId,
      recipientUserId: requestPayload.userId,
      recipientClientId: requestPayload.clientId,
      actionId: requestPayload.action.actionId,
      status,
      reason: String(reason || (status === "accepted" ? "accepted" : "rejected")),
      currentRevision: Math.max(0, Number(currentRevision) || 0),
      keyVersion: auth.keyVersion,
      signature: "pending",
      ts: Date.now()
    };
    result.signature = await signMessage(auth.secret, resultSigningMessage(result));
    game.socket.emit(SOCKET_NAME, result);
    return true;
  }

  static async handlePlayerActionResult(payload) {
    const validation = SocketIntentValidator.validatePlayerActionResult(payload);
    if (!validation.ok) return false;
    const result = validation.value;
    if (result.recipientUserId !== game.user?.id || result.recipientClientId !== this.clientId) return false;

    const pending = this.pendingActions.get(result.actionId);
    if (!pending) return false;
    const sender = game.users?.get?.(result.userId);
    const currentAuthorityId = this.getAuthoritativeGmId();
    if (!sender?.isGM || ![pending.expectedGmId, currentAuthorityId].filter(Boolean).includes(result.userId)) return false;

    const auth = game.sailshipsCombat?.storage?.getPlayerActionAuth?.(game.user?.id);
    if (!auth?.secret || auth.keyVersion !== result.keyVersion) return false;
    const verified = await verifyMessage(auth.secret, resultSigningMessage(result), result.signature);
    if (!verified) return false;

    clearTimeout(pending.timeoutId);
    this.pendingActions.delete(result.actionId);
    pending.resolve({
      ok: result.status === "accepted",
      status: result.status,
      reason: result.reason,
      currentRevision: result.currentRevision,
      actionId: result.actionId
    });
    return true;
  }

  static async handleExternalUpdate(scope, payload = {}) {
    if (scope === "battle") {
      const renderParts = Array.isArray(payload?.renderParts)
        ? [...new Set(payload.renderParts.filter(part => BATTLE_RENDER_PARTS.has(part)))]
        : null;
      const revision = Math.max(0, Number(payload?.revision ?? 0));
      await game.sailshipsCombat?.storage?.waitForRevision?.(revision, { user: game.user, timeoutMs: 2000 });
      game.sailshipsCombat?.storage?.invalidateBattleCache?.();
      game.sailshipsCombat?.app?.onExternalBattleUpdate?.({
        renderParts: renderParts?.length ? renderParts : null,
        revision,
        reason: String(payload?.reason ?? "")
      });
      game.sailshipsCombat?.shipyardApp?.onExternalBattleUpdate?.();
      game.sailshipsCombat?.setupApp?.render?.({ force: true });
      return;
    }
    if (scope === "library" || scope === "creatureLibrary") {
      game.sailshipsCombat?.shipyardApp?.render?.({ force: true });
      return;
    }
    if (scope === "scenarios") {
      game.sailshipsCombat?.setupApp?.render?.({ force: true });
      return;
    }
    if (scope === "snapshots") {
      game.sailshipsCombat?.app?.renderBattleState?.(["controls"]);
    }
  }

  static broadcastUpdate(scope = "battle", metadata = {}) {
    if (!UPDATE_SCOPES.has(scope)) return false;
    const renderParts = Array.isArray(metadata?.renderParts)
      ? [...new Set(metadata.renderParts.filter(part => BATTLE_RENDER_PARTS.has(part)))]
      : undefined;
    game.socket.emit(SOCKET_NAME, {
      module: MODULE_ID,
      protocol: SOCKET_PROTOCOL_VERSION,
      type: "stateUpdated",
      scope,
      userId: game.user.id,
      clientId: this.clientId,
      revision: Math.max(0, Number(metadata?.revision ?? 0)),
      reason: String(metadata?.reason ?? "").slice(0, 128),
      visibilityDirty: Boolean(metadata?.visibilityDirty),
      ...(renderParts?.length ? { renderParts } : {}),
      ts: Date.now()
    });
    return true;
  }

  static broadcastBattleUpdated(metadata = {}) {
    return this.broadcastUpdate("battle", metadata);
  }

  static async requestAction(action) {
    if (!game.socket) {
      return { ok: false, status: "rejected", reason: "socket-unavailable" };
    }

    const battle = game.sailshipsCombat?.storage?.getBattle?.();
    const auth = game.sailshipsCombat?.storage?.getPlayerActionAuth?.(game.user?.id);
    if (!auth?.secret || !auth.keyVersion) {
      return { ok: false, status: "rejected", reason: "projection-auth-unavailable" };
    }

    const preparedAction = {
      ...action,
      actionId: action?.actionId ?? uid("action"),
      baseRevision: action?.baseRevision ?? battle?.revision ?? 0,
      baseRound: action?.baseRound ?? battle?.round ?? 1,
      basePhase: action?.basePhase ?? battle?.phase ?? "orders"
    };
    const envelope = {
      module: MODULE_ID,
      protocol: SOCKET_PROTOCOL_VERSION,
      type: "playerAction",
      userId: game.user.id,
      clientId: this.clientId,
      keyVersion: auth.keyVersion,
      signature: "pending",
      action: preparedAction,
      ts: Date.now()
    };

    try {
      envelope.signature = await signMessage(auth.secret, actionSigningMessage(envelope));
    } catch (error) {
      console.error("Sailships Combat | Could not sign player action", error);
      return { ok: false, status: "rejected", reason: "action-signing-failed" };
    }

    const validation = SocketIntentValidator.validatePlayerAction(envelope);
    if (!validation.ok) {
      return { ok: false, status: "rejected", reason: validation.reason };
    }

    return new Promise(resolve => {
      const actionId = validation.value.action.actionId;
      const timeoutId = setTimeout(() => {
        this.pendingActions.delete(actionId);
        resolve({ ok: false, status: "rejected", reason: "response-timeout", actionId });
      }, ACTION_RESPONSE_TIMEOUT_MS);
      this.pendingActions.set(actionId, {
        resolve,
        timeoutId,
        expectedGmId: this.getAuthoritativeGmId()
      });
      try {
        game.socket.emit(SOCKET_NAME, validation.value);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingActions.delete(actionId);
        resolve({ ok: false, status: "rejected", reason: "socket-unavailable", actionId });
      }
    });
  }

  static resetPendingActionsForTests() {
    for (const pending of this.pendingActions.values()) clearTimeout(pending.timeoutId);
    this.pendingActions.clear();
  }
}
