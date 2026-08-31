import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export class DashboardAuth {
  private readonly secret: string;
  private readonly password: string;
  private readonly totpSecret: Buffer | null;
  private readonly guestPassword: string;

  constructor() {
    this.secret = process.env.SESSION_SECRET || "";
    this.password = process.env.DASHBOARD_PASSWORD || "";
    this.guestPassword = process.env.GUEST_PASSWORD || "";
    this.totpSecret = process.env.DASHBOARD_TOTP_SECRET ? this.decodeBase32(process.env.DASHBOARD_TOTP_SECRET) : null;
    if (this.secret.length < 32) throw new Error("SESSION_SECRET muss mindestens 32 Zeichen lang sein");
    const minimumPasswordLength = process.env.NODE_ENV === "production" ? 12 : 8;
    if (this.password.length < minimumPasswordLength) throw new Error(`DASHBOARD_PASSWORD muss mindestens ${minimumPasswordLength} Zeichen lang sein`);
  }

  verifyPassword(value: string): boolean {
    return this.safeEqual(value, this.password);
  }

  loginRole(value: string): "admin" | "guest" | null {
    if (this.verifyPassword(value)) return "admin";
    if (this.guestPassword.length >= 8 && this.safeEqual(value, this.guestPassword)) return "guest";
    return null;
  }

  get totpRequired(): boolean { return Boolean(this.totpSecret); }

  verifyTotp(value: string): boolean {
    if (!this.totpSecret) return true;
    if (!/^\d{6}$/.test(value)) return false;
    const counter = Math.floor(Date.now() / 30_000);
    return [-1, 0, 1].some((offset) => this.safeEqual(value, this.totp(counter + offset)));
  }

  setCookie(response: ServerResponse, role: "admin" | "guest" = "admin"): void {
    const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
    const value = `${role}.${expires}.${this.sign(`${role}.${expires}`)}`;
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader("Set-Cookie", `rcc_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}${secure}`);
  }

  clearCookie(response: ServerResponse): void {
    response.setHeader("Set-Cookie", "rcc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  }

  isAuthenticated(request: IncomingMessage): boolean {
    return this.role(request) !== null;
  }

  role(request: IncomingMessage): "admin" | "guest" | null {
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("rcc_session="));
    if (!cookie) return null;
    const [role, expires, signature] = cookie.slice("rcc_session=".length).split(".");
    if ((role !== "admin" && role !== "guest") || !expires || !signature || Number(expires) < Date.now() / 1000) return null;
    return this.safeEqual(signature, this.sign(`${role}.${expires}`)) ? role : null;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private totp(counter: number): string {
    const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", this.totpSecret!).update(buffer).digest();
    const offset = digest[digest.length - 1]! & 15;
    const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return String(number).padStart(6, "0");
  }

  private decodeBase32(value: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
    for (const char of value.toUpperCase().replace(/=|\s/g, "")) {
      const index = alphabet.indexOf(char); if (index < 0) throw new Error("DASHBOARD_TOTP_SECRET ist kein gültiges Base32");
      bits += index.toString(2).padStart(5, "0");
    }
    return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  }
}
