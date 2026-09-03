import type { Bot } from "mineflayer";
import { inspect } from "node:util";
import {
  normalizePlayerPose,
  PLAYER_POSE_METADATA_INDEX,
  PLAYER_SHARED_FLAGS_METADATA_INDEX,
  PLAYER_SLEEPING_POSITION_METADATA_INDEX,
  type PlayerPose
} from "./player-pose.js";

type UnknownRecord = Record<string, unknown>;
type EventListener = (...args: any[]) => void;

interface EventSource {
  on(event: string, listener: EventListener): unknown;
  off(event: string, listener: EventListener): unknown;
}

interface ViewerSocket {
  emit(event: string, ...args: any[]): unknown;
}

type DiagnosticLogger = (message: string) => void;

export interface ViewerPosition {
  x: number;
  y: number;
  z: number;
}

export interface ViewerEntityState {
  id: number;
  name?: string;
  username?: string;
  pos?: ViewerPosition;
  width?: number;
  height?: number;
  yaw?: number;
  pitch?: number;
  pose?: PlayerPose;
  delete?: boolean;
}

export interface ViewerStateSync {
  sendSelfEntity(): void;
  cleanup(): void;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function entityId(value: unknown): number | null {
  const id = finiteNumber(asRecord(value)?.id);
  return id !== null && Number.isInteger(id) ? id : null;
}

function position(value: unknown): ViewerPosition | null {
  const record = asRecord(value);
  if (!record) return null;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const z = finiteNumber(record.z);
  return x === null || y === null || z === null ? null : { x, y, z };
}

function diagnosticValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, (_key, item) => typeof item === "bigint" ? `${item}n` : item);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall back to an object-safe representation for diagnostic-only logging.
  }
  return inspect(value, { depth: 6, breakLength: Infinity, compact: true }).replace(/\s*\n\s*/g, " ");
}

function entityMetadataValue(entity: unknown, index: number, name: string): unknown {
  const metadata = asRecord(entity)?.metadata;
  if (Array.isArray(metadata)) return metadata[index];
  const record = asRecord(metadata);
  return record?.[String(index)] ?? record?.[name];
}

function metadataHex(value: unknown): string {
  const number = finiteNumber(value);
  return number === null ? "n/a" : `0x${(Math.trunc(number) >>> 0).toString(16)}`;
}

function hasSharedFlag(value: unknown, flag: number): boolean {
  const number = finiteNumber(value);
  return number !== null && (Math.trunc(number) & flag) !== 0;
}

function hasPoseState(record: UnknownRecord): boolean {
  return "pose" in record || "metadata" in record || "crouching" in record || "sleeping" in record || "isSleeping" in record || "elytraFlying" in record;
}

export function serializeViewerEntity(
  value: unknown,
  options: { poseSource?: unknown; forcePose?: boolean; username?: string } = {}
): ViewerEntityState | null {
  const record = asRecord(value);
  const id = entityId(value);
  if (!record || id === null) return null;
  if (record.delete === true) return { id, delete: true };

  const state: ViewerEntityState = { id };
  if (typeof record.name === "string" && record.name) state.name = record.name;
  if (typeof record.username === "string") state.username = record.username;
  if (options.username !== undefined) state.username = options.username;

  const pos = position(record.pos ?? record.position);
  if (pos) state.pos = pos;
  for (const key of ["width", "height", "yaw", "pitch"] as const) {
    const number = finiteNumber(record[key]);
    if (number !== null) state[key] = number;
  }

  const poseSource = options.poseSource ?? (hasPoseState(record) ? value : undefined);
  if (options.forcePose || poseSource !== undefined) state.pose = normalizePlayerPose(poseSource);
  return state;
}

function isSelfEntity(value: unknown, selfEntityId: number): boolean {
  return entityId(value) === selfEntityId;
}

export function registerViewerStateSync(options: {
  target: Bot;
  viewerEmitter: EventSource;
  socket: ViewerSocket;
  diagnostic?: DiagnosticLogger;
}): ViewerStateSync {
  const target = options.target;
  const targetEvents = target as unknown as EventSource;
  const selfEntityId = target.entity.id;
  let cleaned = false;
  let lastSelfPose: PlayerPose | null = null;
  let lastRawMetadataSignature: string | null = null;
  const diagnostic = options.diagnostic;

  const emitSelfEntity = (force: boolean): void => {
    if (cleaned || !target.entity || target.entity.id !== selfEntityId) return;
    const state = serializeViewerEntity(target.entity, { forcePose: true, username: target.username });
    if (!state) return;
    if (!force && state.pose === lastSelfPose) return;
    lastSelfPose = state.pose ?? null;
    diagnostic?.(`[POSE SOCKET] selfEntityPose=${diagnosticValue(state.pose)} exact payload=${diagnosticValue(state)}`);
    options.socket.emit("selfEntity", state);
  };

  const forwardRawEntityMetadata: EventListener = (value: unknown) => {
    const packet = asRecord(value);
    const packetEntityId = finiteNumber(packet?.entityId);
    if (packetEntityId !== selfEntityId) return;

    const entityMetadata = asRecord(target.entity)?.metadata;
    const metadata0 = entityMetadataValue(target.entity, PLAYER_SHARED_FLAGS_METADATA_INDEX, "shared_flags");
    const metadata6 = entityMetadataValue(target.entity, PLAYER_POSE_METADATA_INDEX, "pose");
    const rawMetadata = packet?.metadata;
    const rawPoseMetadata = Array.isArray(rawMetadata)
      ? rawMetadata.filter((entry) => {
        const key = finiteNumber(asRecord(entry)?.key);
        return key === PLAYER_SHARED_FLAGS_METADATA_INDEX || key === PLAYER_POSE_METADATA_INDEX || key === PLAYER_SLEEPING_POSITION_METADATA_INDEX;
      })
      : rawMetadata;
    const sleepingPosition = entityMetadataValue(target.entity, PLAYER_SLEEPING_POSITION_METADATA_INDEX, "sleeping_pos");
    const signature = [diagnosticValue(rawPoseMetadata), diagnosticValue(metadata0), diagnosticValue(metadata6), diagnosticValue(sleepingPosition)].join("|");
    if (signature === lastRawMetadataSignature) return;
    lastRawMetadataSignature = signature;
    const normalizedPose = normalizePlayerPose(target.entity);
    diagnostic?.(`[POSE RAW] minecraftVersion=${diagnosticValue(target.version)} entityId=${selfEntityId} rawMetadataPacket=${diagnosticValue(value)} entityMetadata=${diagnosticValue(entityMetadata)} metadata0=${diagnosticValue(metadata0)} metadata6=${diagnosticValue(metadata6)} sharedFlagsHex=${metadataHex(metadata0)} sharedFlagSwimming=${hasSharedFlag(metadata0, 0x10)} registryPoseIndex=${PLAYER_POSE_METADATA_INDEX} registrySharedFlagsIndex=${PLAYER_SHARED_FLAGS_METADATA_INDEX}`);
    diagnostic?.(`[POSE NORMALIZE] input=${diagnosticValue({ metadata0, metadata6, sleepingPosition, entityMetadata })} normalizedPose=${normalizedPose}`);
  };

  const forwardBlockUpdate: EventListener = (value: unknown) => {
    const update = asRecord(value);
    const pos = position(update?.pos);
    const stateId = finiteNumber(update?.stateId);
    if (!pos || stateId === null || !Number.isInteger(stateId) || stateId < 0) return;
    options.socket.emit("blockUpdate", { pos, stateId });
  };

  const forwardEntity: EventListener = (value: unknown) => {
    const state = serializeViewerEntity(value, {
      poseSource: isSelfEntity(value, selfEntityId) ? target.entity : undefined
    });
    if (state) options.socket.emit("entity", state);
  };

  const forwardEntityUpdate: EventListener = (value: unknown) => {
    queueMicrotask(() => {
      if (cleaned) return;
      if (isSelfEntity(value, selfEntityId)) {
        emitSelfEntity(false);
        return;
      }
      const record = asRecord(value);
      if (!record || (record.name !== "player" && record.type !== "player") || !hasPoseState(record)) return;
      const state = serializeViewerEntity(value, { forcePose: true });
      if (state) options.socket.emit("entity", state);
    });
  };

  const forwardPoseEvent: EventListener = (value: unknown) => {
    if (!isSelfEntity(value, selfEntityId)) return;
    queueMicrotask(() => emitSelfEntity(false));
  };

  options.viewerEmitter.on("blockUpdate", forwardBlockUpdate);
  options.viewerEmitter.on("entity", forwardEntity);
  targetEvents.on("entityUpdate", forwardEntityUpdate);
  for (const event of ["entityCrouch", "entityUncrouch", "entitySleep", "entityWake", "entityElytraFlew"]) {
    targetEvents.on(event, forwardPoseEvent);
  }
  const protocolEvents = (target as unknown as { _client?: EventSource })._client;
  protocolEvents?.on("entity_metadata", forwardRawEntityMetadata);

  return {
    sendSelfEntity: () => emitSelfEntity(true),
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      options.viewerEmitter.off("blockUpdate", forwardBlockUpdate);
      options.viewerEmitter.off("entity", forwardEntity);
      targetEvents.off("entityUpdate", forwardEntityUpdate);
      for (const event of ["entityCrouch", "entityUncrouch", "entitySleep", "entityWake", "entityElytraFlew"]) {
        targetEvents.off(event, forwardPoseEvent);
      }
      protocolEvents?.off("entity_metadata", forwardRawEntityMetadata);
    }
  };
}
