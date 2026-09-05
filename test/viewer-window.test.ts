import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { AppEvents } from "../src/events.js";
import { BotService } from "../src/bot-service.js";
import { registerViewerControlHandlers } from "../src/viewer-control-socket.js";
import { ViewerControlDeniedError, parseViewerWindowClick, validateViewerWindowClick } from "../src/viewer-control.js";
import { registerViewerWindowSync, serializeViewerWindow } from "../src/viewer-window.js";

const require = createRequire(import.meta.url);

test("Bot POV right-click routes entity, block, and held-item targets in order", async () => {
  const previousEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  process.env.CONFIG_ENCRYPTION_KEY = "viewer-window-routing-test-key-1234567890";
  let service: BotService | null = null;
  try {
    service = new BotService({ get: () => DEFAULT_CONFIG }, new AppEvents(false), { send: async () => false } as any, process.cwd(), "account-a");
    const internal = service as any;
    const calls: string[] = [];
    const entity = { type: "player", username: "Synthetic" };
    const block = { name: "chest" };
    internal.bot = {
      _client: { state: "play" },
      entity: { position: { x: 0, y: 64, z: 0 } },
      player: { ping: 0 },
      username: "Synthetic viewer bot",
      health: 20,
      food: 20,
      experience: { level: 0 },
      inventory: { slots: [], items: () => [] },
      currentWindow: null,
      quickBarSlot: 0,
      heldItem: null,
      physicsEnabled: true,
      entityAtCursor: () => entity,
      blockAtCursor: () => block,
      activateEntity: async () => { calls.push("entity"); },
      activateBlock: async () => { calls.push("block"); },
      activateItem: () => { calls.push("item"); },
      deactivateItem: () => { calls.push("release"); },
      setControlState: () => {},
      clearControlStates: () => {},
      stopDigging: () => {},
      look: async () => {},
      quit: () => {}
    };
    internal.connection = "online";
    internal.worldTransition = { state: "stable", startedAt: null, message: "Ready" };
    internal.movementPhysicsReady = true;
    internal.publish = () => {};
    service.acquireViewerControl("account-a", "controller");

    await service.viewerControl("account-a", "controller", { kind: "action", action: "use", enabled: true });
    assert.deepEqual(calls, ["entity"]);
    internal.bot.entityAtCursor = () => null;
    await service.viewerControl("account-a", "controller", { kind: "action", action: "use", enabled: true });
    assert.deepEqual(calls, ["entity", "block"]);
    internal.bot.blockAtCursor = () => null;
    await service.viewerControl("account-a", "controller", { kind: "action", action: "use", enabled: true });
    assert.deepEqual(calls, ["entity", "block", "item"]);
    await service.viewerControl("account-a", "controller", { kind: "action", action: "use", enabled: false });
    assert.deepEqual(calls, ["entity", "block", "item", "release"]);
  } finally {
    service?.dispose();
    if (previousEncryptionKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

test("viewer window payloads retain authoritative IDs, names, titles, and counts", () => {
  const slots = Array.from({ length: 63 }, () => null as any);
  slots[0] = { type: 52, name: "chest", displayName: "Custom Chest", count: 1, metadata: 0 };
  slots[27] = { type: 264, name: "diamond", displayName: "Diamond", count: 12, metadata: 2 };
  const payload = serializeViewerWindow({ id: 7, type: "minecraft:generic_9x3", title: { text: "Spawner Menu" }, inventoryStart: 27, slots });
  assert.equal(payload?.id, 7);
  assert.equal(payload?.type, "minecraft:generic_9x3");
  assert.equal(payload?.title, "Spawner Menu");
  assert.equal(payload?.slots.length, 63);
  assert.deepEqual(payload?.slots[0], { slot: 0, id: 52, name: "chest", displayName: "Custom Chest", count: 1 });
  assert.deepEqual(payload?.slots[27], { slot: 27, id: 264, name: "diamond", displayName: "Diamond", count: 12, metadata: 2 });
  assert.equal(serializeViewerWindow({ id: 7, type: "minecraft:generic_9x3", title: "bad", inventoryStart: 27, slots: [{ type: 1, name: "stone", displayName: "Stone", count: 0 }] }), null);
});

test("viewer window click validation rejects malformed and stale window input", () => {
  assert.deepEqual(parseViewerWindowClick({ windowId: 4, slot: 12, mouseButton: 1, mode: 1 }), { windowId: 4, slot: 12, mouseButton: 1, mode: 1 });
  assert.equal(parseViewerWindowClick({ windowId: 4, slot: 12, mouseButton: 0, mode: 2 }), null);
  const window = { id: 4, slots: Array(27).fill(null) };
  assert.deepEqual(validateViewerWindowClick({ windowId: 4, slot: 26, mouseButton: 0, mode: 0 }, window).slot, 26);
  assert.throws(() => validateViewerWindowClick({ windowId: 5, slot: 0, mouseButton: 0, mode: 0 }, window), (error: unknown) => error instanceof ViewerControlDeniedError && error.reason === "stale_window");
  assert.throws(() => validateViewerWindowClick({ windowId: 4, slot: 27, mouseButton: 0, mode: 0 }, window), (error: unknown) => error instanceof ViewerControlDeniedError && error.reason === "invalid_input");
});

test("BotService executes GUI clicks only for the current window and closes that window", async () => {
  const previousEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  process.env.CONFIG_ENCRYPTION_KEY = "viewer-window-click-test-key-1234567890";
  let service: BotService | null = null;
  try {
    service = new BotService({ get: () => DEFAULT_CONFIG }, new AppEvents(false), { send: async () => false } as any, process.cwd(), "account-a");
    const internal = service as any;
    const calls: Array<unknown> = [];
    const currentWindow = { id: 11, slots: Array(27).fill(null) };
    internal.bot = {
      _client: { state: "play" },
      entity: { position: { x: 0, y: 64, z: 0 } },
      player: { ping: 0 },
      username: "Synthetic viewer bot",
      health: 20,
      food: 20,
      experience: { level: 0 },
      inventory: { slots: [], items: () => [] },
      currentWindow,
      quickBarSlot: 0,
      heldItem: null,
      physicsEnabled: true,
      clickWindow: async (...args: unknown[]) => { calls.push(args); },
      closeWindow: (window: unknown) => { calls.push(["close", window]); internal.bot.currentWindow = null; },
      setControlState: () => {},
      clearControlStates: () => {},
      stopDigging: () => {},
      deactivateItem: () => {},
      look: async () => {},
      quit: () => {}
    };
    internal.connection = "online";
    internal.worldTransition = { state: "stable", startedAt: null, message: "Ready" };
    internal.movementPhysicsReady = true;
    internal.publish = () => {};
    service.acquireViewerControl("account-a", "controller");
    await service.viewerWindowClick("account-a", "controller", { windowId: 11, slot: 2, mouseButton: 1, mode: 1 });
    assert.deepEqual(calls[0], [2, 1, 1]);
    await assert.rejects(() => service!.viewerWindowClick("account-a", "controller", { windowId: 12, slot: 2, mouseButton: 0, mode: 0 }), (error: unknown) => error instanceof ViewerControlDeniedError && error.reason === "stale_window");
    service.viewerWindowClose("account-a", "controller", 11);
    assert.equal((calls[1] as any[])[0], "close");
    assert.throws(() => service!.viewerWindowClose("account-a", "controller", 11), (error: unknown) => error instanceof ViewerControlDeniedError && error.reason === "stale_window");
  } finally {
    service?.dispose();
    if (previousEncryptionKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

test("viewer window sync forwards open, slot updates, player inventory updates, and close", () => {
  const target = new EventEmitter() as any;
  target.inventory = new EventEmitter();
  target.inventory.inventoryStart = 9;
  target.inventory.slots = Array(46).fill(null);
  const window = new EventEmitter() as any;
  window.id = 3;
  window.type = "minecraft:generic_9x1";
  window.title = "Synthetic GUI";
  window.inventoryStart = 9;
  window.slots = Array(45).fill(null);
  window.slots[0] = { type: 1, name: "stone", displayName: "Stone", count: 4 };
  target.currentWindow = window;
  const sent: Array<{ event: string; payload: any }> = [];
  const sync = registerViewerWindowSync({ target, socket: { emit: (event, payload) => sent.push({ event, payload }) } });

  target.emit("windowOpen", window);
  assert.equal(sent.at(-1)?.event, "windowOpen");
  assert.equal(sent.at(-1)?.payload.slots[0].count, 4);
  window.slots[0] = { type: 1, name: "stone", displayName: "Stone", count: 3 };
  window.emit("updateSlot", 0);
  assert.equal(sent.at(-1)?.event, "windowUpdate");
  assert.equal(sent.at(-1)?.payload.slots[0].count, 3);
  target.inventory.slots[9] = { type: 264, name: "diamond", displayName: "Diamond", count: 2 };
  target.inventory.emit("updateSlot", 9);
  assert.equal(sent.at(-1)?.payload.slots[9].name, "diamond");
  target.currentWindow = null;
  target.emit("windowClose", window);
  assert.deepEqual(sent.at(-1), { event: "windowClose", payload: { id: 3 } });
  const countAfterClose = sent.length;
  window.emit("updateSlot", 0);
  assert.equal(sent.length, countAfterClose);
  sync.cleanup();
});

test("viewer socket GUI events are admin-only and validate click modes", async () => {
  class FakeSocket extends EventEmitter {
    id = "window-socket";
    sent: Array<{ event: string; payload?: unknown }> = [];
    override emit(event: string, ...args: any[]): boolean {
      if (["viewerControlCapabilities", "viewerControlDenied"].includes(event)) this.sent.push({ event, payload: args[0] });
      return super.emit(event, ...args);
    }
  }
  const calls: Array<{ kind: string; input?: unknown }> = [];
  const manager = {
    onViewerControlRevoked: () => () => {},
    heartbeatViewerControl: () => true,
    releaseViewerControl: () => true,
    acquireViewerControl: () => {},
    viewerControl: async () => {},
    viewerWindowClick: async (_accountId: string, _controllerId: string, input: unknown) => { calls.push({ kind: "click", input }); },
    viewerWindowClose: (_accountId: string, _controllerId: string, windowId: number) => { calls.push({ kind: "close", input: windowId }); }
  } as any;
  const guest = new FakeSocket();
  const cleanupGuest = registerViewerControlHandlers(guest as any, manager, "account-a", "guest");
  guest.emit("viewerWindowClick", { windowId: 1, slot: 0, mouseButton: 0, mode: 0 });
  assert.equal(calls.length, 0);
  assert.equal(guest.sent.at(-1)?.payload && (guest.sent.at(-1)?.payload as any).reason, "role");
  cleanupGuest();

  const admin = new FakeSocket();
  const cleanupAdmin = registerViewerControlHandlers(admin as any, manager, "account-a", "admin");
  admin.emit("viewerWindowClick", { windowId: 1, slot: 8, mouseButton: 1, mode: 1 });
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), { kind: "click", input: { windowId: 1, slot: 8, mouseButton: 1, mode: 1 } });
  admin.emit("viewerWindowClick", { windowId: 1, slot: 8, mouseButton: 0, mode: 2 });
  assert.equal((admin.sent.at(-1)?.payload as any).reason, "invalid_input");
  admin.emit("viewerWindowClose", { windowId: 1 });
  assert.deepEqual(calls.at(-1), { kind: "close", input: 1 });
  cleanupAdmin();
});

test("viewer window control stays on the lease after pointer lock is released", () => {
  const { createControlSession } = require(join(process.cwd(), "viewer-client/control-session.cjs")) as { createControlSession: (options: Record<string, unknown>) => any };
  const events: Array<{ event: string; payload?: unknown }> = [];
  const session = createControlSession({ emit: (event: string, payload: unknown) => events.push({ event, payload }), setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} });
  session.setCapability(true);
  session.setParentActive(true);
  session.setSocketConnected(true);
  session.setPointerLocked(true);
  session.setLeaseGranted(true);
  session.setWindowOpen(true);
  session.setPointerLocked(false);
  assert.equal(session.canControl, false);
  assert.equal(session.canGuiControl, true);
  assert.equal(session.action("windowClick", { windowId: 2, slot: 0, mouseButton: 0, mode: 0 }), true);
  assert.deepEqual(events.at(-1), { event: "viewerWindowClick", payload: { windowId: 2, slot: 0, mouseButton: 0, mode: 0 } });
  session.setWindowOpen(false);
  assert.equal(session.canGuiControl, false);
  assert.equal(events.at(-1)?.event, "viewerControlRelease");
  session.cleanup();
});

test("Minecraft window layouts select chest rows and supported container geometry", () => {
  const { chestRowCount, getWindowLayout, windowSlotPosition } = require(join(process.cwd(), "viewer-client/window-layout.cjs")) as any;
  assert.equal(chestRowCount("generic_9x6", 54), 6);
  const customChest = getWindowLayout({ type: "minecraft:container", inventoryStart: 18 });
  assert.equal(customChest.kind, "chest");
  assert.equal(customChest.height, 150);
  assert.deepEqual(windowSlotPosition(customChest, 17, 18), { x: 152, y: 36 });
  assert.deepEqual(windowSlotPosition(customChest, 18, 18), { x: 8, y: 68 });
  const hopper = getWindowLayout({ type: "minecraft:hopper", inventoryStart: 5 });
  assert.deepEqual(windowSlotPosition(hopper, 4, 5), { x: 116, y: 20 });
  const furnace = getWindowLayout({ type: "minecraft:blast_furnace", inventoryStart: 3 });
  assert.equal(furnace.asset, "blast_furnace");
  assert.deepEqual(windowSlotPosition(furnace, 2, 3), { x: 116, y: 35 });
});
