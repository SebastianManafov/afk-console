import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { DashboardAuth } from "../src/auth.js";

test("TOTP schützt den Dashboard-Login optional", () => {
  const previous = { password: process.env.DASHBOARD_PASSWORD, secret: process.env.SESSION_SECRET, totp: process.env.DASHBOARD_TOTP_SECRET, nodeEnv: process.env.NODE_ENV };
  try {
    process.env.DASHBOARD_PASSWORD = "test-password-123";
    process.env.SESSION_SECRET = "01234567890123456789012345678901";
    process.env.DASHBOARD_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
    const auth = new DashboardAuth();
    const key = Buffer.from("Hello!\xde\xad\xbe\xef", "latin1");
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac("sha1", key).update(counter).digest(); const offset = digest.at(-1)! & 15;
    const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
    assert.equal(auth.totpRequired, true); assert.equal(auth.verifyTotp(code), true); assert.equal(auth.verifyTotp("000000"), false);
  } finally {
    if (previous.password === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous.secret;
    if (previous.totp === undefined) delete process.env.DASHBOARD_TOTP_SECRET; else process.env.DASHBOARD_TOTP_SECRET = previous.totp;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
  }
});

test("Lokale Passwörter dürfen 8 Zeichen haben, Produktion verlangt 12", () => {
  const previous = { password: process.env.DASHBOARD_PASSWORD, secret: process.env.SESSION_SECRET, nodeEnv: process.env.NODE_ENV };
  try {
    process.env.DASHBOARD_PASSWORD = "Test123!";
    process.env.SESSION_SECRET = "01234567890123456789012345678901";
    process.env.NODE_ENV = "development";
    assert.equal(new DashboardAuth().verifyPassword("Test123!"), true);
    process.env.NODE_ENV = "production";
    assert.throws(() => new DashboardAuth(), /mindestens 12 Zeichen/);
  } finally {
    if (previous.password === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous.secret;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
  }
});
