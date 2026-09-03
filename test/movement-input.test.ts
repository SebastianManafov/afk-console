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
