import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore } from "../src/config.js";
import { AppEvents } from "../src/events.js";
import { MultiBotManager } from "../src/multi-bot-manager.js";
import { startServer } from "../src/server.js";
import { WebhookNotifier } from "../src/webhook.js";

test("Offline-Dashboard: Login, State, Health, Preview und Sicherheitsfehler", { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "rcc-offline-api-"));
  const previousPassword = process.env.DASHBOARD_PASSWORD;
  const previousSecret = process.env.SESSION_SECRET;
  const previousGuestPassword = process.env.GUEST_PASSWORD;
  process.env.DASHBOARD_PASSWORD = "TestPass123!";
  process.env.GUEST_PASSWORD = "GuestPass123!";
  process.env.SESSION_SECRET = "offline-integration-session-secret-123456";
  const config = new ConfigStore(directory, "offline-integration-config-secret-123456");
  await config.load();
  const initialConfig = config.get();
  await config.update({ accounts: initialConfig.accounts.map((account) => ({ ...account, username: "player@example.com" })) });
  const events = new AppEvents(false);
  const webhook = new WebhookNotifier(config, events);
  const bot = new MultiBotManager(config, events, webhook, directory);
  const server = startServer(config, events, bot, webhook, { port: 0, host: "127.0.0.1" });
  if (!server.listening) await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Dashboard-Testserver hat keine TCP-Adresse");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const health = await (await fetch(`${baseUrl}/health`)).json() as { ok: boolean; connection: string };
    assert.deepEqual({ ok: health.ok, connection: health.connection }, { ok: true, connection: "offline" });
    assert.equal((await fetch(`${baseUrl}/api/state`)).status, 401);

    const login = await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "TestPass123!" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie?.startsWith("rcc_session="));
    const headers = { cookie: cookie! };

    assert.equal((await fetch(`${baseUrl}/pov-viewer/`)).status, 401);
    const viewerPage = await fetch(`${baseUrl}/pov-viewer/`, { headers });
    assert.equal(viewerPage.status, 200);
    const viewerHtml = await viewerPage.text();
    assert.doesNotMatch(viewerHtml, /id="hud"|id="controls"|id="firstPersonHand"/);
    assert.match(viewerHtml, /id="offhandIcon"/);
    assert.doesNotMatch(viewerHtml, /held-card-title|offhandName|heldItemName/);
    assert.doesNotMatch(viewerHtml, /id="follow"|id="freecam"/);
    const dashboardPage = await fetch(`${baseUrl}/`, { headers });
    assert.equal(dashboardPage.status, 200);
    const dashboardHtml = await dashboardPage.text();
    assert.match(dashboardHtml, /id="povNavToggle"[^>]*aria-expanded="false"/);
    assert.match(dashboardHtml, /id="povModeSubnav"[^>]*hidden/);
    assert.equal((dashboardHtml.match(/data-pov-mode="/g) || []).length, 2);
    assert.match(dashboardHtml, /data-pov-mode="bot"/);
    assert.match(dashboardHtml, /data-pov-mode="freecam"/);
    assert.doesNotMatch(dashboardHtml, /pov-mode-panel|Choose a perspective/);
    assert.match(dashboardHtml, /id="profileInputToken" type="password"/);
    assert.match(dashboardHtml, /id="profileInputTokenType"/);
    assert.equal((dashboardHtml.match(/<option value="(?:microsoft_oauth|minecraft_java)">/g) || []).length, 2);
    assert.match(dashboardHtml, /Microsoft OAuth Access Token/);
    assert.match(dashboardHtml, /Minecraft Java Access Token/);
    assert.match(dashboardHtml, /placeholder="Enter new token to replace existing token"/);
    assert.match(dashboardHtml, /id="removeAccountToken"/);
    const viewerBundle = await fetch(`${baseUrl}/pov-viewer/index.js`, { headers });
    assert.equal(viewerBundle.status, 200);
    assert.ok(Number(viewerBundle.headers.get("content-length") ?? 0) > 0 || (await viewerBundle.arrayBuffer()).byteLength > 1_000_000);
    const textureAtlas = await fetch(`${baseUrl}/pov-viewer/textures/1.21.4.png`, { headers });
    assert.equal(textureAtlas.status, 200);
    assert.equal(textureAtlas.headers.get("content-type"), "image/png");
    const modernTextureAtlas = await fetch(`${baseUrl}/pov-viewer/textures/26.1.2.png`, { headers });
    assert.equal(modernTextureAtlas.status, 200);
    assert.equal(modernTextureAtlas.headers.get("content-type"), "image/png");
    assert.ok((await modernTextureAtlas.arrayBuffer()).byteLength > 400_000);
    const modernBlockStates = await fetch(`${baseUrl}/pov-viewer/blocksStates/26.1.2.json`, { headers: { ...headers, "accept-encoding": "gzip" } });
    assert.equal(modernBlockStates.status, 200);
    assert.equal(modernBlockStates.headers.get("content-encoding"), "gzip");
    assert.ok((await modernBlockStates.arrayBuffer()).byteLength > 1_000_000);
    const unauthenticatedViewerSocket = await fetch(`${baseUrl}/pov-viewer/socket.io/?EIO=4&transport=polling`);
    assert.equal(unauthenticatedViewerSocket.status, 403);

    const stateResponse = await fetch(`${baseUrl}/api/state`, { headers });
    assert.equal(stateResponse.status, 200);
    const body = await stateResponse.json() as { state: { connection: string; reconnectAt: string | null; bots: Array<{ connection: string; tokenStatus?: unknown }> }; logs: Array<{ message: string }> };
    assert.equal(body.state.connection, "offline");
    assert.equal(body.state.reconnectAt, null);
    assert.ok(body.state.bots.every((entry) => entry.connection === "offline"));
    assert.deepEqual(body.state.bots[0]?.tokenStatus, { type: null, configured: false, valid: false, expiresAt: null, status: "not_set" });
    assert.equal(body.logs.some((entry) => /Verbindungsaufbau zu/.test(entry.message)), false);

    const accessToken = "synthetic-dashboard-access-token";
    const missingTokenType = await fetch(`${baseUrl}/api/account/token`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary", accessToken }) });
    assert.equal(missingTokenType.status, 400);
    const setToken = await fetch(`${baseUrl}/api/account/token`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary", tokenType: "microsoft_oauth", accessToken }) });
    assert.equal(setToken.status, 200);
    const setTokenBody = await setToken.json() as { tokenStatus: { type: string; configured: boolean; valid: boolean; expiresAt: string | null; status: string } };
    assert.equal(setTokenBody.tokenStatus.configured, true);
    assert.equal(setTokenBody.tokenStatus.valid, true);
    assert.equal(setTokenBody.tokenStatus.status, "valid");
    assert.equal(setTokenBody.tokenStatus.type, "microsoft_oauth");
    assert.doesNotMatch(JSON.stringify(setTokenBody), new RegExp(accessToken));
    const stateAfterToken = await (await fetch(`${baseUrl}/api/state`, { headers })).text();
    assert.doesNotMatch(stateAfterToken, new RegExp(accessToken));
    const emptyToken = await fetch(`${baseUrl}/api/account/token`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary", tokenType: "microsoft_oauth", accessToken: "" }) });
    assert.equal(emptyToken.status, 400);
    const stateAfterEmptyToken = await (await fetch(`${baseUrl}/api/state`, { headers })).json() as { state: { bots: Array<{ tokenStatus: unknown }> } };
    assert.deepEqual(stateAfterEmptyToken.state.bots[0]?.tokenStatus, setTokenBody.tokenStatus);
    const tokenFiles = await readdir(join(directory, "accounts", "primary", "auth"));
    assert.equal(tokenFiles.length, 1);
    assert.match(tokenFiles[0]!, /\.vault$/);
    assert.doesNotMatch(await readFile(join(directory, "accounts", "primary", "auth", tokenFiles[0]!), "utf8"), new RegExp(accessToken));
    const removeToken = await fetch(`${baseUrl}/api/account/token`, { method: "DELETE", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary" }) });
    assert.equal(removeToken.status, 200);
    assert.deepEqual((await removeToken.json() as { tokenStatus: unknown }).tokenStatus, { type: null, configured: false, valid: false, expiresAt: null, status: "not_set" });

    const minecraftToken = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3_600 }), "utf8").toString("base64url")}.signature`;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      if (String(input) === "https://api.minecraftservices.com/minecraft/profile") return new Response(JSON.stringify({ id: "0123456789abcdef0123456789abcdef", name: "TestPlayer" }), { status: 200, headers: { "content-type": "application/json" } });
      return previousFetch(input, init);
    }) as typeof fetch;
    try {
      const setMinecraftToken = await fetch(`${baseUrl}/api/account/token`, { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary", tokenType: "minecraft_java", accessToken: minecraftToken }) });
      assert.equal(setMinecraftToken.status, 200);
      const setMinecraftBody = await setMinecraftToken.json() as { tokenStatus: { type: string; configured: boolean; valid: boolean; expiresAt: string | null; status: string } };
      assert.equal(setMinecraftBody.tokenStatus.type, "minecraft_java");
      assert.equal(setMinecraftBody.tokenStatus.configured, true);
      assert.equal(setMinecraftBody.tokenStatus.valid, true);
      assert.equal(setMinecraftBody.tokenStatus.status, "valid");
      assert.ok(setMinecraftBody.tokenStatus.expiresAt);
      assert.doesNotMatch(JSON.stringify(setMinecraftBody), new RegExp(minecraftToken));
      const minecraftState = await (await fetch(`${baseUrl}/api/state`, { headers })).text();
      assert.doesNotMatch(minecraftState, new RegExp(minecraftToken));
      const minecraftFiles = await readdir(join(directory, "accounts", "primary", "auth"));
      assert.deepEqual(minecraftFiles, ["rcc-minecraft-token.json.vault"]);
      assert.doesNotMatch(await readFile(join(directory, "accounts", "primary", "auth", minecraftFiles[0]!), "utf8"), new RegExp(minecraftToken));
    } finally {
      globalThis.fetch = previousFetch;
    }
    const removeMinecraftToken = await fetch(`${baseUrl}/api/account/token`, { method: "DELETE", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary" }) });
    assert.equal(removeMinecraftToken.status, 200);

    const systemCheck = await fetch(`${baseUrl}/api/system-check`, { headers });
    assert.equal(systemCheck.status, 200);
    const system = await systemCheck.json() as Record<string, unknown>;
    assert.equal(system.provider, "local");
    assert.equal(system.dataWritable, true);
    assert.equal("password" in system, false);
    assert.equal("sessionSecret" in system, false);

    const guestLogin = await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "GuestPass123!" }) });
    assert.equal(guestLogin.status, 200);
    assert.equal((await guestLogin.clone().json() as { role: string }).role, "guest");
    const guestCookie = guestLogin.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    assert.equal((await fetch(`${baseUrl}/api/state`, { headers: { cookie: guestCookie } })).status, 200);
    const guestPreview = await fetch(`${baseUrl}/api/macro/preview`, { method: "POST", headers: { cookie: guestCookie, "content-type": "application/json" }, body: "{}" });
    assert.equal(guestPreview.status, 200);
    const guestControl = await fetch(`${baseUrl}/api/bot/control`, { method: "POST", headers: { cookie: guestCookie, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary", action: "swing" }) });
    assert.equal(guestControl.status, 403);
    const guestSettings = await fetch(`${baseUrl}/api/settings`, { method: "PUT", headers: { cookie: guestCookie, "content-type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(guestSettings.status, 403);

    const preview = await fetch(`${baseUrl}/api/macro/preview`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" });
    assert.equal(preview.status, 200);
    assert.ok(((await preview.json()) as { plans: unknown[] }).plans.length >= 1);
    const chat = await fetch(`${baseUrl}/api/bot/chat`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary", message: "offline test" }) });
    assert.equal(chat.status, 409);
    const control = await fetch(`${baseUrl}/api/bot/control`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary", action: "swing" }) });
    assert.equal(control.status, 409);
    const takeOver = await fetch(`${baseUrl}/api/bot/take-over`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ accountId: "primary" }) });
    assert.equal(takeOver.status, 409);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong-password" }) });
      assert.equal(rejected.status, 401);
    }
    const rateLimited = await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong-password" }) });
    assert.equal(rateLimited.status, 429);
  } finally {
    bot.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousPassword === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
    if (previousGuestPassword === undefined) delete process.env.GUEST_PASSWORD; else process.env.GUEST_PASSWORD = previousGuestPassword;
    await rm(directory, { recursive: true, force: true });
  }
});
