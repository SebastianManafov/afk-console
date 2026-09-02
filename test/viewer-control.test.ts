import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { ViewerControlDeniedError, ViewerControlLease } from "../src/viewer-control.js";
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
