import type { Bot } from "mineflayer";
import {
  normalizePlayerPose,
  type PlayerPose
} from "./player-pose.js";
import {
  poseDiagnosticsFor,
  type NormalizedPoseDiagnostic,
  type PoseDiagnosticSource
} from "./pose-diagnostics.js";

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
  poseSequence?: number;
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

function hasPoseState(record: UnknownRecord): boolean {
  return "pose" in record || "metadata" in record || "crouching" in record || "sleeping" in record || "isSleeping" in record || "elytraFlying" in record;
}

export function serializeViewerEntity(
  value: unknown,
  options: { poseSource?: unknown; forcePose?: boolean; username?: string; normalizedPose?: NormalizedPoseDiagnostic } = {}
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
  if (options.forcePose || poseSource !== undefined) {
    const normalized = options.normalizedPose ?? { pose: normalizePlayerPose(poseSource), sequence: undefined };
    state.pose = normalized.pose;
    if (normalized.sequence !== undefined) state.poseSequence = normalized.sequence;
  }
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
  const poseDiagnostics = poseDiagnosticsFor(target as object, options.diagnostic);
  let cleaned = false;
  let lastSelfPose: PlayerPose | null = null;

  const emitSelfEntity = (force: boolean, source: PoseDiagnosticSource, sequence?: number): void => {
    if (cleaned || !target.entity || target.entity.id !== selfEntityId) return;
    const normalized = poseDiagnostics.normalize(target.entity, source, sequence);
    const state = serializeViewerEntity(target.entity, {
      forcePose: true,
      username: target.username,
      normalizedPose: normalized
    });
    if (!state) return;
    if (!force && state.pose === lastSelfPose) return;
    lastSelfPose = state.pose ?? null;
    poseDiagnostics.recordSocketSend("selfEntity", state, normalized.sequence);
    options.socket.emit("selfEntity", state);
  };

  const forwardRawEntityMetadata: EventListener = (value: unknown) => {
    const packet = asRecord(value);
    const packetEntityId = finiteNumber(packet?.entityId);
    if (packetEntityId !== selfEntityId) return;
    const sequence = poseDiagnostics.sequenceForPacket(value) ?? poseDiagnostics.takePendingEntitySequence(selfEntityId);
    poseDiagnostics.recordEntity(target.entity, sequence);
  };

  const forwardBlockUpdate: EventListener = (value: unknown) => {
    const update = asRecord(value);
    const pos = position(update?.pos);
    const stateId = finiteNumber(update?.stateId);
    if (!pos || stateId === null || !Number.isInteger(stateId) || stateId < 0) return;
    options.socket.emit("blockUpdate", { pos, stateId });
  };

  const forwardEntity: EventListener = (value: unknown) => {
    const self = isSelfEntity(value, selfEntityId);
    const normalized = self && !asRecord(value)?.delete
      ? poseDiagnostics.normalize(target.entity, "entityMoved")
      : undefined;
    const state = serializeViewerEntity(value, {
      poseSource: self ? target.entity : undefined,
      normalizedPose: normalized
    });
    if (state) {
      if (self && normalized) poseDiagnostics.recordSocketSend("entity", state, normalized.sequence);
      options.socket.emit("entity", state);
    }
  };

  const forwardEntityUpdate: EventListener = (value: unknown) => {
    queueMicrotask(() => {
      if (cleaned) return;
      if (isSelfEntity(value, selfEntityId)) {
        emitSelfEntity(false, "entityUpdate", poseDiagnostics.takePendingEntitySequence(selfEntityId));
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
    queueMicrotask(() => emitSelfEntity(false, "entityUpdate", poseDiagnostics.takePendingEntitySequence(selfEntityId)));
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
    sendSelfEntity: () => emitSelfEntity(true, "initialSelfEntity"),
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
