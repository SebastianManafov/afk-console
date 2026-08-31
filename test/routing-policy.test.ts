import assert from "node:assert/strict";
import test from "node:test";
import { selectRoutedAccountId } from "../src/routing-policy.js";
import type { BotSnapshot } from "../src/types.js";

const snapshot = (accountId: string, connection: BotSnapshot["connection"]): BotSnapshot => ({ accountId, connection } as BotSnapshot);

test("Chat und Steuerung werden mit accountId eindeutig geroutet", () => {
  const bots = [snapshot("eins", "online"), snapshot("zwei", "online")];
  assert.equal(selectRoutedAccountId(bots, "zwei"), "zwei");
  assert.throws(() => selectRoutedAccountId(bots), /accountId ist erforderlich/);
  assert.throws(() => selectRoutedAccountId(bots, "fehlt"), /Account nicht gefunden/);
});

test("Ohne accountId bleibt genau ein Online-Account abwärtskompatibel", () => {
  assert.equal(selectRoutedAccountId([snapshot("offline", "offline"), snapshot("online", "online")]), "online");
});
