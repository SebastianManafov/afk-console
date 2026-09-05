import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { isPlayerInCrawlSpace, normalizePlayerPose, playerPoseEyeHeight } from "../src/player-pose.js";
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

test("player pose normalization uses the authoritative swimming shared flag", () => {
  const metadata: unknown[] = [];
  metadata[0] = 0x10;
  metadata[6] = 0;
  assert.equal(normalizePlayerPose({ metadata }), "swimming");

  metadata[0] = 0x02;
  assert.equal(normalizePlayerPose({ metadata }), "crouching");
});

test("normal standing remains standing without a crawl-space signal", () => {
  const metadata: unknown[] = [];
  metadata[0] = 0;
  metadata[6] = 0;
  assert.equal(normalizePlayerPose({ metadata }), "standing");
  assert.equal(normalizePlayerPose({ metadata }, { inCrawlSpace: false }), "standing");
});

test("crouching remains crouching when there is no crawl-space signal", () => {
  const metadata: unknown[] = [];
  metadata[0] = 0x02;
  metadata[6] = 0;
  assert.equal(normalizePlayerPose({ metadata }), "crouching");
  assert.equal(normalizePlayerPose({ metadata }, { inCrawlSpace: false }), "crouching");
});

test("player pose normalization infers crawling in a one-block crawl space", () => {
  assert.equal(normalizePlayerPose({ pose: "crouching" }, { inCrawlSpace: true }), "swimming");
  assert.equal(normalizePlayerPose({ pose: "sleeping" }, { inCrawlSpace: true }), "sleeping");
  assert.equal(normalizePlayerPose({ elytraFlying: true }, { inCrawlSpace: true }), "fall_flying");
  assert.equal(normalizePlayerPose({ pose: "crouching" }, { inCrawlSpace: false }), "crouching");
});

test("crawl-space detection uses full collision shapes and vertical clearance", () => {
  const air = { boundingBox: "empty", shapes: [] };
  const fullBlock = { boundingBox: "block", shapes: [[0, 0, 0, 1, 1, 1]] };
  const upperSlab = { boundingBox: "block", shapes: [[0, 0.5, 0, 1, 1, 1]] };
  const lowerSlab = { boundingBox: "block", shapes: [[0, 0, 0, 1, 0.5, 1]] };
  const minimumCrawlClearance = { boundingBox: "block", shapes: [[0, 0.6, 0, 1, 1, 1]] };
  const stairs = {
    boundingBox: "block",
    shapes: [[0, 0, 0, 0.5, 0.5, 1], [0, 0.5, 0, 0.5, 1, 1]]
  };
  const openTrapdoor = { boundingBox: "block", shapes: [[0, 0, 0, 0.1875, 1, 1]] };
  const closedTrapdoor = { boundingBox: "block", shapes: [[0, 0, 0, 1, 0.1875, 1]] };
  const water = { boundingBox: "empty", name: "water", shapes: [] };
  const blocks = new Map<string, unknown>([
    ["0,10,0", air],
    ["0,11,0", fullBlock]
  ]);
  const blockAt = ({ x, y, z }: { x: number; y: number; z: number }) => blocks.get(`${x},${y},${z}`) ?? air;
  const entity = { position: { x: 0.5, y: 10, z: 0.5 } };

  assert.equal(isPlayerInCrawlSpace(entity, blockAt), true);
  for (const partial of [upperSlab, stairs, openTrapdoor, water, air]) {
    blocks.set("0,11,0", partial);
    assert.equal(isPlayerInCrawlSpace(entity, blockAt), false);
  }

  blocks.set("0,11,0", lowerSlab);
  assert.equal(isPlayerInCrawlSpace(entity, blockAt), true);
  blocks.set("0,11,0", closedTrapdoor);
  assert.equal(isPlayerInCrawlSpace(entity, blockAt), true);

  blocks.set("0,10,0", minimumCrawlClearance);
  blocks.set("0,11,0", air);
  assert.equal(isPlayerInCrawlSpace(entity, blockAt), true);

  blocks.set("0,10,0", water);
  blocks.set("0,11,0", fullBlock);
  assert.equal(isPlayerInCrawlSpace(entity, blockAt), false);
  assert.equal(isPlayerInCrawlSpace({ ...entity, isInWater: true }, blockAt), false);
  blocks.set("0,10,0", air);

  blocks.set("0,11,0", fullBlock);
  assert.equal(isPlayerInCrawlSpace({ position: { x: 0.5, y: 10.51, z: 0.5 } }, blockAt), false);
  blocks.delete("0,11,0");
  blocks.set("0,12,0", fullBlock);
  assert.equal(isPlayerInCrawlSpace({ position: { x: 0.5, y: 10.75, z: 0.5 } }, blockAt), true);
  blocks.delete("0,12,0");
  assert.equal(isPlayerInCrawlSpace(entity, blockAt), false);
});

test("player pose normalization keeps legacy crouch and Elytra signals", () => {
  const metadata: unknown[] = [];
  metadata[0] = 2;
  assert.equal(normalizePlayerPose({ metadata }), "crouching");
  assert.equal(normalizePlayerPose({ elytraFlying: true }), "fall_flying");
  assert.equal(normalizePlayerPose({ pose: "crawling" }), "swimming");
});

test("client pose override forces swimming view without changing the server pose", () => {
  const { createPoseOverrideState } = require(join(process.cwd(), "viewer-client/pose-override.cjs")) as {
    createPoseOverrideState: (initialPose?: string) => {
      setServerPose: (pose: string) => void;
      setClientOverride: (enabled: boolean) => void;
      currentPose: () => string;
      isClientOverrideEnabled: () => boolean;
    };
  };
  const state = createPoseOverrideState("standing");

  assert.equal(state.currentPose(), "standing");
  state.setClientOverride(true);
  assert.equal(state.isClientOverrideEnabled(), true);
  assert.equal(state.currentPose(), "swimming");
  state.setServerPose("sleeping");
  assert.equal(state.currentPose(), "swimming");
  state.setClientOverride(false);
  assert.equal(state.isClientOverrideEnabled(), false);
  assert.equal(state.currentPose(), "sleeping");
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

test("pinned viewer player definition has one visible model mesh and separate nametag capacity", () => {
  const player = require("prismarine-viewer/viewer/lib/entity/entities.json").player as {
    geometry: Record<string, unknown>;
    textures: Record<string, string>;
  };
  assert.deepEqual(Object.keys(player.geometry), ["default", "cape"]);
  assert.deepEqual(Object.keys(player.textures), ["default"]);
});
