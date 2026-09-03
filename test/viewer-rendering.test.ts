import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { normalizePlayerPose, playerPoseEyeHeight } from "../src/player-pose.js";
import { viewerRenderVersion } from "../src/server.js";

const require = createRequire(import.meta.url);

test("viewer keeps the modern protocol local to the compatible render profile", () => {
  assert.equal(viewerRenderVersion("26.1.2"), "1.21.4");
  assert.equal(viewerRenderVersion("26.1"), "1.21.4");
  assert.equal(viewerRenderVersion("1.21.8"), "1.21.4");
  assert.equal(viewerRenderVersion(""), null);
  assert.equal(viewerRenderVersion("1.20.6"), null);
});

test("player pose normalization uses Mineflayer entity metadata", () => {
  const metadata: unknown[] = [];
  metadata[6] = 3;
  assert.equal(normalizePlayerPose({ metadata }), "swimming");

  metadata[6] = 0;
  assert.equal(normalizePlayerPose({ metadata }), "standing");

  metadata[6] = 5;
  assert.equal(normalizePlayerPose({ metadata }), "crouching");
  assert.equal(playerPoseEyeHeight("crouching"), 1.27);
});

test("player pose normalization keeps legacy crouch and Elytra signals", () => {
  const metadata: unknown[] = [];
  metadata[0] = 2;
  assert.equal(normalizePlayerPose({ metadata }), "crouching");
  assert.equal(normalizePlayerPose({ elytraFlying: true }), "fall_flying");
  assert.equal(normalizePlayerPose({ pose: "crawling" }), "swimming");
});

test("player pose transform leaves entity-root orientation unchanged", () => {
  const { applyPlayerPose, POSE_TRANSFORMS } = require(join(process.cwd(), "viewer-client/player-pose.cjs")) as {
    applyPlayerPose: (root: unknown, pose: string) => boolean;
    POSE_TRANSFORMS: Record<string, { rotationX: number; y: number; z: number }>;
  };
  const model = {
    isSkinnedMesh: true,
    position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    userData: {}
  };
  const root = { rotation: { y: 1.2 }, children: [model] };

  assert.equal(applyPlayerPose(root, "swimming"), true);
  assert.equal(model.rotation.x, POSE_TRANSFORMS.swimming!.rotationX);
  assert.equal(root.rotation.y, 1.2);
  assert.equal(model.position.y, POSE_TRANSFORMS.swimming!.y);
  assert.equal(applyPlayerPose(root, "standing"), true);
  assert.equal(model.rotation.x, 0);
  assert.equal(model.position.y, 0);
});
