import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { itemAssetName, itemIconUrl } = require(resolve(process.cwd(), "viewer-client/item-icons.cjs")) as { itemAssetName: (name: unknown) => string; itemIconUrl: (version: unknown, name: unknown) => string | null };

test("viewer item icon paths normalize Minecraft item names", () => {
  assert.equal(itemAssetName("minecraft:Netherite Sword"), "netherite_sword");
  assert.equal(itemAssetName("golden_apple"), "golden_apple");
  assert.equal(itemIconUrl("1.21.4", "minecraft:ender_pearl"), "item-icons/1.21.4/ender_pearl.png");
  assert.equal(itemIconUrl("1.21.4", ""), null);
  assert.equal(itemIconUrl("", "stone"), null);
});
