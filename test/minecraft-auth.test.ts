import assert from "node:assert/strict";
import test from "node:test";
import { createMinecraftSessionAuth, validateMinecraftJavaAccessToken } from "../src/minecraft-auth.js";

const profile = { id: "0123456789abcdef0123456789abcdef", name: "TestPlayer" };

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url")}.signature`;
}

test("Minecraft-Services-Profil wird serverseitig validiert und sicher übernommen", async () => {
  let requestedUrl = "";
  let authorization = "";
  const token = jwt(Math.floor(Date.now() / 1000) + 3_600);
  const fetchImpl = (async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify(profile), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const result = await validateMinecraftJavaAccessToken(token, fetchImpl);
  assert.deepEqual(result.profile, profile);
  assert.equal(result.status, "valid");
  assert.equal(requestedUrl, "https://api.minecraftservices.com/minecraft/profile");
  assert.equal(authorization, `Bearer ${token}`);
  assert.doesNotMatch(JSON.stringify({ profile: result.profile, status: result.status, expiresAt: result.expiresAt }), /Bearer|header\./);
});

test("Abgelaufene oder abgewiesene Minecraft-Tokens werden nicht als gültig markiert", async () => {
  let requests = 0;
  const expired = await validateMinecraftJavaAccessToken(jwt(Math.floor(Date.now() / 1000) - 60), (async () => {
    requests += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch);
  assert.equal(expired.status, "expired");
  assert.equal(requests, 0);

  const rejected = await validateMinecraftJavaAccessToken("opaque-token", (async () => new Response("", { status: 401 })) as typeof fetch);
  assert.equal(rejected.status, "invalid");
  const malformedProfile = await validateMinecraftJavaAccessToken("opaque-token", (async () => new Response(JSON.stringify({ id: "wrong", name: "?" }), { status: 200 })) as typeof fetch);
  assert.equal(malformedProfile.status, "invalid");
});

test("Minecraft-Sessionpfad setzt nur eine direkte Session und startet keinen Microsoft-Authflow", async () => {
  const accessToken = "synthetic-minecraft-token";
  let connected = false;
  const emitted: string[] = [];
  const client = {
    session: undefined as unknown,
    username: "",
    uuid: "",
    emit: (event: string) => { emitted.push(event); return true; }
  };
  const options = {
    accessToken: "",
    haveCredentials: false,
    connect: () => { connected = true; }
  };
  createMinecraftSessionAuth({ accessToken, profile })(client, options);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(options.haveCredentials, true);
  assert.equal(options.accessToken, accessToken);
  assert.equal(client.username, profile.name);
  assert.equal(client.uuid, profile.id);
  assert.equal(connected, true);
  assert.deepEqual(emitted, ["session"]);
});
