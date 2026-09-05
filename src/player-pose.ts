export type PlayerPose =
  | "standing"
  | "crouching"
  | "swimming"
  | "sleeping"
  | "fall_flying";

export const PLAYER_POSE_EYE_HEIGHT: Readonly<Record<PlayerPose, number>> = {
  standing: 1.62,
  crouching: 1.27,
  swimming: 0.4,
  sleeping: 0.2,
  fall_flying: 0.4
};

const PLAYER_WIDTH = 0.6;
const PLAYER_CROUCHING_HEIGHT = 1.5;
const PLAYER_SWIMMING_HEIGHT = 0.6;
const COLLISION_EPSILON = 0.001;

export const PLAYER_POSE_METADATA_INDEX = 6;
export const PLAYER_SHARED_FLAGS_METADATA_INDEX = 0;
export const PLAYER_SLEEPING_POSITION_METADATA_INDEX = 14;
const PLAYER_SHARED_FLAG_SWIMMING = 0x10;

export interface PlayerBlockPosition {
  x: number;
  y: number;
  z: number;
}

export type PlayerBlockAt = (position: PlayerBlockPosition) => unknown;

export interface PlayerPoseNormalizationOptions {
  inCrawlSpace?: boolean;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
}

function metadataValue(metadata: unknown, index: number, name: string): unknown {
  if (Array.isArray(metadata)) return metadata[index];
  const record = asRecord(metadata);
  return record?.[name] ?? record?.[String(index)];
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function poseFromValue(value: unknown): PlayerPose | null {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
    if (normalized === "standing") return "standing";
    if (normalized === "crouching" || normalized === "sneaking") return "crouching";
    if (normalized === "swimming" || normalized === "crawling") return "swimming";
    if (normalized === "sleeping") return "sleeping";
    if (normalized === "fall_flying" || normalized === "fallflying" || normalized === "gliding") return "fall_flying";
  }

  switch (numericValue(value)) {
    case 0: return "standing";
    case 1: return "fall_flying";
    case 2: return "sleeping";
    case 3: return "swimming";
    case 5: return "crouching";
    default: return null;
  }
}

function hasCrouchingFlag(value: unknown): boolean {
  const flags = numericValue(value);
  return flags !== null && (Math.trunc(flags) & 0x02) !== 0;
}

function hasSwimmingFlag(value: unknown): boolean {
  const flags = numericValue(value);
  return flags !== null && (Math.trunc(flags) & PLAYER_SHARED_FLAG_SWIMMING) !== 0;
}

interface CollisionShape {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface PlayerFootprint {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

function isLiquidBlock(block: unknown): boolean {
  const record = asRecord(block);
  if (!record) return false;
  if (record.boundingBox === "liquid" || record.liquid === true || record.isLiquid === true || record.material === "liquid") return true;
  if (typeof record.name !== "string") return false;
  const name = record.name.toLowerCase().replace(/^minecraft:/, "");
  return name === "water" || name === "flowing_water" || name === "lava" || name === "flowing_lava";
}

function collisionShapes(block: unknown): CollisionShape[] {
  const record = asRecord(block);
  if (!record || record.boundingBox === "empty" || isLiquidBlock(record) || !Array.isArray(record.shapes)) return [];

  return record.shapes.flatMap((shape): CollisionShape[] => {
    if (!Array.isArray(shape) || shape.length < 6) return [];
    const values = shape.slice(0, 6).map(numericValue);
    if (values.some((value) => value === null)) return [];
    const [minX, minY, minZ, maxX, maxY, maxZ] = values as [number, number, number, number, number, number];
    if (maxX <= minX || maxY <= minY || maxZ <= minZ) return [];
    return [{ minX, minY, minZ, maxX, maxY, maxZ }];
  });
}

function coordinateRange(min: number, max: number): number[] {
  const start = Math.floor(min + COLLISION_EPSILON);
  const end = Math.floor(max - COLLISION_EPSILON);
  const coordinates: number[] = [];
  for (let coordinate = start; coordinate <= end; coordinate += 1) coordinates.push(coordinate);
  return coordinates;
}

function entityWidth(record: UnknownRecord): number {
  const width = numericValue(record.width);
  return width !== null && width > 0 && width <= 4 ? width : PLAYER_WIDTH;
}

function shapeCoversFootprint(shape: CollisionShape, blockX: number, blockZ: number, footprint: PlayerFootprint): boolean {
  const localMinX = Math.max(footprint.minX, blockX) - blockX;
  const localMaxX = Math.min(footprint.maxX, blockX + 1) - blockX;
  const localMinZ = Math.max(footprint.minZ, blockZ) - blockZ;
  const localMaxZ = Math.min(footprint.maxZ, blockZ + 1) - blockZ;
  if (localMaxX <= localMinX || localMaxZ <= localMinZ) return false;
  return shape.minX <= localMinX + COLLISION_EPSILON && shape.maxX >= localMaxX - COLLISION_EPSILON &&
    shape.minZ <= localMinZ + COLLISION_EPSILON && shape.maxZ >= localMaxZ - COLLISION_EPSILON;
}

function shapeOverlapsFootprint(shape: CollisionShape, blockX: number, blockZ: number, footprint: PlayerFootprint): boolean {
  const localMinX = Math.max(footprint.minX, blockX) - blockX;
  const localMaxX = Math.min(footprint.maxX, blockX + 1) - blockX;
  const localMinZ = Math.max(footprint.minZ, blockZ) - blockZ;
  const localMaxZ = Math.min(footprint.maxZ, blockZ + 1) - blockZ;
  if (localMaxX <= localMinX || localMaxZ <= localMinZ) return false;
  return shape.maxX > localMinX + COLLISION_EPSILON && shape.minX < localMaxX - COLLISION_EPSILON &&
    shape.maxZ > localMinZ + COLLISION_EPSILON && shape.minZ < localMaxZ - COLLISION_EPSILON;
}

function collisionBottomCoveringFootprint(
  block: unknown,
  blockX: number,
  blockZ: number,
  footprint: PlayerFootprint
): number | null {
  const bottoms = collisionShapes(block)
    .filter((shape) => shapeCoversFootprint(shape, blockX, blockZ, footprint))
    .map((shape) => shape.minY);
  return bottoms.length > 0 ? Math.min(...bottoms) : null;
}

function hasCollisionAtFeet(
  blockAt: PlayerBlockAt,
  blockY: number,
  xCoordinates: number[],
  zCoordinates: number[],
  footprint: PlayerFootprint,
  feetY: number
): boolean {
  const localFeetY = feetY - blockY;
  for (const blockX of xCoordinates) {
    for (const blockZ of zCoordinates) {
      const block = safeBlockAt(blockAt, { x: blockX, y: blockY, z: blockZ });
      if (collisionShapes(block).some((shape) =>
        shapeOverlapsFootprint(shape, blockX, blockZ, footprint) &&
        shape.minY < localFeetY + COLLISION_EPSILON && shape.maxY > localFeetY + COLLISION_EPSILON
      )) return true;
    }
  }
  return false;
}

function hasLiquidInFootprint(
  blockAt: PlayerBlockAt,
  blockY: number,
  xCoordinates: number[],
  zCoordinates: number[]
): boolean {
  for (const blockX of xCoordinates) {
    for (const blockZ of zCoordinates) {
      if (isLiquidBlock(safeBlockAt(blockAt, { x: blockX, y: blockY, z: blockZ }))) return true;
    }
  }
  return false;
}

function ceilingBottom(
  blockAt: PlayerBlockAt,
  blockY: number,
  xCoordinates: number[],
  zCoordinates: number[],
  footprint: PlayerFootprint
): number | null {
  let lowestBottom: number | null = null;
  for (const blockX of xCoordinates) {
    for (const blockZ of zCoordinates) {
      const bottom = collisionBottomCoveringFootprint(safeBlockAt(blockAt, { x: blockX, y: blockY, z: blockZ }), blockX, blockZ, footprint);
      if (bottom === null) return null;
      const absoluteBottom = blockY + bottom;
      lowestBottom = lowestBottom === null ? absoluteBottom : Math.min(lowestBottom, absoluteBottom);
    }
  }
  return lowestBottom;
}

function safeBlockAt(blockAt: PlayerBlockAt, position: PlayerBlockPosition): unknown {
  try { return blockAt(position); }
  catch { return null; }
}

/**
 * Minecraft reports crawling as a swimming pose, but some protocol/server
 * combinations do not expose that pose on the Mineflayer entity. Infer it only
 * from a collision shape that covers the player's footprint and leaves enough
 * room for the swimming hitbox but not for a crouching hitbox.
 */
export function isPlayerInCrawlSpace(entity: unknown, blockAt: PlayerBlockAt): boolean {
  const record = asRecord(entity);
  if (record?.isInWater === true) return false;
  const rawPosition = asRecord(record?.position ?? record?.pos);
  const x = numericValue(rawPosition?.x);
  const y = numericValue(rawPosition?.y);
  const z = numericValue(rawPosition?.z);
  if (x === null || y === null || z === null) return false;

  const halfWidth = entityWidth(record ?? {}) / 2;
  const footprint: PlayerFootprint = { minX: x - halfWidth, maxX: x + halfWidth, minZ: z - halfWidth, maxZ: z + halfWidth };
  const xCoordinates = coordinateRange(footprint.minX, footprint.maxX);
  const zCoordinates = coordinateRange(footprint.minZ, footprint.maxZ);
  if (xCoordinates.length === 0 || zCoordinates.length === 0) return false;

  const feetBlockY = Math.floor(y + COLLISION_EPSILON);
  if (hasCollisionAtFeet(blockAt, feetBlockY, xCoordinates, zCoordinates, footprint, y)) return false;

  const highestCrawlBlockY = Math.floor(y + PLAYER_CROUCHING_HEIGHT - COLLISION_EPSILON);
  for (let ceilingBlockY = feetBlockY; ceilingBlockY <= highestCrawlBlockY; ceilingBlockY += 1) {
    if (hasLiquidInFootprint(blockAt, ceilingBlockY, xCoordinates, zCoordinates)) return false;
    const bottom = ceilingBottom(blockAt, ceilingBlockY, xCoordinates, zCoordinates, footprint);
    if (bottom === null) continue;
    const clearance = bottom - y;
    if (clearance >= PLAYER_SWIMMING_HEIGHT - COLLISION_EPSILON && clearance < PLAYER_CROUCHING_HEIGHT - COLLISION_EPSILON) return true;
  }
  return false;
}

export function normalizePlayerPose(entity: unknown, options: PlayerPoseNormalizationOptions = {}): PlayerPose {
  const record = asRecord(entity);
  const metadata = record?.metadata;
  const directPose = poseFromValue(record?.pose);
  const metadataPose = poseFromValue(metadataValue(metadata, PLAYER_POSE_METADATA_INDEX, "pose"));
  const mappedPose = directPose ?? metadataPose;

  if (mappedPose === "swimming" || mappedPose === "sleeping" || mappedPose === "fall_flying") return mappedPose;

  const sleepingPosition = metadataValue(metadata, PLAYER_SLEEPING_POSITION_METADATA_INDEX, "sleeping_pos");
  if (record?.sleeping === true || record?.isSleeping === true || sleepingPosition !== undefined && sleepingPosition !== null) return "sleeping";

  const sharedFlags = metadataValue(metadata, PLAYER_SHARED_FLAGS_METADATA_INDEX, "shared_flags");
  if (hasSwimmingFlag(sharedFlags)) return "swimming";
  if (record?.elytraFlying === true) return "fall_flying";
  if (options.inCrawlSpace === true) return "swimming";
  if (record?.crouching === true || hasCrouchingFlag(sharedFlags)) return "crouching";

  return mappedPose ?? "standing";
}

export function playerPoseEyeHeight(pose: PlayerPose): number {
  return PLAYER_POSE_EYE_HEIGHT[pose];
}
