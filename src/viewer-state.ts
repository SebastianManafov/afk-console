import type { Bot } from "mineflayer";
import { normalizePlayerPose, type PlayerPose } from "./player-pose.js";

type UnknownRecord = Record<string, unknown>;
type EventListener = (...args: any[]) => void;

interface EventSource {
  on(event: string, listener: EventListener): unknown;
  off(event: string, listener: EventListener): unknown;
}

interface ViewerSocket {
  emit(event: string, ...args: any[]): unknown;
}

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
}): ViewerStateSync {
  const target = options.target;
  const targetEvents = target as unknown as EventSource;
  const selfEntityId = target.entity.id;
  let cleaned = false;
  let lastSelfPose: PlayerPose | null = null;

  const emitSelfEntity = (force: boolean): void => {
    if (cleaned || !target.entity || target.entity.id !== selfEntityId) return;
    const state = serializeViewerEntity(target.entity, { forcePose: true, username: target.username });
    if (!state) return;
    if (!force && state.pose === lastSelfPose) return;
    lastSelfPose = state.pose ?? null;
    options.socket.emit("selfEntity", state);
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
    }
  };
}
