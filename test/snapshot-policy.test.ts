import assert from "node:assert/strict";
import test from "node:test";
import { selectPrimarySnapshot } from "../src/snapshot-policy.js";
import type { BotSnapshot } from "../src/types.js";

const snapshot = (accountId: string, connection: BotSnapshot["connection"]): BotSnapshot => ({ accountId, connection } as BotSnapshot);

test("MultiBot-Snapshot zeigt den relevantesten Verbindungszustand", () => {
  const offline = snapshot("offline", "offline");
  const reconnecting = snapshot("retry", "reconnecting");
  const connecting = snapshot("login", "connecting");
  const online = snapshot("ready", "online");
  assert.equal(selectPrimarySnapshot([offline, reconnecting, connecting])?.accountId, "login");
  assert.equal(selectPrimarySnapshot([offline, online, connecting])?.accountId, "ready");
  assert.equal(selectPrimarySnapshot([]), null);
});
