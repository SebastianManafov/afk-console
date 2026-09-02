import test from "node:test";
import assert from "node:assert/strict";
import { decideAutoGuiJoin, determineControlLock, isNewWorldStable, isStablePlayState, sameAutoGuiJoinConfig } from "../src/connection-safety.js";
import type { MacroRuntime } from "../src/types.js";

const macro = (status: MacroRuntime["status"]): MacroRuntime => ({
  enabled: true, status, phase: status.toUpperCase(), runs: 0, successes: 0,
  lastRun: null, nextRun: null, error: null, startedAt: status === "running" ? new Date().toISOString() : null
});

test("Auto-GUI-Join klickt nur bei passendem Titel und belegtem Slot", () => {
  const config = { autoGuiJoinEnabled: true, autoGuiJoinTitleIncludes: "Serverauswahl", autoGuiJoinSlot: 13 };
  assert.equal(decideAutoGuiJoin("§aServerauswahl", [13], config).allowed, true);
  assert.equal(decideAutoGuiJoin("Spawner", [13], config).allowed, false);
  assert.equal(decideAutoGuiJoin("Serverauswahl", [12], config).allowed, false);
});

test("Leerer GUI-Titel und deaktivierte Funktion können keinen Klick auslösen", () => {
  assert.equal(decideAutoGuiJoin("Menü", [0], { autoGuiJoinEnabled: true, autoGuiJoinTitleIncludes: "", autoGuiJoinSlot: 0 }).allowed, false);
  assert.equal(decideAutoGuiJoin("Menü", [0], { autoGuiJoinEnabled: false, autoGuiJoinTitleIncludes: "Menü", autoGuiJoinSlot: 0 }).allowed, false);
});

test("Ein geplanter Auto-GUI-Klick wird nach jeder Konfigurationsänderung verworfen", () => {
  const original = { autoGuiJoinEnabled: true, autoGuiJoinTitleIncludes: "Serverauswahl", autoGuiJoinSlot: 13, autoGuiJoinDelayMs: 750 };
  assert.equal(sameAutoGuiJoinConfig(original, { ...original }), true);
  assert.equal(sameAutoGuiJoinConfig(original, { ...original, autoGuiJoinEnabled: false }), false);
  assert.equal(sameAutoGuiJoinConfig(original, { ...original, autoGuiJoinSlot: 14 }), false);
  assert.equal(sameAutoGuiJoinConfig(original, { ...original, autoGuiJoinDelayMs: 900 }), false);
});

test("Weltwechsel und Makros sperren manuelle Steuerung", () => {
  assert.deepEqual(determineControlLock("configuring", macro("off"), macro("off")), { locked: true, reason: "World/server change in progress" });
  assert.deepEqual(determineControlLock("stable", macro("running"), macro("off")), { locked: true, reason: "Sell macro is running" });
  assert.deepEqual(determineControlLock("stable", macro("off"), macro("running")), { locked: true, reason: "Spawner macro is running" });
  assert.deepEqual(determineControlLock("stable", macro("off"), macro("off"), true), { locked: true, reason: "Manual controls are active" });
  assert.deepEqual(determineControlLock("stable", macro("waiting"), macro("success")), { locked: false, reason: null });
});

test("Respawn darf Bewegung nur im stabilen Play-State reaktivieren", () => {
  assert.equal(isStablePlayState("online", "play", "stable"), true);
  assert.equal(isStablePlayState("online", "play", "waiting_world"), false);
  assert.equal(isStablePlayState("online", "configuration", "stable"), false);
  assert.equal(isStablePlayState("reconnecting", "play", "stable"), false);
});

test("Neue Welt wird erst nach Play-State, Entity und Sicherheitsdelay freigegeben", () => {
  assert.equal(isNewWorldStable("configuration", true, 2_000), false);
  assert.equal(isNewWorldStable("play", false, 2_000), false);
  assert.equal(isNewWorldStable("play", true, 1_499), false);
  assert.equal(isNewWorldStable("play", true, 1_500), true);
});
