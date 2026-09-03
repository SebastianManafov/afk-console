import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installMovementInputBridge } from "../src/movement-input.js";

test("movement input bridge sends complete modern held-control flags", () => {
  const packets: Array<{ name: string; params: unknown }> = [];
  const states = new Map<string, boolean>();
  const bot = new EventEmitter() as any;
  bot._client = { state: "play", write: (name: string, params: unknown) => packets.push({ name, params }) };
  bot.supportFeature = (feature: string) => feature === "newPlayerInputPacket";
  bot.setControlState = (control: string, enabled: boolean) => states.set(control, enabled);
  bot.getControlState = (control: string) => states.get(control) === true;

  const cleanup = installMovementInputBridge(bot);
  bot.setControlState("forward", true);
  assert.deepEqual(packets[0], {
    name: "player_input",
    params: { inputs: { forward: true, backward: false, left: false, right: false, jump: false, shift: false, sprint: false } }
  });
  bot.setControlState("forward", false);
  assert.deepEqual(packets[1], {
    name: "player_input",
    params: { inputs: { forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false } }
  });
  cleanup();
});

test("movement input bridge stays disabled for legacy protocol versions", () => {
  const packets: string[] = [];
  const states = new Map<string, boolean>();
  const bot = new EventEmitter() as any;
  bot._client = { state: "play", write: (name: string) => packets.push(name) };
  bot.supportFeature = () => false;
  bot.setControlState = (control: string, enabled: boolean) => states.set(control, enabled);
  bot.getControlState = (control: string) => states.get(control) === true;

  installMovementInputBridge(bot);
  bot.setControlState("forward", true);
  assert.deepEqual(packets, []);
  bot.emit("end");
});

test("modern movement packets carry synchronized input, rotation, collision, and tick end", async () => {
  const packets: Array<{ name: string; params: any }> = [];
  const states = new Map<string, boolean>();
  const bot = new EventEmitter() as any;
  bot.entity = {
    yaw: 0.5,
    pitch: -0.25,
    onGround: true,
    isCollidedHorizontally: true
  };
  bot._client = {
    state: "play",
    write: (name: string, params: unknown) => packets.push({ name, params })
  };
  bot.supportFeature = (feature: string) => (
    feature === "newPlayerInputPacket" || feature === "sendsClientTickEndPacket"
  );
  bot.setControlState = (control: string, enabled: boolean) => states.set(control, enabled);
  bot.getControlState = (control: string) => states.get(control) === true;

  const cleanup = installMovementInputBridge(bot);
  bot.setControlState("forward", true);
  bot._client.write("position_look", {
    x: 1,
    y: 2,
    z: 3,
    yaw: 0,
    pitch: 0,
    flags: { onGround: true, hasHorizontalCollision: undefined }
  });

  assert.deepEqual(packets.map(({ name }) => name), ["player_input", "position_look"]);
  const movementPacket = packets[1];
  assert.ok(movementPacket);
  assert.equal(movementPacket.params.yaw, Math.fround((Math.PI - bot.entity.yaw) * 180 / Math.PI));
  assert.equal(movementPacket.params.pitch, Math.fround(-bot.entity.pitch * 180 / Math.PI));
  assert.deepEqual(movementPacket.params.flags, { onGround: true, hasHorizontalCollision: true });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(packets.at(-1)?.name, "tick_end");

  cleanup();
});
