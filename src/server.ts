import { createReadStream } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { DashboardAuth } from "./auth.js";
import type { MultiBotManager } from "./multi-bot-manager.js";
import type { ConfigStore } from "./config.js";
import type { AppEvents } from "./events.js";
import type { WebhookNotifier } from "./webhook.js";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function startServer(config: ConfigStore, events: AppEvents, bot: MultiBotManager, webhook: WebhookNotifier, options: { port?: number; host?: string } = {}): Server {
  const auth = new DashboardAuth();
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  const publicDir = join(process.cwd(), "public");
  const server = createServer(async (request, response) => {
    try {
      setSecurityHeaders(response);
      if (request.url === "/health") return json(response, 200, { ok: true, connection: bot.snapshot().connection, uptimeSeconds: bot.snapshot().uptimeSeconds, memoryMb: bot.snapshot().memoryMb });
      if (request.url === "/api/auth/info" && request.method === "GET") return json(response, 200, { totpRequired: auth.totpRequired, role: auth.role(request) });
      if (request.url === "/api/login" && request.method === "POST") {
        const address = request.socket.remoteAddress || "unknown";
        const now = Date.now(); const attempt = loginAttempts.get(address);
        if (attempt && attempt.resetAt > now && attempt.count >= 5) return json(response, 429, { error: "Zu viele Loginversuche. Bitte in 15 Minuten erneut versuchen" });
        const body = await readJson(request);
        const role = auth.loginRole(String(body.password ?? ""));
        if (!role || (role === "admin" && !auth.verifyTotp(String(body.totp ?? "")))) {
          loginAttempts.set(address, { count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1, resetAt: now + 15 * 60_000 });
          return json(response, 401, { error: "Passwort oder Zwei-Faktor-Code ist falsch" });
        }
        loginAttempts.delete(address);
        auth.setCookie(response, role);
        return json(response, 200, { ok: true, role });
      }
      if (request.url === "/api/logout" && request.method === "POST") {
        auth.clearCookie(response);
        return json(response, 200, { ok: true });
      }
      if (request.url?.startsWith("/api/")) {
        const role = auth.role(request);
        if (!role) return json(response, 401, { error: "Nicht angemeldet" });
        return await handleApi(request, response, config, events, bot, webhook);
      }
      await serveStatic(request, response, publicDir);
    } catch (error) {
      events.log("error", "server", (error as Error).message);
      json(response, httpStatusForError(error), { error: (error as Error).message });
    }
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws" || !auth.isAuthenticated(request)) return socket.destroy();
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit("connection", client));
  });
  sockets.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "initial", state: bot.snapshot(), logs: events.recentLogs(), config: config.publicValue() }));
  });
  const broadcast = (payload: unknown) => {
    const message = JSON.stringify(payload);
    for (const client of sockets.clients) if (client.readyState === client.OPEN) client.send(message);
  };
  events.on("state", (state) => broadcast({ type: "state", state }));
  events.on("log", (entry) => broadcast({ type: "log", entry }));
  events.on("chat", (entry) => broadcast({ type: "chat", entry }));

  const port = options.port ?? Number(process.env.PORT || 3000);
  server.listen(port, options.host ?? "0.0.0.0", () => {
    const address = server.address();
    events.log("info", "server", `Dashboard läuft auf Port ${address && typeof address !== "string" ? address.port : port}`);
  });
  return server;
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  config: ConfigStore,
  events: AppEvents,
  bot: MultiBotManager,
  webhook: WebhookNotifier
): Promise<void> {
  if (request.url === "/api/state" && request.method === "GET") return json(response, 200, { state: bot.snapshot(), logs: events.recentLogs(), config: config.publicValue() });
  if (request.url === "/api/system-check" && request.method === "GET") {
    const dataDir = process.env.DATA_DIR || "./data"; let dataWritable = false;
    try { await mkdir(dataDir, { recursive: true }); await access(dataDir, fsConstants.R_OK | fsConstants.W_OK); dataWritable = true; } catch { dataWritable = false; }
    return json(response, 200, { node: process.version, provider: process.env.RAILWAY_ENVIRONMENT_NAME ? "railway" : "local", dataDirConfigured: Boolean(process.env.DATA_DIR), dataWritable, autoConnectAllowed: process.env.AUTO_CONNECT !== "false", sessionSecretConfigured: Boolean(process.env.SESSION_SECRET), encryptionKeyDedicated: Boolean(process.env.CONFIG_ENCRYPTION_KEY) });
  }
  if (request.url === "/api/settings" && request.method === "PUT") {
    const value = await config.update(await readJson(request));
    bot.applyConfig();
    return json(response, 200, { config: value });
  }
  if (request.url === "/api/webhook/test" && request.method === "POST") {
    const sent = await webhook.send("test", "Webhook-Test", "Die Benachrichtigungen des Remote Console Client (RCC)s funktionieren.");
    return json(response, sent ? 200 : 400, sent ? { sent } : { sent, error: "Webhook ist nicht konfiguriert oder konnte nicht erreicht werden" });
  }
  if (request.url === "/api/proxy/test" && request.method === "POST") {
    const { proxyId, serverId } = await readJson(request);
    const proxy = config.get().proxies.find((item) => item.id === proxyId);
    const target = config.get().servers.find((item) => item.id === serverId) ?? config.get().servers[0];
    if (!proxy || !target) throw new Error("Proxy oder Serverprofil fehlt");
    const latencyMs = await testHttpProxy(proxy, target.host, target.port);
    return json(response, 200, { ok: true, latencyMs });
  }
  if (request.url === "/api/server/test" && request.method === "POST") {
    const { serverId } = await readJson(request);
    const target = config.get().servers.find((item) => item.id === serverId);
    if (!target) throw new Error("Serverprofil fehlt");
    const latencyMs = await testTcpTarget(target.host, target.port);
    return json(response, 200, { ok: true, latencyMs });
  }
  if (request.url === "/api/emergency-stop" && request.method === "POST") {
    bot.stop();
    const current = config.get();
    const value = await config.update({ sell: { ...current.sell, enabled: false }, spawner: { ...current.spawner, enabled: false }, accounts: current.accounts.map((account) => ({ ...account, sell: account.sell ? { ...account.sell, enabled: false } : null, spawner: account.spawner ? { ...account.spawner, enabled: false } : null })) });
    bot.applyConfig();
    events.log("warn", "safety", "Not-Aus ausgeführt: Bot getrennt und Makros deaktiviert");
    return json(response, 200, { ok: true, config: value });
  }
  if (request.url === "/api/account/logout" && request.method === "POST") {
    const body = await readJson(request); await bot.logout(String(body.accountId ?? ""));
    return json(response, 200, { ok: true });
  }
  if (request.url === "/api/account/login" && request.method === "POST") {
    const body = await readJson(request); bot.login(String(body.accountId ?? ""));
    return json(response, 202, { ok: true });
  }
  if (request.url === "/api/account/pause" && request.method === "POST") {
    const body = await readJson(request); const accountId = String(body.accountId ?? ""); const paused = Boolean(body.paused); const current = config.get();
    if (!current.accounts.some((account) => account.id === accountId)) throw new Error("Account nicht gefunden");
    if (paused) bot.stop([accountId]);
    const value = await config.update({ accounts: current.accounts.map((account) => account.id === accountId ? { ...account, paused } : account) }); bot.applyConfig();
    return json(response, 200, { ok: true, config: value });
  }
  if (request.url === "/api/account" && request.method === "DELETE") {
    const body = await readJson(request); const accountId = String(body.accountId ?? "");
    const current = config.get(); if (current.accounts.length <= 1) throw new Error("Der letzte Account kann nicht gelöscht werden");
    await bot.logout(accountId);
    const value = await config.update({ accounts: current.accounts.filter((account) => account.id !== accountId) }); bot.applyConfig();
    return json(response, 200, { ok: true, config: value });
  }
  if (request.url === "/api/bot/connect" && request.method === "POST") { const body = await readJson(request); bot.connect(Array.isArray(body.accountIds) ? body.accountIds.map(String) : undefined); return json(response, 202, { ok: true }); }
  if (request.url === "/api/bot/stop" && request.method === "POST") { const body = await readJson(request); bot.stop(Array.isArray(body.accountIds) ? body.accountIds.map(String) : undefined); return json(response, 200, { ok: true }); }
  if (request.url === "/api/bot/reconnect" && request.method === "POST") { const body = await readJson(request); bot.reconnect(Array.isArray(body.accountIds) ? body.accountIds.map(String) : undefined); return json(response, 202, { ok: true }); }
  if (request.url === "/api/bot/chat" && request.method === "POST") { const body = await readJson(request); bot.sendChat(String(body.message ?? ""), body.accountId === undefined ? undefined : String(body.accountId)); return json(response, 200, { ok: true }); }
  if (request.url === "/api/bot/control" && request.method === "POST") { const body = await readJson(request); const { accountId, ...control } = body; await bot.control(control, accountId === undefined ? undefined : String(accountId)); return json(response, 200, { ok: true }); }
  if (request.url === "/api/bot/take-over" && request.method === "POST") { const body = await readJson(request); bot.takeOver(body.accountId === undefined ? undefined : String(body.accountId)); return json(response, 200, { ok: true }); }
  if (request.url === "/api/macro/sell/run" && request.method === "POST") { const body = await readJson(request); bot.runSell(Array.isArray(body.accountIds) ? body.accountIds.map(String) : undefined); return json(response, 202, { ok: true }); }
  if (request.url === "/api/macro/spawner/run" && request.method === "POST") { const body = await readJson(request); bot.runSpawner(Array.isArray(body.accountIds) ? body.accountIds.map(String) : undefined); return json(response, 202, { ok: true }); }
  if (request.url === "/api/macro/preview" && request.method === "POST") {
    const body = await readJson(request); const selected = new Set(Array.isArray(body.accountIds) ? body.accountIds.map(String) : config.get().accounts.map((item) => item.id));
    const snapshots = new Map((bot.snapshot().bots ?? []).map((item) => [item.accountId, item]));
    const plans = config.get().accounts.filter((account) => selected.has(account.id)).map((account) => {
      const sell = account.sell ?? config.get().sell; const spawner = account.spawner ?? config.get().spawner; const snapshot = snapshots.get(account.id);
      const order = spawner.orderEnabled ? [spawner.homeTopCommand, spawner.orderCommand, spawner.orderAutoDetect ? `Bone-Orders auf bis zu ${spawner.orderMaxPages} Seiten prüfen` : `Bone-Order Slot ${spawner.orderHighestSlot}`, `Alle Bones liefern (Slot ${spawner.orderDeliverAllSlot}, ${spawner.orderMinDelayMs}-${spawner.orderMaxDelayMs} ms)`] : [];
      return { accountId: account.id, name: account.name, online: snapshot?.connection === "online", inventoryItems: snapshot?.inventory.length ?? 0, sell: [`Command ${sell.command}`, `Pause ${sell.minPauseMs}-${sell.maxPauseMs} ms`, `Zeitfenster ${sell.scheduleStart}-${sell.scheduleEnd}`], spawner: [spawner.homeTopCommand, spawner.homeBottomCommand, `W → S → D (${spawner.movementStepMs} ms)`, "Spawner rechtsklicken", spawner.autoDetectSlots ? "GUI-Slots automatisch erkennen" : `Slots ${spawner.sellAllSlot}/${spawner.pageLeftSlot}/${spawner.pageRightSlot}/${spawner.dropAllSlot}`, spawner.arrowAbort ? "Arrow Guard prüfen" : "Arrow Guard deaktiviert", ...order, spawner.afkHomeCommand] };
    });
    return json(response, 200, { plans });
  }
  json(response, 404, { error: "Nicht gefunden" });
}

export function httpStatusForError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/Request zu groß/i.test(message)) return 413;
  if (/Zu viele Loginversuche/i.test(message)) return 429;
  if (/nicht online|kein ausgewählter Account ist online|pausiert|Verbindungsaufbau läuft bereits|accountId ist erforderlich|läuft kein Makro/i.test(message)) return 409;
  if (error instanceof SyntaxError || /Ungültig|fehlt|nicht gefunden|nicht konfiguriert|letzte Account|kann nicht gelöscht/i.test(message)) return 400;
  return 500;
}

function testHttpProxy(proxy: { host: string; port: number; username: string; password: string }, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now(); const headers: Record<string, string> = {};
    if (proxy.username) headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`;
    const request = httpRequest({ host: proxy.host, port: proxy.port, method: "CONNECT", path: `${host}:${port}`, headers, timeout: 8_000 });
    request.once("connect", (response, socket) => { socket.destroy(); response.statusCode === 200 ? resolve(Date.now() - started) : reject(new Error(`Proxy HTTP ${response.statusCode}`)); });
    request.once("timeout", () => request.destroy(new Error("Proxy-Test Timeout")));
    request.once("error", reject); request.end();
  });
}

function testTcpTarget(host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = createConnection({ host, port });
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(Date.now() - started);
    };
    socket.setTimeout(8_000);
    socket.once("connect", () => finish());
    socket.once("timeout", () => finish(new Error("Server-Test Timeout")));
    socket.once("error", (error) => finish(error));
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 100_000) throw new Error("Request zu groß");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>;
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, publicDir: string): Promise<void> {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(publicDir, relative));
  if (!file.startsWith(normalize(publicDir))) return json(response, 403, { error: "Verboten" });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not file");
    response.writeHead(200, { "Content-Type": contentTypes[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    json(response, 404, { error: "Nicht gefunden" });
  }
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' wss: ws:; style-src 'self'; script-src 'self'");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
