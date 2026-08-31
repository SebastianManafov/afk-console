import assert from "node:assert/strict";
import test from "node:test";
import { readableMinecraftReason } from "../src/minecraft-text.js";

test("Kicktexte aus JSON-Chatkomponenten werden lesbar", () => {
  assert.equal(readableMinecraftReason('{"text":"Du bist bereits auf HugoSMP!"}'), "Du bist bereits auf HugoSMP!");
});

test("Kicktexte aus NBT-Komponenten werden lesbar", () => {
  assert.equal(readableMinecraftReason({
    type: "compound",
    value: {
      color: { type: "string", value: "red" },
      text: { type: "string", value: "Verbindung abgelehnt" },
      extra: { type: "list", value: { type: "compound", value: [{ text: { type: "string", value: ": Test" } }] } }
    }
  }), "Verbindung abgelehnt: Test");
});
