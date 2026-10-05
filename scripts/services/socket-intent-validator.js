import {
  MODULE_ID,
  ORDER_IDS,
  SOCKET_MAX_PAYLOAD_BYTES,
  SOCKET_PROTOCOL_VERSION
} from "../utils/constants.js";
import {
  boundedString,
  hasOnlyKeys,
  isPlainObject,
  jsonSize
} from "../utils/schema.js";

const ACTION_ENVELOPE_KEYS = new Set(["module", "protocol", "type", "userId", "clientId", "keyVersion", "signature", "action", "ts"]);
const ACTION_KEYS = new Set([
  "type",
  "shipId",
  "order",
  "actionId",
  "baseRevision",
  "baseRound",
  "basePhase"
]);
const RESULT_ENVELOPE_KEYS = new Set([
  "module",
  "protocol",
  "type",
  "userId",
  "clientId",
  "recipientUserId",
  "recipientClientId",
  "actionId",
  "status",
  "reason",
  "currentRevision",
  "keyVersion",
  "signature",
  "ts"
]);
const VALID_ORDERS = new Set(ORDER_IDS);
const VALID_RESULT_STATUSES = new Set(["accepted", "rejected"]);

function invalid(reason) {
  return { ok: false, reason };
}

function validId(value, maxLength = 128) {
  const normalized = boundedString(value, { maxLength });
  return normalized && normalized === value ? normalized : null;
}

export class SocketIntentValidator {
  static validatePlayerAction(payload) {
    if (!isPlainObject(payload)) return invalid("invalid-envelope");
    if (jsonSize(payload) > SOCKET_MAX_PAYLOAD_BYTES) return invalid("payload-too-large");
    if (!hasOnlyKeys(payload, ACTION_ENVELOPE_KEYS)) return invalid("unknown-envelope-key");
    if (payload.module !== MODULE_ID) return invalid("wrong-module");
    if (payload.protocol !== SOCKET_PROTOCOL_VERSION) return invalid("unsupported-protocol");
    if (payload.type !== "playerAction") return invalid("unsupported-message-type");

    const userId = validId(payload.userId);
    const clientId = validId(payload.clientId);
    const keyVersion = validId(payload.keyVersion);
    const signature = validId(payload.signature, 256);
    if (!userId) return invalid("invalid-user-id");
    if (!clientId) return invalid("invalid-client-id");
    if (!keyVersion) return invalid("invalid-key-version");
    if (!signature) return invalid("invalid-signature");
    if (!Number.isSafeInteger(payload.ts) || payload.ts < 0) return invalid("invalid-timestamp");

    const action = payload.action;
    if (!isPlainObject(action) || !hasOnlyKeys(action, ACTION_KEYS)) return invalid("invalid-action");
    if (action.type !== "submitOrder") return invalid("unsupported-action-type");

    const shipId = validId(action.shipId);
    const actionId = validId(action.actionId);
    const order = boundedString(action.order, { maxLength: 64 });
    const basePhase = boundedString(action.basePhase, { maxLength: 64 });
    if (!shipId) return invalid("invalid-ship-id");
    if (!actionId) return invalid("invalid-action-id");
    if (!VALID_ORDERS.has(order) || order !== action.order) return invalid("invalid-order");
    if (!Number.isSafeInteger(action.baseRevision) || action.baseRevision < 0) return invalid("invalid-base-revision");
    if (!Number.isSafeInteger(action.baseRound) || action.baseRound < 1) return invalid("invalid-base-round");
    if (!basePhase || basePhase !== action.basePhase) return invalid("invalid-base-phase");

    return {
      ok: true,
      value: {
        module: MODULE_ID,
        protocol: SOCKET_PROTOCOL_VERSION,
        type: "playerAction",
        userId,
        clientId,
        keyVersion,
        signature,
        action: {
          type: "submitOrder",
          shipId,
          order,
          actionId,
          baseRevision: action.baseRevision,
          baseRound: action.baseRound,
          basePhase
        },
        ts: payload.ts
      }
    };
  }

  static validatePlayerActionResult(payload) {
    if (!isPlainObject(payload)) return invalid("invalid-result-envelope");
    if (jsonSize(payload) > SOCKET_MAX_PAYLOAD_BYTES) return invalid("payload-too-large");
    if (!hasOnlyKeys(payload, RESULT_ENVELOPE_KEYS)) return invalid("unknown-result-envelope-key");
    if (payload.module !== MODULE_ID) return invalid("wrong-module");
    if (payload.protocol !== SOCKET_PROTOCOL_VERSION) return invalid("unsupported-protocol");
    if (payload.type !== "playerActionResult") return invalid("unsupported-message-type");

    const userId = validId(payload.userId);
    const clientId = validId(payload.clientId);
    const recipientUserId = validId(payload.recipientUserId);
    const recipientClientId = validId(payload.recipientClientId);
    const actionId = validId(payload.actionId);
    const keyVersion = validId(payload.keyVersion);
    const signature = validId(payload.signature, 256);
    const reason = boundedString(payload.reason, { maxLength: 128 });
    if (!userId) return invalid("invalid-user-id");
    if (!clientId) return invalid("invalid-client-id");
    if (!recipientUserId) return invalid("invalid-recipient-user-id");
    if (!recipientClientId) return invalid("invalid-recipient-client-id");
    if (!actionId) return invalid("invalid-action-id");
    if (!keyVersion) return invalid("invalid-key-version");
    if (!signature) return invalid("invalid-signature");
    if (!VALID_RESULT_STATUSES.has(payload.status)) return invalid("invalid-result-status");
    if (!reason || reason !== payload.reason) return invalid("invalid-result-reason");
    if (!Number.isSafeInteger(payload.currentRevision) || payload.currentRevision < 0) return invalid("invalid-current-revision");
    if (!Number.isSafeInteger(payload.ts) || payload.ts < 0) return invalid("invalid-timestamp");

    return {
      ok: true,
      value: {
        module: MODULE_ID,
        protocol: SOCKET_PROTOCOL_VERSION,
        type: "playerActionResult",
        userId,
        clientId,
        recipientUserId,
        recipientClientId,
        actionId,
        status: payload.status,
        reason,
        currentRevision: payload.currentRevision,
        keyVersion,
        signature,
        ts: payload.ts
      }
    };
  }
}
