import type { TokenStatusKind } from "./types.js";

const minecraftProfileEndpoint = "https://api.minecraftservices.com/minecraft/profile";

export interface MinecraftJavaProfile {
  id: string;
  name: string;
}

export interface MinecraftJavaTokenValidation {
  profile: MinecraftJavaProfile | null;
  expiresAt: string | null;
  status: Exclude<TokenStatusKind, "not_set">;
  reason: string | null;
}

export interface MinecraftJavaSessionCredentials {
  accessToken: string;
  profile: MinecraftJavaProfile;
}

export function inspectAccessToken(value: string): { expiresAt: number | null; malformed: boolean } {
  const segments = value.split(".");
  if (segments.length !== 3) return { expiresAt: null, malformed: false };
  try {
    const payload = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8")) as unknown;
    if (!isRecord(payload)) return { expiresAt: null, malformed: true };
    if (payload.exp === undefined) return { expiresAt: null, malformed: false };
    const expiresAt = parseTimestamp(payload.exp);
    return { expiresAt, malformed: expiresAt === null };
  } catch {
    return { expiresAt: null, malformed: true };
  }
}

export async function validateMinecraftJavaAccessToken(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<MinecraftJavaTokenValidation> {
  const normalizedToken = accessToken.trim();
  if (!normalizedToken) throw new Error("Access token is required");
  const inspected = inspectAccessToken(normalizedToken);
  const expiresAt = inspected.expiresAt === null ? null : new Date(inspected.expiresAt).toISOString();
  if (inspected.malformed) return invalidValidation("Minecraft access token is invalid", expiresAt);
  if (inspected.expiresAt !== null && inspected.expiresAt <= Date.now()) return invalidValidation("Minecraft access token is expired", expiresAt, "expired");

  let response: Response;
  try {
    response = await fetchImpl(minecraftProfileEndpoint, {
      headers: { Accept: "application/json", Authorization: `Bearer ${normalizedToken}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new Error("Minecraft token validation is currently unavailable");
  }
  if (response.status === 401 || response.status === 403) return invalidValidation("Minecraft access token was rejected", expiresAt);
  if (!response.ok) throw new Error("Minecraft profile validation failed");

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return invalidValidation("Minecraft profile response was invalid", expiresAt);
  }
  const profile = readMinecraftProfile(body);
  if (!profile) return invalidValidation("Minecraft profile response was invalid", expiresAt);
  if (inspected.expiresAt !== null && inspected.expiresAt <= Date.now()) return invalidValidation("Minecraft access token is expired", expiresAt, "expired");
  return { profile, expiresAt, status: "valid", reason: null };
}

export function createMinecraftSessionAuth(credentials: MinecraftJavaSessionCredentials): (client: unknown, options: unknown) => void {
  return (rawClient, rawOptions) => {
    const client = rawClient as MinecraftClient;
    const options = rawOptions as MinecraftClientOptions;
    const session = {
      accessToken: credentials.accessToken,
      selectedProfile: credentials.profile,
      availableProfiles: [credentials.profile]
    };
    options.haveCredentials = true;
    options.accessToken = credentials.accessToken;
    queueMicrotask(() => {
      client.session = session;
      client.username = credentials.profile.name;
      client.uuid = credentials.profile.id;
      client.emit("session", session);
      options.connect?.(client);
    });
  };
}

function invalidValidation(reason: string, expiresAt: string | null, status: "invalid" | "expired" = "invalid"): MinecraftJavaTokenValidation {
  return { profile: null, expiresAt, status, reason };
}

function readMinecraftProfile(value: unknown): MinecraftJavaProfile | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const id = value.id.trim().replaceAll("-", "").toLowerCase();
  const name = value.name.trim();
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[A-Za-z0-9_]{1,16}$/.test(name)) return null;
  return { id, name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(value.trim())) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface MinecraftClient {
  session?: unknown;
  username: string;
  uuid: string;
  emit(event: string, value: unknown): boolean;
}

interface MinecraftClientOptions {
  accessToken?: string;
  haveCredentials?: boolean;
  connect?: (client: unknown) => void;
}
