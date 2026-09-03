import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { BotService } from "../src/bot-service.js";
import { AppEvents } from "../src/events.js";
import { VIEWER_CONTROL_HEARTBEAT_MS, VIEWER_CONTROL_LEASE_EXPIRY_MS, ViewerControlDeniedError, ViewerControlLease } from "../src/viewer-control.js";
import { registerViewerControlHandlers } from "../src/viewer-control-socket.js";

const require = createRequire(import.meta.url);

test("Viewer lease grants one controller, heartbeats, expires and releases idempotently", () => {
  let now = 0;
  const releases: string[] = [];
  const lease = new ViewerControlLease((reason) => releases.push(reason), { now: () => now, heartbeatMs: 10, expiryMs: 30 });
  lease.acquire("first");
  assert.equal(lease.isActive, true);
  assert.throws(() => lease.acquire("second"), (error: unknown) => error instanceof ViewerControlDeniedError && error.reason === "already_controlled");
  now = 20;
  assert.equal(lease.heartbeat("first"), true);
  now = 49;
  assert.equal(lease.owns("first"), true);
  now = 50;
  assert.equal(lease.isActive, false);
  assert.deepEqual(releases, ["heartbeat timeout"]);
  assert.equal(lease.release("first"), false);
  lease.acquire("second");
  assert.equal(lease.release("first"), false);
  assert.equal(lease.release("second", "explicit release"), true);
  assert.equal(lease.release("second"), false);
  assert.deepEqual(releases, ["heartbeat timeout", "explicit release"]);
});

test("Viewer lease expiry timers can never retain a stale controller", () => {
  const lease = new ViewerControlLease(() => {}, { heartbeatMs: 10, expiryMs: 30 });
  lease.acquire("controller");
  assert.equal(lease.owns("controller"), true);
  lease.forceRelease("test cleanup");
  assert.equal(lease.isActive, false);
});

test("viewer lease tolerates a delayed heartbeat and refreshes from active input", () => {
  let now = 0;
  const releases: string[] = [];
  const lease = new ViewerControlLease((reason) => releases.push(reason), { now: () => now });
  lease.acquire("controller");
  assert.equal(VIEWER_CONTROL_HEARTBEAT_MS, 1_000);
  assert.equal(VIEWER_CONTROL_LEASE_EXPIRY_MS, 5_000);

  // The first three one-second ticks are dropped, but the controller is still
  // within the five-second dead-man window when the next heartbeat arrives.
  now = 4_000;
  assert.equal(lease.heartbeat("controller"), true);
  assert.equal(lease.isActive, true);

  // A valid control packet refreshes the same lease without requiring a
  // second heartbeat before the next expiry window.
  now = 8_500;
  assert.equal(lease.heartbeat("controller"), true);
  assert.equal(lease.isActive, true);
  now = 13_499;
  assert.equal(lease.isActive, true);
  now = 13_500;
  assert.equal(lease.isActive, false);
  assert.deepEqual(releases, ["heartbeat timeout"]);
});

test("BotService refreshes the active lease for valid viewer input", async () => {
  const events = new AppEvents(false);
  const previousEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  process.env.CONFIG_ENCRYPTION_KEY = "viewer-control-test-key-12345678901234567890";
  let service: BotService | null = null;
  let internal: any;
  const controlCalls: Array<[string, boolean]> = [];
  try {
    service = new BotService({ get: () => DEFAULT_CONFIG }, events, { send: async () => false } as any, process.cwd(), "account-a");
    internal = service as any;
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
      setControlState: (control: string, enabled: boolean) => controlCalls.push([control, enabled]),
      physicsEnabled: true,
      clearControlStates: () => {},
      stopDigging: () => {},
      deactivateItem: () => {},
      look: async () => {},
      quit: () => {}
    };
    internal.connection = "online";
    internal.worldTransition = { state: "stable", startedAt: null, message: "Ready" };
    internal.publish = () => {};
    assert.throws(() => service!.acquireViewerControl("account-a", "controller"), (error: unknown) => error instanceof ViewerControlDeniedError && error.reason === "not_ready");
    internal.movementPhysicsReady = true;
    service.acquireViewerControl("account-a", "controller");
    const lease = internal.viewerControlLease;
    const acquiredUntil = lease.expiresAt;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await service.viewerControl("account-a", "controller", { kind: "movement", control: "forward", enabled: true });
    const movementRefreshedUntil = lease.expiresAt;
    assert.ok(movementRefreshedUntil > acquiredUntil);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await service.viewerControl("account-a", "controller", { kind: "look", yaw: 0.5, pitch: 0.25 });
    assert.ok(lease.expiresAt > movementRefreshedUntil);
    assert.deepEqual(controlCalls, [["forward", true]]);
  } finally {
    service?.dispose();
    if (previousEncryptionKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

test("BotService clears Mineflayer movement and interaction state on viewer release", async () => {
  const events = new AppEvents(false);
  const previousEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  process.env.CONFIG_ENCRYPTION_KEY = "viewer-control-release-test-key-1234567890";
  let service: BotService | null = null;
  const cleanupCalls: string[] = [];
  try {
    service = new BotService({ get: () => DEFAULT_CONFIG }, events, { send: async () => false } as any, process.cwd(), "account-a");
    const internal = service as any;
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
      setControlState: () => {},
      clearControlStates: () => cleanupCalls.push("controls"),
      stopDigging: () => cleanupCalls.push("digging"),
      deactivateItem: () => cleanupCalls.push("held item"),
      look: async () => {},
      quit: () => {}
    };
    internal.connection = "online";
    internal.worldTransition = { state: "stable", startedAt: null, message: "Ready" };
    internal.movementPhysicsReady = true;
    internal.publish = () => {};
    service.acquireViewerControl("account-a", "controller");
    internal.viewerControlLease.forceRelease("world transition");
    assert.deepEqual(cleanupCalls, ["controls", "digging", "held item"]);
    assert.equal(internal.viewerControlLease.isActive, false);
  } finally {
    service?.dispose();
    if (previousEncryptionKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

test("control-session heartbeats are reliable while mouse-look stays volatile", () => {
  const events: Array<{ event: string; options?: { reliable?: boolean; volatile?: boolean } }> = [];
  const heartbeatTimers: Array<() => void> = [];
  const { createControlSession } = require(join(process.cwd(), "viewer-client/control-session.cjs")) as { createControlSession: (options: Record<string, unknown>) => any };
  const session = createControlSession({
    emit: (event: string, _payload: unknown, options: { reliable?: boolean; volatile?: boolean }) => events.push({ event, options }),
    setInterval: (callback: () => void) => { heartbeatTimers.push(callback); return 1; },
    clearInterval: () => {},
    setTimeout: (callback: () => void) => { callback(); return 1; },
    clearTimeout: () => {}
  }) as { setCapability(value: boolean): void; setParentActive(value: boolean): void; setSocketConnected(value: boolean): void; setPointerLocked(value: boolean): void; setLeaseGranted(value: boolean): void; look(yaw: number, pitch: number): boolean };
  session.setCapability(true);
  session.setParentActive(true);
  session.setSocketConnected(true);
  session.setPointerLocked(true);
  session.setLeaseGranted(true);
  heartbeatTimers[0]?.();
  session.look(0.5, 0.25);

  const heartbeatEvent = events.find((entry) => entry.event === "viewerControlHeartbeat");
  const lookEvent = events.find((entry) => entry.event === "botLook");
  assert.deepEqual(heartbeatEvent?.options, { reliable: true });
  assert.deepEqual(lookEvent?.options, { volatile: true });
});

test("control-session binds default browser timers to the global object", () => {
  const timerGlobal = globalThis as any;
  const originalSetInterval = timerGlobal.setInterval;
  const originalClearInterval = timerGlobal.clearInterval;
  const originalSetTimeout = timerGlobal.setTimeout;
  const originalClearTimeout = timerGlobal.clearTimeout;
  const assertGlobalContext = function (this: unknown): any {
    assert.equal(this, globalThis);
    return 1;
  };
  try {
    timerGlobal.setInterval = assertGlobalContext;
    timerGlobal.clearInterval = assertGlobalContext;
    timerGlobal.setTimeout = assertGlobalContext;
    timerGlobal.clearTimeout = assertGlobalContext;
    const { createControlSession } = require(join(process.cwd(), "viewer-client/control-session.cjs")) as { createControlSession: (options: Record<string, unknown>) => any };
    const session = createControlSession({});
    session.setCapability(true);
    session.setParentActive(true);
    session.setSocketConnected(true);
    session.setPointerLocked(true);
    session.setLeaseGranted(true);
    assert.equal(session.look(0.5, 0.25), true);
    session.cleanup("test cleanup");
  } finally {
    timerGlobal.setInterval = originalSetInterval;
    timerGlobal.clearInterval = originalClearInterval;
    timerGlobal.setTimeout = originalSetTimeout;
    timerGlobal.clearTimeout = originalClearTimeout;
  }
});

test("browser control session preserves diagonal state and emits authoritative release", async () => {
  const { createControlSession } = require(join(process.cwd(), "viewer-client/control-session.cjs")) as { createControlSession: (options: Record<string, unknown>) => any };
  const events: Array<{ event: string; payload?: unknown; options?: unknown }> = [];
  const session = createControlSession({
    emit: (event: string, payload: unknown, options: unknown) => events.push({ event, payload, options }),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {}
  }) as { setCapability(value: boolean): void; setParentActive(value: boolean): void; setSocketConnected(value: boolean): void; setPointerLocked(value: boolean): void; setLeaseGranted(value: boolean): void; keyDown(value: string): boolean; keyUp(value: string): boolean; releaseControl(reason: string): void; pressedControls: Set<string> };
  session.setCapability(true);
  session.setParentActive(true);
  session.setSocketConnected(true);
  session.setPointerLocked(true);
  assert.equal(events[0]?.event, "viewerControlAcquire");
  session.setLeaseGranted(true);
  assert.equal(session.keyDown("forward"), true);
  assert.equal(session.keyDown("right"), true);
  assert.equal(session.keyUp("forward"), true);
  assert.deepEqual([...session.pressedControls], ["right"]);
  session.releaseControl("pointer lock lost");
  assert.equal(session.pressedControls.size, 0);
  assert.deepEqual(events.slice(-3).map((entry) => [entry.event, (entry.payload as { enabled?: boolean } | undefined)?.enabled]), [
    ["botControl", false],
    ["botControl", false],
    ["viewerControlRelease", undefined]
  ]);
});

test("browser control session replays movement held before the lease grant", () => {
  const { createControlSession } = require(join(process.cwd(), "viewer-client/control-session.cjs")) as { createControlSession: (options: Record<string, unknown>) => any };
  const events: Array<{ event: string; payload?: unknown }> = [];
  const session = createControlSession({
    emit: (event: string, payload: unknown) => events.push({ event, payload }),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {}
  }) as { setCapability(value: boolean): void; setParentActive(value: boolean): void; setSocketConnected(value: boolean): void; setPointerLocked(value: boolean): void; setLeaseGranted(value: boolean): void; keyDown(value: string): boolean; keyUp(value: string): boolean; pressedControls: Set<string> };
  session.setCapability(true);
  session.setParentActive(true);
  session.setSocketConnected(true);
  session.setPointerLocked(true);
  assert.equal(session.keyDown("forward"), false);
  assert.equal(session.keyDown("forward"), false);
  assert.equal(events.filter((entry) => entry.event === "botControl").length, 0);
  session.setLeaseGranted(true);
  assert.equal(session.keyDown("forward"), false);
  assert.deepEqual(events.filter((entry) => entry.event === "botControl").map((entry) => entry.payload), [{ control: "forward", enabled: true }]);
  assert.equal(session.keyUp("forward"), true);
  assert.deepEqual(events.filter((entry) => entry.event === "botControl").map((entry) => entry.payload), [
    { control: "forward", enabled: true },
    { control: "forward", enabled: false }
  ]);
  assert.equal(session.pressedControls.size, 0);
});

test("browser control session releases bot state before entering freecam", () => {
  const { createControlSession } = require(join(process.cwd(), "viewer-client/control-session.cjs")) as { createControlSession: (options: Record<string, unknown>) => any };
  const events: Array<{ event: string; payload?: unknown }> = [];
  const session = createControlSession({
    emit: (event: string, payload: unknown) => events.push({ event, payload }),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {}
  }) as { setCapability(value: boolean): void; setParentActive(value: boolean): void; setSocketConnected(value: boolean): void; setPointerLocked(value: boolean): void; setLeaseGranted(value: boolean): void; setMode(value: string): void; keyDown(value: string): boolean; look(yaw: number, pitch: number): boolean; canControl: boolean };
  session.setCapability(true);
  session.setParentActive(true);
  session.setSocketConnected(true);
  session.setPointerLocked(true);
  session.setLeaseGranted(true);
  assert.equal(session.keyDown("forward"), true);
  assert.equal(session.keyDown("right"), true);
  const switchStart = events.length;

  session.setMode("freecam");

  assert.equal(session.canControl, false);
  assert.equal(session.keyDown("forward"), false);
  assert.equal(session.look(0.5, 0.25), false);
  assert.deepEqual(events.slice(switchStart).map((entry) => [entry.event, (entry.payload as { control?: string; enabled?: boolean } | undefined)?.control, (entry.payload as { enabled?: boolean } | undefined)?.enabled]), [
    ["botControl", "forward", false],
    ["botControl", "right", false],
    ["viewerControlRelease", undefined, undefined]
  ]);
});

test("POV selection releases before switching and replays replacement iframe activation", async () => {
  const { createPovSelectionController } = await import(pathToFileURL(join(process.cwd(), "public/pov-selection.js")).href) as { createPovSelectionController: (options: Record<string, unknown>) => any };
  const calls: string[] = [];
  const selection = createPovSelectionController({
    sendActivation: (accountId: string, active: boolean) => calls.push(`message:${accountId}:${active}`),
    setCardMaximized: (accountId: string, active: boolean) => calls.push(`card:${accountId}:${active}`),
    onSelectionChanged: (accountId: string | null) => calls.push(`selected:${accountId}`)
  });
  selection.select("a");
  const switchStart = calls.length;
  selection.select("b");
  assert.deepEqual(calls.slice(switchStart), ["message:a:false", "card:a:false", "selected:b", "card:b:true", "message:b:true"]);
  selection.prepareRebuild();
  selection.handleReady("b");
  assert.deepEqual(calls.slice(-2), ["message:b:false", "message:b:true"]);
  selection.minimize("b");
  assert.equal(selection.activeAccountId, null);
});

test("POV selection propagates the chosen mode to the active viewer", async () => {
  const { createPovSelectionController } = await import(pathToFileURL(join(process.cwd(), "public/pov-selection.js")).href) as { createPovSelectionController: (options: Record<string, unknown>) => any };
  const activations: Array<{ accountId: string; active: boolean; mode?: string }> = [];
  const selection = createPovSelectionController({
    sendActivation: (accountId: string, active: boolean, mode?: string) => activations.push({ accountId, active, mode }),
    setCardMaximized: () => {}
  });

  assert.equal(selection.setMode("freecam"), true);
  selection.select("a");
  assert.deepEqual(activations.at(-1), { accountId: "a", active: true, mode: "freecam" });
  assert.equal(selection.setMode("bot"), true);
  assert.deepEqual(activations.at(-1), { accountId: "a", active: true, mode: "bot" });
});

test("viewer socket handlers keep guests read-only and bind admin input to the socket account", async () => {
  class FakeSocket extends EventEmitter {
    id = "socket-a";
    sent: Array<{ event: string; payload?: unknown }> = [];
    override emit(event: string, ...args: any[]): boolean {
      if (["viewerControlCapabilities", "viewerControlDenied", "viewerControlGranted", "viewerControlRevoked"].includes(event)) this.sent.push({ event, payload: args[0] });
      return super.emit(event, ...args);
    }
  }
  const calls: Array<{ kind: string; accountId: string; input?: unknown }> = [];
  const manager = {
    onViewerControlRevoked: () => () => {},
    acquireViewerControl: (accountId: string) => { calls.push({ kind: "acquire", accountId }); },
    heartbeatViewerControl: () => true,
    releaseViewerControl: () => true,
    viewerControl: async (accountId: string, _controllerId: string, input: unknown) => { calls.push({ kind: "control", accountId, input }); }
  } as any;
  const guest = new FakeSocket();
  const cleanupGuest = registerViewerControlHandlers(guest as any, manager, "account-a", "guest");
  guest.emit("viewerControlAcquire");
  assert.equal(guest.sent.some((entry) => entry.event === "viewerControlCapabilities" && (entry.payload as { canControl: boolean }).canControl === false), true);
  assert.equal(guest.sent.some((entry) => entry.event === "viewerControlDenied" && (entry.payload as { reason: string }).reason === "role"), true);
  cleanupGuest();

  const admin = new FakeSocket();
  const cleanupAdmin = registerViewerControlHandlers(admin as any, manager, "account-a", "admin");
  admin.emit("botControl", { accountId: "account-b", control: "forward", enabled: true });
  await Promise.resolve();
  assert.deepEqual(calls.at(-1), { kind: "control", accountId: "account-a", input: { kind: "movement", control: "forward", enabled: true } });
  cleanupAdmin();
});
