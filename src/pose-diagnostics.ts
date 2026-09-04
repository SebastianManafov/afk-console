import { inspect } from "node:util";
import minecraftData from "minecraft-data";
import { normalizePlayerPose, type PlayerPose } from "./player-pose.js";

export type PoseDiagnosticSource = "initialSelfEntity" | "entityUpdate" | "move" | "entityMoved";
export type PoseDiagnosticLogger = (message: string) => void;

export interface NormalizedPoseDiagnostic {
  pose: PlayerPose;
  sequence: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
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

function metadataValue(entity: unknown, index: number, name: string): unknown {
  const metadata = asRecord(entity)?.metadata;
  if (Array.isArray(metadata)) return metadata[index];
  const record = asRecord(metadata);
  return record?.[name] ?? record?.[String(index)];
}

function poseFields(entity: unknown): {
  id: unknown;
  username: unknown;
  metadata0: unknown;
  metadata6: unknown;
  metadata14: unknown;
  directPose: unknown;
  crouching: unknown;
  elytraFlying: unknown;
  sleeping: unknown;
  isInWater: unknown;
} {
  const record = asRecord(entity);
  return {
    id: record?.id,
    username: record?.username,
    metadata0: metadataValue(entity, 0, "shared_flags"),
    metadata6: metadataValue(entity, 6, "pose"),
    metadata14: metadataValue(entity, 14, "sleeping_pos"),
    directPose: record?.pose,
    crouching: record?.crouching,
    elytraFlying: record?.elytraFlying,
    sleeping: record?.sleeping,
    isInWater: record?.isInWater
  };
}

function metadataEntries(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    const record = asRecord(entry);
    return {
      key: record?.key,
      type: record?.type,
      value: record?.value
    };
  });
}

function packetVersion(target: unknown): { minecraftVersion: unknown; protocol: unknown } {
  const record = asRecord(target);
  const client = asRecord(record?._client);
  const minecraftVersion = record?.version ?? client?.version;
  const directProtocol = record?.protocolVersion ?? client?.protocolVersion;
  let protocol = directProtocol;
  if (typeof protocol !== "number" && (typeof minecraftVersion === "string" || typeof minecraftVersion === "number")) {
    try {
      protocol = minecraftData(minecraftVersion).version.version;
    } catch {
      // Keep the directly exposed value when this is an unsupported version.
    }
  }
  return {
    minecraftVersion,
    protocol
  };
}

export class PoseDiagnostics {
  private sequence = 0;
  private lastPacketSignature: string | null = null;
  private lastEntitySignature: string | null = null;
  private lastNormalizedSignature: string | null = null;
  private readonly lastSocketPose = new Map<string, string>();
  private readonly packetSequences = new WeakMap<object, number>();
  private readonly pendingEntitySequences = new Map<number, number>();

  constructor(private readonly logger?: PoseDiagnosticLogger) {}

  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  recordPacket(packet: unknown, target: unknown): number {
    const packetRecord = asRecord(packet);
    const sequence = this.nextSequence();
    if (packet !== null && typeof packet === "object") this.packetSequences.set(packet, sequence);

    const packetEntityId = packetRecord?.entityId;
    if (typeof packetEntityId === "number" && Number.isInteger(packetEntityId)) {
      this.pendingEntitySequences.set(packetEntityId, sequence);
    }

    const rawMetadata = packetRecord?.metadata;
    const relevantMetadata = Array.isArray(rawMetadata)
      ? rawMetadata.filter((entry) => {
        const key = asRecord(entry)?.key;
        return key === 0 || key === 6 || key === 14;
      })
      : rawMetadata;
    const signature = diagnosticValue([packetEntityId, relevantMetadata]);
    if (signature === this.lastPacketSignature) return sequence;
    this.lastPacketSignature = signature;

    const version = packetVersion(target);
    this.log(
      `[POSE PACKET] timestamp=${new Date().toISOString()} sequence=${sequence}` +
      ` selfEntityId=${diagnosticValue(asRecord(asRecord(target)?.entity)?.id)}` +
      ` packetEntityId=${diagnosticValue(packetEntityId)}` +
      ` minecraftVersion=${diagnosticValue(version.minecraftVersion)}` +
      ` protocol=${diagnosticValue(version.protocol)}` +
      ` rawMetadata=${diagnosticValue(metadataEntries(rawMetadata))}`
    );
    return sequence;
  }

  sequenceForPacket(packet: unknown): number | undefined {
    if (packet !== null && typeof packet === "object") return this.packetSequences.get(packet);
    return undefined;
  }

  takePendingEntitySequence(entityId: number): number | undefined {
    const sequence = this.pendingEntitySequences.get(entityId);
    this.pendingEntitySequences.delete(entityId);
    return sequence;
  }

  recordEntity(entity: unknown, sequence?: number): number {
    const actualSequence = sequence ?? this.nextSequence();
    const fields = poseFields(entity);
    const signature = diagnosticValue(fields);
    if (signature === this.lastEntitySignature) return actualSequence;
    this.lastEntitySignature = signature;

    this.log(
      `[POSE ENTITY] timestamp=${new Date().toISOString()} sequence=${actualSequence}` +
      ` entity.id=${diagnosticValue(fields.id)}` +
      ` entity.username=${diagnosticValue(fields.username)}` +
      ` metadata[0]=${diagnosticValue(fields.metadata0)}` +
      ` metadata[6]=${diagnosticValue(fields.metadata6)}` +
      ` metadata[14]=${diagnosticValue(fields.metadata14)}` +
      ` entity.pose=${diagnosticValue(fields.directPose)}` +
      ` entity.crouching=${diagnosticValue(fields.crouching)}` +
      ` entity.elytraFlying=${diagnosticValue(fields.elytraFlying)}` +
      ` entity.sleeping=${diagnosticValue(fields.sleeping)}` +
      ` entity.isInWater=${diagnosticValue(fields.isInWater)}`
    );
    return actualSequence;
  }

  normalize(entity: unknown, source: PoseDiagnosticSource, sequence?: number): NormalizedPoseDiagnostic {
    const actualSequence = sequence ?? this.nextSequence();
    const pose = normalizePlayerPose(entity);
    const fields = poseFields(entity);
    const signature = diagnosticValue({ ...fields, pose });
    if (signature !== this.lastNormalizedSignature) {
      this.lastNormalizedSignature = signature;
      this.log(
        `[POSE NORMALIZED] timestamp=${new Date().toISOString()} source=${source}` +
        ` metadata[0]=${diagnosticValue(fields.metadata0)}` +
        ` metadata[6]=${diagnosticValue(fields.metadata6)}` +
        ` metadata[14]=${diagnosticValue(fields.metadata14)}` +
        ` directPose=${diagnosticValue(fields.directPose)}` +
        ` normalized=${pose} sequence=${actualSequence}`
      );
    }
    return { pose, sequence: actualSequence };
  }

  recordSocketSend(event: "selfEntity" | "position" | "entity", payload: unknown, sequence: number): void {
    const record = asRecord(payload);
    const pose = record?.pose;
    if (pose === undefined) return;
    const signature = diagnosticValue(pose);
    if (this.lastSocketPose.get(event) === signature) return;
    this.lastSocketPose.set(event, signature);
    this.log(
      `[POSE SOCKET SEND] timestamp=${new Date().toISOString()} event=${event}` +
      ` sequence=${sequence} payloadPose=${diagnosticValue(pose)} payload=${diagnosticValue(payload)}`
    );
  }

  private log(message: string): void {
    this.logger?.(message);
  }
}

const diagnosticsByTarget = new WeakMap<object, PoseDiagnostics>();

export function poseDiagnosticsFor(target: object, logger?: PoseDiagnosticLogger): PoseDiagnostics {
  const existing = diagnosticsByTarget.get(target);
  if (existing) return existing;
  const diagnostics = new PoseDiagnostics(logger);
  diagnosticsByTarget.set(target, diagnostics);
  return diagnostics;
}
