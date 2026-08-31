import assert from "node:assert/strict";
import test from "node:test";
import { findAbortArrow } from "../src/arrow-policy.js";

test("Arrow-Filter erkennt arrow mit und ohne Namespace", () => {
  const slots = [
    { name: "bone", count: 64, slot: 0 },
    { name: "arrow", count: 17, slot: 1 },
    null,
    { name: "minecraft:arrow", count: 4, slot: 3 }
  ];
  assert.deepEqual(findAbortArrow(slots, 44, ["minecraft:arrow"]), slots[1]);
});

test("Arrow-Filter ignoriert Spielerinventar hinter Slot 44", () => {
  const slots = Array.from({ length: 60 }, () => null) as Array<{ name: string; count: number; slot: number } | null>;
  slots[45] = { name: "arrow", count: 64, slot: 45 };
  assert.equal(findAbortArrow(slots, 44, ["arrow"]), null);
});

test("Knochen lösen den Arrow-Abbruch nicht aus", () => {
  assert.equal(findAbortArrow([{ name: "bone", count: 64, slot: 0 }], 44, ["arrow"]), null);
});
