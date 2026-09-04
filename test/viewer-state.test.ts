import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { PoseDiagnostics } from "../src/pose-diagnostics.js";
import { registerViewerStateSync } from "../src/viewer-state.js";

class SyntheticBot extends EventEmitter {
  _client = new EventEmitter();
  entity = {
    id: 42,
    name: "player",
    username: "SyntheticBot",
    position: { x: 4.5, y: 70, z: -2.25 },
    width: 0.6,
    height: 1.8,
    yaw: 0,
    pitch: 0,
    metadata: [] as unknown[]
  };
  username = "SyntheticBot";
}

function createSocket() {
  const sent: Array<{ event: string; payload: unknown }> = [];
  return {
    sent,
    emit(event: string, payload: unknown) {
      sent.push({ event, payload });
    }
  };
}

function emitMineflayerEntityMetadata(target: SyntheticBot, metadata: Array<{ key: number; type: string; value: unknown }>): void {
  for (const entry of metadata) target.entity.metadata[entry.key] = entry.value;
  target._client.emit("entity_metadata", { entityId: target.entity.id, metadata });
  target.emit("entityUpdate", target.entity);
}

test("pose packet diagnostics preserve raw metadata and protocol identity", () => {
  const target = new SyntheticBot() as SyntheticBot & { version: string; protocolVersion: number };
  target.version = "26.1.2";
  target.protocolVersion = 107;
  const logs: string[] = [];
  const diagnostics = new PoseDiagnostics((message) => logs.push(message));
  const packet = {
    entityId: target.entity.id,
    metadata: [
      { key: 0, type: "byte", value: 0x10 },
      { key: 6, type: "entity_pose", value: 3 }
    ]
  };

  const sequence = diagnostics.recordPacket(packet, target);

  assert.equal(diagnostics.sequenceForPacket(packet), sequence);
  assert.equal(logs.length, 1);
  const log = logs[0];
  assert.ok(log);
  assert.match(log, /^\[POSE PACKET\] timestamp=/);
  assert.match(log, /selfEntityId=42 packetEntityId=42/);
  assert.match(log, /minecraftVersion="26\.1\.2" protocol=107/);
  assert.match(log, /rawMetadata=\[\{"key":0,"type":"byte","value":16\},\{"key":6,"type":"entity_pose","value":3\}\]/);
});

test("viewer state sync forwards authoritative block state updates", () => {
  const target = new SyntheticBot();
  const viewerEmitter = new EventEmitter();
  const socket = createSocket();
  const sync = registerViewerStateSync({ target: target as any, viewerEmitter, socket });

  viewerEmitter.emit("blockUpdate", { pos: { x: 17, y: -64, z: 4 }, stateId: 1234 });

  assert.deepEqual(socket.sent, [{
    event: "blockUpdate",
    payload: { pos: { x: 17, y: -64, z: 4 }, stateId: 1234 }
  }]);
  sync.cleanup();
});

test("pose diagnostics log only relevant state changes and carry a sequence", async () => {
  const target = new SyntheticBot();
  const viewerEmitter = new EventEmitter();
  const socket = createSocket();
  const logs: string[] = [];
  const sync = registerViewerStateSync({ target: target as any, viewerEmitter, socket, diagnostic: (message) => logs.push(message) });

  target.entity.metadata[0] = 0;
  target.entity.metadata[6] = 0;
  emitMineflayerEntityMetadata(target, [{ key: 0, type: "byte", value: 0x10 }]);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(logs.filter((message) => message.startsWith("[POSE ENTITY] ")).length, 1);
  assert.equal(logs.filter((message) => message.startsWith("[POSE NORMALIZED] ")).length, 1);
  assert.equal(logs.filter((message) => message.startsWith("[POSE SOCKET SEND] ")).length, 1);
  assert.equal((socket.sent.at(-1)?.payload as { pose?: string; poseSequence?: number }).pose, "swimming");
  assert.equal(typeof (socket.sent.at(-1)?.payload as { poseSequence?: number }).poseSequence, "number");

  emitMineflayerEntityMetadata(target, [{ key: 0, type: "byte", value: 0x10 }]);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(logs.filter((message) => message.startsWith("[POSE ENTITY] ")).length, 1);
  assert.equal(logs.filter((message) => message.startsWith("[POSE NORMALIZED] ")).length, 1);
  assert.equal(logs.filter((message) => message.startsWith("[POSE SOCKET SEND] ")).length, 1);
  sync.cleanup();
});

test("viewer state sync removes block and entity listeners without duplicates", async () => {
  const target = new SyntheticBot();
  const viewerEmitter = new EventEmitter();
  const socket = createSocket();
  const first = registerViewerStateSync({ target: target as any, viewerEmitter, socket });
  first.cleanup();
  const second = registerViewerStateSync({ target: target as any, viewerEmitter, socket });

  assert.equal(viewerEmitter.listenerCount("blockUpdate"), 1);
  assert.equal(viewerEmitter.listenerCount("entity"), 1);
  assert.equal(target.listenerCount("entityUpdate"), 1);
  assert.equal(target._client.listenerCount("entity_metadata"), 1);

  target.entity.metadata[0] = 0;
  target.entity.metadata[6] = 0;
  emitMineflayerEntityMetadata(target, [{ key: 0, type: "byte", value: 0x10 }]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(socket.sent.at(-1), {
    event: "selfEntity",
    payload: {
      id: 42,
      name: "player",
      username: "SyntheticBot",
      pos: { x: 4.5, y: 70, z: -2.25 },
      width: 0.6,
      height: 1.8,
      yaw: 0,
      pitch: 0,
      pose: "swimming",
      poseSequence: 2
    }
  });

  second.cleanup();
  second.cleanup();
  assert.equal(viewerEmitter.listenerCount("blockUpdate"), 0);
  assert.equal(viewerEmitter.listenerCount("entity"), 0);
  assert.equal(target.listenerCount("entityUpdate"), 0);
  assert.equal(target._client.listenerCount("entity_metadata"), 0);

  socket.sent.length = 0;
  viewerEmitter.emit("blockUpdate", { pos: { x: 1, y: 2, z: 3 }, stateId: 5 });
  target.emit("entityUpdate", target.entity);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(socket.sent, []);
});
