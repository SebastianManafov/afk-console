import assert from "node:assert/strict";
import test from "node:test";
import { viewerRenderVersion } from "../src/server.js";

test("viewer keeps the modern protocol local to the compatible render profile", () => {
  assert.equal(viewerRenderVersion("26.1.2"), "1.21.4");
  assert.equal(viewerRenderVersion("26.1"), "1.21.4");
  assert.equal(viewerRenderVersion("1.21.8"), "1.21.4");
  assert.equal(viewerRenderVersion(""), null);
  assert.equal(viewerRenderVersion("1.20.6"), null);
});
