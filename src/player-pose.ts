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

export const PLAYER_POSE_METADATA_INDEX = 6;
export const PLAYER_SHARED_FLAGS_METADATA_INDEX = 0;
export const PLAYER_SLEEPING_POSITION_METADATA_INDEX = 14;
const PLAYER_SHARED_FLAG_SWIMMING = 0x10;

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

export function normalizePlayerPose(entity: unknown): PlayerPose {
  const record = asRecord(entity);
  const metadata = record?.metadata;
  const directPose = poseFromValue(record?.pose);
  const metadataPose = poseFromValue(metadataValue(metadata, PLAYER_POSE_METADATA_INDEX, "pose"));
  const mappedPose = directPose ?? metadataPose;

  if (mappedPose && mappedPose !== "standing") return mappedPose;

  const sleepingPosition = metadataValue(metadata, PLAYER_SLEEPING_POSITION_METADATA_INDEX, "sleeping_pos");
  if (record?.sleeping === true || record?.isSleeping === true || sleepingPosition !== undefined && sleepingPosition !== null) return "sleeping";

  const sharedFlags = metadataValue(metadata, PLAYER_SHARED_FLAGS_METADATA_INDEX, "shared_flags");
  if (hasSwimmingFlag(sharedFlags)) return "swimming";
  if (record?.crouching === true || hasCrouchingFlag(sharedFlags)) return "crouching";

  if (record?.elytraFlying === true) return "fall_flying";
  return mappedPose ?? "standing";
}

export function playerPoseEyeHeight(pose: PlayerPose): number {
  return PLAYER_POSE_EYE_HEIGHT[pose];
}
