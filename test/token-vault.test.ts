import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TokenVault } from "../src/token-vault.js";

test("OAuth-TokenVault verschlüsselt und stellt Cachedateien wieder her", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-token-vault-"));
  try {
    const file = join(directory, "msa-cache.json"); const token = JSON.stringify({ accessToken: "secret-token", expiresOn: Date.now() + 3_600_000 });
    await writeFile(file, token); const vault = new TokenVault(directory, "test-encryption-secret-with-32-characters"); vault.seal();
    assert.deepEqual(await readdir(directory), ["msa-cache.json.vault"]);
    assert.doesNotMatch(await readFile(`${file}.vault`, "utf8"), /secret-token/);
    assert.equal(vault.hasTokens(), true); assert.ok(vault.expiresAt()); vault.restore();
    assert.equal(await readFile(file, "utf8"), token);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Manuell gesetzte Microsoft-Access-Tokens bleiben verschlüsselt und liefern nur Statusmetadaten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-access-token-vault-"));
  const secret = "test-encryption-secret-with-32-characters";
  const accessToken = "synthetic-access-token-value";
  try {
    const vault = new TokenVault(directory, secret);
    vault.setAccessToken("player@example.com", accessToken);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /_live-cache\.json\.vault$/);
    assert.doesNotMatch(await readFile(join(directory, files[0]!), "utf8"), new RegExp(accessToken));
    assert.deepEqual(vault.status(), { configured: true, valid: true, expiresAt: vault.expiresAt(), status: "valid" });
    vault.restore();
    assert.match(await readFile(join(directory, files[0]!.replace(/\.vault$/, "")), "utf8"), new RegExp(accessToken));
    vault.seal();
    assert.doesNotMatch(await readFile(join(directory, files[0]!), "utf8"), new RegExp(accessToken));

    const expiredJwt = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }), "utf8").toString("base64url")}.signature`;
    vault.setAccessToken("player@example.com", expiredJwt);
    assert.equal(vault.status().status, "expired");
    vault.setAccessToken("player@example.com", "not.a.valid-jwt");
    assert.equal(vault.status().status, "invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
