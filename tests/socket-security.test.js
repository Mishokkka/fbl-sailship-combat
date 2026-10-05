import { installTestEnvironment } from "./test-env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { SocketService } from "../scripts/services/socket-service.js";
import { SocketIntentValidator } from "../scripts/services/socket-intent-validator.js";
import { MODULE_ID, SOCKET_PROTOCOL_VERSION } from "../scripts/utils/constants.js";

const SECRET = Buffer.alloc(32, 7).toString("base64url");
const AUTH = { secret: SECRET, keyVersion: "key-v1", revision: 1 };

function setup() {
  installTestEnvironment();
  SocketService.resetPendingActionsForTests();
  SocketService.clientId = "client-player";
  game.sailshipsCombat = {
    storage: {
      getBattle: () => ({ revision: 5, round: 2, phase: "orders" }),
      getPlayerActionAuth: userId => userId === "player-a" ? AUTH : null
    }
  };
}

test.beforeEach(setup);

test("validator rejects unknown keys and oversized action envelopes", () => {
  const base = {
    module: MODULE_ID,
    protocol: SOCKET_PROTOCOL_VERSION,
    type: "playerAction",
    userId: "player-a",
    clientId: "client",
    keyVersion: "key",
    signature: "signature",
    action: { type: "submitOrder", shipId: "ship", order: "brace", actionId: "action", baseRevision: 0, baseRound: 1, basePhase: "orders" },
    ts: Date.now()
  };
  assert.equal(SocketIntentValidator.validatePlayerAction({ ...base, injected: true }).reason, "unknown-envelope-key");
  assert.equal(SocketIntentValidator.validatePlayerAction({ ...base, signature: "x".repeat(5000) }).reason, "payload-too-large");
});

test("signed player action and signed GM acknowledgement complete a round trip", async () => {
  const player = game.users.get("player-a");
  const gm = game.users.get("gm-a");
  game.user = player;
  let capturedAction = null;
  let capturedResult = null;

  game.socket.emit = (_name, payload) => {
    if (payload.type === "playerAction") {
      capturedAction = structuredClone(payload);
      queueMicrotask(async () => {
        game.user = gm;
        const acceptance = await SocketService.canAcceptPlayerAction(payload);
        assert.equal(acceptance.ok, true);
        await SocketService.sendPlayerActionResult(payload, { status: "accepted", reason: "accepted", currentRevision: 6 });
      });
      return;
    }
    if (payload.type === "playerActionResult") {
      capturedResult = structuredClone(payload);
      queueMicrotask(async () => {
        game.user = player;
        await SocketService.handlePlayerActionResult(payload);
      });
    }
  };

  const response = await SocketService.requestAction({ type: "submitOrder", shipId: "ship-blue", order: "brace" });
  assert.equal(response.ok, true);
  assert.equal(response.currentRevision, 6);
  assert.ok(capturedAction.signature && capturedAction.signature !== "pending");
  assert.ok(capturedResult.signature && capturedResult.signature !== "pending");
  assert.equal(JSON.stringify(capturedAction).includes(SECRET), false);
  assert.equal(JSON.stringify(capturedResult).includes(SECRET), false);
});

test("changing a signed order invalidates the signature", async () => {
  const player = game.users.get("player-a");
  const gm = game.users.get("gm-a");
  game.user = player;
  let capturedAction;
  game.socket.emit = (_name, payload) => {
    capturedAction = structuredClone(payload);
    const pending = SocketService.pendingActions.get(payload.action.actionId);
    clearTimeout(pending.timeoutId);
    SocketService.pendingActions.delete(payload.action.actionId);
    pending.resolve({ ok: false, status: "rejected", reason: "test-capture" });
  };
  await SocketService.requestAction({ type: "submitOrder", shipId: "ship-blue", order: "brace" });
  game.user = gm;
  assert.equal((await SocketService.canAcceptPlayerAction(capturedAction)).ok, true);
  capturedAction.action.order = "boarding";
  const tampered = await SocketService.canAcceptPlayerAction(capturedAction);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, "invalid-action-signature");
});

test("expired signed actions are rejected before signature processing", async () => {
  game.user = game.users.get("gm-a");
  const result = await SocketService.canAcceptPlayerAction({ userId: "player-a", ts: Date.now() - 120_000 });
  assert.deepEqual(result, { ok: false, reason: "expired-action" });
});
