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
