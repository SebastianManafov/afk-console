import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installHugoSmpProtocolHandlers } from "../src/hugosmp-protocol.js";

class FakeProtocolClient extends EventEmitter {
  readonly writes: Array<{ name: string; data: Record<string, unknown> }> = [];
  write(name: string, data: Record<string, unknown>): void { this.writes.push({ name, data }); }
}

function makeHooks() {
  const calls = { phases: [] as Array<"initial" | "reconfiguration">, starts: 0, finishes: 0, resources: 0, pings: 0 };
  return { calls, hooks: {
    onKnownPacks: (phase: "initial" | "reconfiguration") => calls.phases.push(phase),
    onReconfiguration: () => { calls.starts += 1; },
    onReconfigurationFinished: () => { calls.finishes += 1; },
    onResourcePack: () => { calls.resources += 1; },
    onPing: () => { calls.pings += 1; }
  } };
}

test("HugoSMP-Beobachter ersetzt keine offiziellen Protokollhandler", () => {
  const client = new FakeProtocolClient();
  client.on("select_known_packs", () => client.write("select_known_packs", { packs: [] }));
  const { calls, hooks } = makeHooks();
  const cleanup = installHugoSmpProtocolHandlers(client, hooks);
  client.emit("success", {});
  client.emit("select_known_packs", { packs: [{ namespace: "minecraft", id: "core", version: "1.21.11" }] });
  assert.deepEqual(client.writes, [{ name: "select_known_packs", data: { packs: [] } }]);
  assert.deepEqual(calls.phases, ["initial"]);
  cleanup();
});

test("Weltwechsel wird beobachtet, aber nicht mit eigenen Paketen beantwortet", () => {
  const client = new FakeProtocolClient();
  client.on("select_known_packs", () => client.write("select_known_packs", { packs: [] }));
  const { calls, hooks } = makeHooks();
  const cleanup = installHugoSmpProtocolHandlers(client, hooks);
  client.emit("success", {});
  client.emit("select_known_packs", {});
  client.emit("start_configuration", {});
  client.emit("select_known_packs", {});
  client.emit("finish_configuration", {});
  assert.deepEqual(client.writes, [
    { name: "select_known_packs", data: { packs: [] } },
    { name: "select_known_packs", data: { packs: [] } }
  ]);
  assert.deepEqual(calls.phases, ["initial", "reconfiguration"]);
  assert.equal(calls.starts, 1);
  assert.equal(calls.finishes, 1);
  cleanup();
});

test("Doppelte Start-/Finish-Pakete erzeugen nur einen Weltwechsel", () => {
  const client = new FakeProtocolClient();
  const { calls, hooks } = makeHooks();
  const cleanup = installHugoSmpProtocolHandlers(client, hooks);
  client.emit("start_configuration", {});
  client.emit("start_configuration", {});
  client.emit("finish_configuration", {});
  client.emit("finish_configuration", {});
  assert.equal(calls.starts, 1);
  assert.equal(calls.finishes, 1);
  cleanup();
});

test("Resource-Pack und Ping werden nur beobachtet", () => {
  const client = new FakeProtocolClient();
  const { calls, hooks } = makeHooks();
  const cleanup = installHugoSmpProtocolHandlers(client, hooks);
  client.emit("ping", { id: 1 });
  client.emit("ping", { id: 2 });
  client.emit("add_resource_pack", { uuid: "pack-id" });
  assert.equal(calls.pings, 1);
  assert.equal(calls.resources, 1);
  assert.deepEqual(client.writes, []);
  cleanup();
});

test("Cleanup entfernt alle Beobachter", () => {
  const client = new FakeProtocolClient();
  const { calls, hooks } = makeHooks();
  const cleanup = installHugoSmpProtocolHandlers(client, hooks);
  cleanup();
  client.emit("start_configuration", {});
  client.emit("select_known_packs", {});
  client.emit("add_resource_pack", {});
  assert.deepEqual(calls, { phases: [], starts: 0, finishes: 0, resources: 0, pings: 0 });
});
