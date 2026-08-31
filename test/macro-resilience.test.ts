import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Bot } from "mineflayer";
import { DEFAULT_CONFIG, type ConfigReader } from "../src/config.js";
import { AppEvents } from "../src/events.js";
import { SellMacro } from "../src/sell-macro.js";
import { SpawnerMacro } from "../src/spawner-macro.js";
import type { WebhookNotifier } from "../src/webhook.js";

const webhook = { send: async () => false } as unknown as WebhookNotifier;

test("Sell-Fehler aus Bot-Chat werden abgefangen", async () => {
  const config = structuredClone(DEFAULT_CONFIG); config.sell.enabled = true;
  const reader: ConfigReader = { get: () => structuredClone(config) };
  const macro = new SellMacro(new AppEvents(false), reader, webhook);
  const bot = { on() {}, removeListener() {}, inventory: { items: () => [{ name: "bone", count: 64, stackSize: 64, slot: 9 }] }, chat: () => { throw new Error("chat failed"); } } as unknown as Bot;
  macro.attach(bot); await macro.runNow();
  assert.equal(macro.snapshot().status, "error"); assert.match(macro.snapshot().error ?? "", /chat failed/); macro.detach();
});

test("Spawner-Fehler vor dem GUI werden abgefangen", async () => {
  const config = structuredClone(DEFAULT_CONFIG); config.spawner.enabled = true; config.spawner.homeTopCommand = ""; config.spawner.homeBottomCommand = ""; config.spawner.movementStepMs = 50;
  const reader: ConfigReader = { get: () => structuredClone(config) };
  const macro = new SpawnerMacro(new AppEvents(false), reader, webhook);
  const bot = { on() {}, removeListener() {}, setControlState() {}, waitForChunksToLoad: async () => { throw new Error("chunks failed"); } } as unknown as Bot;
  macro.attach(bot); await macro.runNow();
  assert.equal(macro.snapshot().status, "error"); assert.match(macro.snapshot().error ?? "", /chunks failed/); macro.detach();
});

test("Makros hinterlassen nach Weltwechseln keine doppelten GUI-Listener", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const reader: ConfigReader = { get: () => structuredClone(config) };
  const bot = new EventEmitter() as unknown as Bot;
  const sell = new SellMacro(new AppEvents(false), reader, webhook);
  const spawner = new SpawnerMacro(new AppEvents(false), reader, webhook);
  sell.attach(bot); sell.attach(bot);
  spawner.attach(bot); spawner.attach(bot);
  assert.equal((bot as unknown as EventEmitter).listenerCount("windowOpen"), 2);
  sell.detach(); spawner.detach();
  assert.equal((bot as unknown as EventEmitter).listenerCount("windowOpen"), 0);
  sell.attach(bot); spawner.attach(bot);
  assert.equal((bot as unknown as EventEmitter).listenerCount("windowOpen"), 2);
  sell.detach(); spawner.detach();
});
