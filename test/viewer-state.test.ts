import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { registerViewerStateSync } from "../src/viewer-state.js";

class SyntheticBot extends EventEmitter {
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

  target.entity.metadata[6] = 3;
  target.emit("entityUpdate", target.entity);
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
      pose: "swimming"
    }
  });

  second.cleanup();
  second.cleanup();
  assert.equal(viewerEmitter.listenerCount("blockUpdate"), 0);
  assert.equal(viewerEmitter.listenerCount("entity"), 0);
  assert.equal(target.listenerCount("entityUpdate"), 0);

  socket.sent.length = 0;
  viewerEmitter.emit("blockUpdate", { pos: { x: 1, y: 2, z: 3 }, stateId: 5 });
  target.emit("entityUpdate", target.entity);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(socket.sent, []);
});
