import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
    assert.match(await viewerPage.text(), /WASD · Mouse/);
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
    const body = await stateResponse.json() as { state: { connection: string; reconnectAt: string | null; bots: Array<{ connection: string }> }; logs: Array<{ message: string }> };
    assert.equal(body.state.connection, "offline");
    assert.equal(body.state.reconnectAt, null);
    assert.ok(body.state.bots.every((entry) => entry.connection === "offline"));
    assert.equal(body.logs.some((entry) => /Verbindungsaufbau zu/.test(entry.message)), false);

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
