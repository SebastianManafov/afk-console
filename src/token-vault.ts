import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export class TokenVault {
  private readonly key: Buffer;
  constructor(private readonly directory: string, secret = process.env.CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET || "") {
    if (secret.length < 32) throw new Error("Token-Verschlüsselung benötigt einen Schlüssel mit mindestens 32 Zeichen");
    this.key = createHash("sha256").update(secret).digest();
  }

  restore(): void {
    if (!existsSync(this.directory)) return;
    for (const file of this.files(this.directory).filter((name) => name.endsWith(".vault"))) {
      const target = file.slice(0, -6); const plain = this.decrypt(readFileSync(file, "utf8"));
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
    try { return this.files(this.directory).some((file) => statSync(file).size > 16); } catch { return false; }
  }

  expiresAt(): string | null {
    let best = Number.POSITIVE_INFINITY;
    for (const file of this.files(this.directory)) {
      try {
        const raw = file.endsWith(".vault") ? this.decrypt(readFileSync(file, "utf8")) : readFileSync(file);
        const value = JSON.parse(raw.toString("utf8"));
        const visit = (item: unknown, key = "") => {
          if (item && typeof item === "object") for (const [childKey, child] of Object.entries(item)) visit(child, childKey);
          else if (/expires(on|at|_on|_at)$/i.test(key) && (typeof item === "number" || typeof item === "string")) {
            const parsed = typeof item === "number" ? (item > 10_000_000_000 ? item : item * 1000) : Date.parse(item);
            if (Number.isFinite(parsed) && parsed > Date.now() - 86_400_000) best = Math.min(best, parsed);
          }
        };
        visit(value);
      } catch { /* Cacheformate ohne JSON werden ignoriert. */ }
    }
    return Number.isFinite(best) ? new Date(best).toISOString() : null;
  }

  clear(): void { if (existsSync(this.directory)) rmSync(this.directory, { recursive: true, force: true }); }

  private files(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? this.files(join(directory, entry.name)) : [join(directory, entry.name)]);
  }
  private encrypt(value: Buffer): string {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv); const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
    return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
  }
  private decrypt(value: string): Buffer {
    const [, version, iv, tag, data] = value.split(":"); if (version !== "v1" || !iv || !tag || !data) throw new Error(`Ungültiger Token-Tresor: ${basename(this.directory)}`);
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
  }
}
