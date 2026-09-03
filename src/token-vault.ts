import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { MinecraftJavaProfile } from "./minecraft-auth.js";
import { inspectAccessToken } from "./minecraft-auth.js";
import type { TokenStatus, TokenStatusKind, TokenType } from "./types.js";

interface TokenScan {
  configured: boolean;
  invalid: boolean;
  expiries: number[];
}

export interface StoredMinecraftTokenMetadata {
  profile: MinecraftJavaProfile | null;
  expiresAt: string | null;
  status: Exclude<TokenStatusKind, "not_set">;
}

interface MinecraftTokenRecord extends StoredMinecraftTokenMetadata {
  tokenType: "minecraft_java";
  accessToken: string;
  obtainedOn: number;
}

const MINECRAFT_TOKEN_FILE = "rcc-minecraft-token.json.vault";

const emptyTokenStatus = (): TokenStatus => ({ type: null, configured: false, valid: false, expiresAt: null, status: "not_set" });

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

function parseDuration(value: unknown): number | null {
  const duration = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(duration) ? duration : null;
}

function isCredentialField(key: string): boolean {
  return /token|secret/i.test(key) && !/token[_-]?type/i.test(key);
}

function isExpiryField(key: string): boolean {
  return /^(?:expires(?:on|at|_on|_at)?|validuntil|notafter|expiration(?:date)?)$/i.test(key);
}

function isDurationField(key: string): boolean {
  return /^expires_?in$/i.test(key);
}

function scanTokenData(value: unknown): TokenScan {
  const result: TokenScan = { configured: false, invalid: false, expiries: [] };
  const visit = (item: unknown, key = ""): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child, key);
      return;
    }
    if (isRecord(item)) {
      const obtainedOn = parseTimestamp(item.obtainedOn);
      const explicitExpiries = Object.entries(item)
        .filter(([childKey]) => isExpiryField(childKey))
        .map(([, child]) => parseTimestamp(child))
        .filter((value): value is number => value !== null);
      result.expiries.push(...explicitExpiries);
      for (const [childKey, child] of Object.entries(item)) {
        if (isDurationField(childKey) && obtainedOn !== null && !explicitExpiries.length) {
          const duration = parseDuration(child);
          if (duration !== null) result.expiries.push(obtainedOn + duration * 1000);
        }
        visit(child, childKey);
      }
      return;
    }
    if (typeof item !== "string" || !item.trim() || !isCredentialField(key)) return;
    result.configured = true;
    const inspected = inspectAccessToken(item);
    if (inspected.malformed) result.invalid = true;
    if (inspected.expiresAt !== null) result.expiries.push(inspected.expiresAt);
  };
  visit(value);
  return result;
}

function migrateManualCache(value: Buffer): Buffer {
  try {
    const parsed = JSON.parse(value.toString("utf8")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.token)) return value;
    const token = parsed.token;
    if (typeof token.access_token !== "string" || token.access_token !== token.refresh_token || "expiresAt" in token) return value;
    const obtainedOn = parseTimestamp(token.obtainedOn);
    const expiresIn = parseDuration(token.expires_in);
    if (obtainedOn === null || expiresIn === null || expiresIn <= 0) return value;
    token.expiresAt = new Date(obtainedOn + expiresIn * 1000).toISOString();
    token.expires_in = expiresIn * 1000;
    return Buffer.from(JSON.stringify(parsed), "utf8");
  } catch {
    return value;
  }
}

export class TokenVault {
  private readonly key: Buffer;
  constructor(private readonly directory: string, secret = process.env.CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET || "") {
    if (secret.length < 32) throw new Error("Token encryption requires a key with at least 32 characters");
    this.key = createHash("sha256").update(secret).digest();
  }

  restore(): void {
    if (!existsSync(this.directory)) return;
    for (const file of this.files(this.directory).filter((name) => name.endsWith(".vault") && basename(name) !== MINECRAFT_TOKEN_FILE)) {
      const target = file.slice(0, -6); const plain = migrateManualCache(this.decrypt(readFileSync(file, "utf8")));
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(`${target}.tmp`, plain, { mode: 0o600 }); renameSync(`${target}.tmp`, target); rmSync(file);
    }
  }

  seal(): void {
    if (!existsSync(this.directory)) return;
    for (const file of this.files(this.directory).filter((name) => !name.endsWith(".vault"))) {
      const data = readFileSync(file); if (!data.length) { rmSync(file); continue; }
      writeFileSync(`${file}.vault.tmp`, this.encrypt(data), { encoding: "utf8", mode: 0o600 }); renameSync(`${file}.vault.tmp`, `${file}.vault`); rmSync(file);
    }
  }

  hasTokens(): boolean {
    return this.status().configured;
  }

  expiresAt(): string | null {
    return this.status().expiresAt;
  }

  status(): TokenStatus {
    const files = this.files(this.directory).filter((file) => !file.endsWith(".tmp"));
    if (!files.length) return emptyTokenStatus();
    const minecraftFile = files.find((file) => basename(file) === MINECRAFT_TOKEN_FILE);
    if (minecraftFile) return this.minecraftStatus(minecraftFile);
    let configured = false;
    let invalid = false;
    const expiries: number[] = [];
    for (const file of files) {
      try {
        const raw = file.endsWith(".vault") ? this.decrypt(readFileSync(file, "utf8")) : readFileSync(file);
        const scan = scanTokenData(JSON.parse(raw.toString("utf8")) as unknown);
        configured = configured || scan.configured;
        invalid = invalid || scan.invalid;
        expiries.push(...scan.expiries);
      } catch {
        invalid = true;
      }
    }
    if (!configured) return invalid ? { type: "microsoft_oauth", configured: true, valid: false, expiresAt: null, status: "invalid" } : emptyTokenStatus();
    const now = Date.now();
    const future = expiries.filter((value) => value > now).sort((left, right) => left - right);
    if (invalid && !future.length) return { type: "microsoft_oauth", configured: true, valid: false, expiresAt: expiries.length ? new Date(Math.max(...expiries)).toISOString() : null, status: "invalid" };
    if (future.length) return { type: "microsoft_oauth", configured: true, valid: true, expiresAt: new Date(future[0]!).toISOString(), status: "valid" };
    if (expiries.length) return { type: "microsoft_oauth", configured: true, valid: false, expiresAt: new Date(Math.max(...expiries)).toISOString(), status: "expired" };
    return { type: "microsoft_oauth", configured: true, valid: !invalid, expiresAt: null, status: invalid ? "invalid" : "valid" };
  }

  setAccessToken(username: string, accessToken: string, tokenType: TokenType = "microsoft_oauth"): void {
    const normalizedUsername = username.trim();
    const normalizedToken = accessToken.trim();
    if (!normalizedUsername) throw new Error("Microsoft account email is required before saving an access token");
    if (!normalizedToken) throw new Error("Access token is required");
    if (tokenType === "minecraft_java") {
      const inspected = inspectAccessToken(normalizedToken);
      const expiresAt = inspected.expiresAt === null ? null : new Date(inspected.expiresAt).toISOString();
      const status: StoredMinecraftTokenMetadata["status"] = inspected.malformed ? "invalid" : inspected.expiresAt !== null && inspected.expiresAt <= Date.now() ? "expired" : "valid";
      this.setMinecraftJavaAccessToken(normalizedUsername, normalizedToken, { profile: null, expiresAt, status });
      return;
    }
    if (tokenType !== "microsoft_oauth") throw new Error("Invalid access token type");
    this.clear();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const obtainedOn = Date.now();
    const inspected = inspectAccessToken(normalizedToken);
    const expiresAt = inspected.malformed ? null : inspected.expiresAt ?? obtainedOn + 3_600_000;
    // prismarine-auth 3.1.1 adds expires_in directly to obtainedOn when it
    // checks a live cache, so its cache value is effectively milliseconds.
    // Keep an explicit timestamp for RCC's status scanner, which uses the
    // OAuth-standard seconds when interpreting expires_in in existing caches.
    const expiresIn = expiresAt === null ? 0 : Math.max(0, expiresAt - obtainedOn);
    const cache = JSON.stringify({ rccTokenType: "microsoft_oauth", token: { access_token: normalizedToken, refresh_token: normalizedToken, token_type: "Bearer", expires_in: expiresIn, obtainedOn, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null } });
    const file = join(this.directory, `${createHash("sha1").update(normalizedUsername, "binary").digest("hex").slice(0, 6)}_live-cache.json.vault`);
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, this.encrypt(Buffer.from(cache, "utf8")), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  }

  setMinecraftJavaAccessToken(username: string, accessToken: string, metadata: StoredMinecraftTokenMetadata): void {
    const normalizedUsername = username.trim();
    const normalizedToken = accessToken.trim();
    if (!normalizedUsername) throw new Error("Microsoft account email is required before saving an access token");
    if (!normalizedToken) throw new Error("Access token is required");
    if (!["valid", "expired", "invalid"].includes(metadata.status)) throw new Error("Invalid Minecraft token status");
    this.clear();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const record: MinecraftTokenRecord = {
      tokenType: "minecraft_java",
      accessToken: normalizedToken,
      profile: metadata.profile,
      expiresAt: metadata.expiresAt,
      status: metadata.status,
      obtainedOn: Date.now()
    };
    const file = join(this.directory, MINECRAFT_TOKEN_FILE);
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, this.encrypt(Buffer.from(JSON.stringify(record), "utf8")), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  }

  getMinecraftJavaCredentials(): { accessToken: string; profile: MinecraftJavaProfile } | null {
    const file = join(this.directory, MINECRAFT_TOKEN_FILE);
    if (!existsSync(file)) return null;
    try {
      const record = this.readMinecraftRecord(file);
      const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : null;
      if (record.status !== "valid" || !record.profile || (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now())) return null;
      return { accessToken: record.accessToken, profile: record.profile };
    } catch {
      return null;
    }
  }

  clear(): void { if (existsSync(this.directory)) rmSync(this.directory, { recursive: true, force: true }); }

  private minecraftStatus(file: string): TokenStatus {
    try {
      const record = this.readMinecraftRecord(file);
      const configured = Boolean(record.accessToken.trim());
      if (!configured) return { type: "minecraft_java", configured: false, valid: false, expiresAt: null, status: "not_set" };
      const expiresAt = record.expiresAt && Number.isFinite(Date.parse(record.expiresAt)) ? record.expiresAt : null;
      if (record.status === "invalid") return { type: "minecraft_java", configured: true, valid: false, expiresAt, status: "invalid" };
      if (record.status === "expired" || (expiresAt !== null && Date.parse(expiresAt) <= Date.now())) return { type: "minecraft_java", configured: true, valid: false, expiresAt, status: "expired" };
      return { type: "minecraft_java", configured: true, valid: true, expiresAt, status: "valid" };
    } catch {
      return { type: "minecraft_java", configured: true, valid: false, expiresAt: null, status: "invalid" };
    }
  }

  private readMinecraftRecord(file: string): MinecraftTokenRecord {
    const raw = file.endsWith(".vault") ? this.decrypt(readFileSync(file, "utf8")) : readFileSync(file);
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (!isRecord(parsed) || parsed.tokenType !== "minecraft_java" || typeof parsed.accessToken !== "string" || typeof parsed.obtainedOn !== "number" || typeof parsed.status !== "string" || !["valid", "expired", "invalid"].includes(parsed.status)) throw new Error("Invalid Minecraft token record");
    const profile = isRecord(parsed.profile) && typeof parsed.profile.id === "string" && typeof parsed.profile.name === "string" ? { id: parsed.profile.id, name: parsed.profile.name } : null;
    const expiresAt = parsed.expiresAt === null ? null : typeof parsed.expiresAt === "string" ? parsed.expiresAt : null;
    return { tokenType: "minecraft_java", accessToken: parsed.accessToken, profile, expiresAt, status: parsed.status as StoredMinecraftTokenMetadata["status"], obtainedOn: parsed.obtainedOn };
  }

  private files(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? this.files(join(directory, entry.name)) : [join(directory, entry.name)]);
  }
  private encrypt(value: Buffer): string {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv); const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
    return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
  }
  private decrypt(value: string): Buffer {
    const [, version, iv, tag, data] = value.split(":"); if (version !== "v1" || !iv || !tag || !data) throw new Error(`Invalid token vault: ${basename(this.directory)}`);
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
  }
}
