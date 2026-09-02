import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { access, mkdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { createGzip } from "node:zlib";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { Server as SocketIOServer } from "socket.io";
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
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp"
};

const require = createRequire(import.meta.url);
const { WorldView } = require("prismarine-viewer/viewer/lib/worldView") as { WorldView: new (world: unknown, viewDistance: number, position: unknown, emitter: unknown) => any };

export function viewerRenderVersion(minecraftVersion: string): string | null {
  const version = minecraftVersion.trim();
  if (version.startsWith("26.1") || version.startsWith("1.21.")) return "1.21.4";
  return null;
}

export function startServer(config: ConfigStore, events: AppEvents, bot: MultiBotManager, webhook: WebhookNotifier, options: { port?: number; host?: string } = {}): Server {
  const auth = new DashboardAuth();
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  const publicDir = join(process.cwd(), "public");
  const localViewerAssetsDir = join(publicDir, "pov-viewer");
  const viewerAssetsDir = join(process.cwd(), "node_modules", "prismarine-viewer", "public");
  const server = createServer(async (request, response) => {
    try {
      setSecurityHeaders(response);
      if (request.url === "/health") return json(response, 200, { ok: true, connection: bot.snapshot().connection, uptimeSeconds: bot.snapshot().uptimeSeconds, memoryMb: bot.snapshot().memoryMb });
      if (request.url === "/api/auth/info" && request.method === "GET") return json(response, 200, { totpRequired: auth.totpRequired, role: auth.role(request) });
      if (request.url === "/api/login" && request.method === "POST") {
        const address = request.socket.remoteAddress || "unknown";
        const now = Date.now(); const attempt = loginAttempts.get(address);
        if (attempt && attempt.resetAt > now && attempt.count >= 5) return json(response, 429, { error: "Too many login attempts. Please try again in 15 minutes" });
        const body = await readJson(request);
        const role = auth.loginRole(String(body.password ?? ""));
        if (!role || (role === "admin" && !auth.verifyTotp(String(body.totp ?? "")))) {
          loginAttempts.set(address, { count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1, resetAt: now + 15 * 60_000 });
          return json(response, 401, { error: "Password or two-factor code is incorrect" });
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
        if (!role) return json(response, 401, { error: "Not authenticated" });
        return await handleApi(request, response, config, events, bot, webhook);
      }
      if (request.url?.startsWith("/pov-viewer/textures/") || request.url?.startsWith("/pov-viewer/blocksStates/") || request.url === "/pov-viewer/worker.js") {
        if (!auth.isAuthenticated(request)) return json(response, 401, { error: "Not authenticated" });
        const relative = request.url.replace(/^\/pov-viewer\//, "");
        const localAsset = join(localViewerAssetsDir, relative);
        if ((await stat(localAsset).catch(() => null))?.isFile()) return await serveStaticPath(request, response, localViewerAssetsDir, relative);
        return await serveStaticPath(request, response, viewerAssetsDir, relative);
      }
      if (request.url?.startsWith("/pov-viewer/") && !auth.isAuthenticated(request)) return json(response, 401, { error: "Not authenticated" });
      await serveStatic(request, response, publicDir);
    } catch (error) {
      events.log("error", "server", (error as Error).message);
      json(response, httpStatusForError(error), { error: (error as Error).message });
    }
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/ws")) return;
    if (!auth.isAuthenticated(request)) return socket.destroy();
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

  const viewerSockets = new SocketIOServer(server, {
    path: "/pov-viewer/socket.io",
    allowRequest: (request, callback) => callback(null, auth.isAuthenticated(request))
  });
  viewerSockets.use((socket, next) => auth.isAuthenticated(socket.request) ? next() : next(new Error("Not authenticated")));
  viewerSockets.on("connection", async (socket) => {
    const requestedAccountId = typeof socket.handshake.query.accountId === "string" ? socket.handshake.query.accountId : undefined;
    const target = bot.viewerBot(requestedAccountId);
    if (!target?.entity?.position) { socket.emit("viewerUnavailable", "No bot is online"); return; }
    const minecraftVersion = typeof target.version === "string" ? target.version.trim() : "";
    if (!minecraftVersion) { socket.emit("viewerUnavailable", "Minecraft version is not available yet"); return; }
    const viewerVersion = viewerRenderVersion(minecraftVersion);
    if (!viewerVersion) {
      socket.emit("viewerUnavailable", `POV does not support ${minecraftVersion} yet`);
      return;
    }
    events.log("info", "viewer", `POV starting: Minecraft ${minecraftVersion}, render profile ${viewerVersion}, position ${Math.round(target.entity.position.x)},${Math.round(target.entity.position.y)},${Math.round(target.entity.position.z)}`);
    socket.emit("version", viewerVersion);
    socket.emit("selfEntity", {
      id: target.entity.id,
      name: "player",
      username: target.username,
      pos: target.entity.position,
      width: target.entity.width ?? 0.6,
      height: target.entity.height ?? 1.8,
      yaw: target.entity.yaw,
      pitch: target.entity.pitch
    });
    const viewerEmitter = new EventEmitter();
    let loadedChunkCount = 0;
    let unloadedChunkCount = 0;
    viewerEmitter.on("loadChunk", ({ x, z, chunk }: { x: number; z: number; chunk: string }) => {
      loadedChunkCount += 1;
      let details = "unknown format";
      try {
        const parsed = JSON.parse(chunk) as { minY?: number; worldHeight?: number; sections?: unknown[] };
        details = `minY=${parsed.minY ?? "?"}, height=${parsed.worldHeight ?? "?"}, sections=${parsed.sections?.length ?? "?"}, ${chunk.length} bytes`;
      } catch (error) {
        details = `JSON error ${(error as Error).message}`;
      }
      if (loadedChunkCount <= 3 || loadedChunkCount % 25 === 0) events.log("info", "viewer", `POV chunk ${loadedChunkCount} loaded at ${x},${z}: ${details}`);
      if (loadedChunkCount <= 3 || loadedChunkCount % 25 === 0) socket.emit("viewerDiagnostics", { stage: "chunk", loaded: loadedChunkCount, x, z, details });
      socket.emit("loadChunk", { x, z, chunk });
    });
    viewerEmitter.on("unloadChunk", ({ x, z }: { x: number; z: number }) => {
      unloadedChunkCount += 1;
      events.log("info", "viewer", `POV chunk unloaded at ${x},${z} (total ${unloadedChunkCount})`);
      socket.emit("viewerDiagnostics", { stage: "unload", unloaded: unloadedChunkCount, x, z });
      socket.emit("unloadChunk", { x, z });
    });
    socket.on("mouseClick", (click: unknown) => viewerEmitter.emit("mouseClick", click));
    const worldView = new WorldView(target.world, 6, target.entity.position, viewerEmitter);
    const activeControls = new Set<"forward" | "back" | "left" | "right" | "jump" | "sneak" | "sprint">();
    let lastLookAt = 0;
    const releaseControls = () => {
      for (const control of activeControls) target.setControlState(control, false);
      activeControls.clear();
    };
    const sendHud = (): void => {
      const inventoryItem = (item: any) => item ? { name: item.name, displayName: item.displayName, count: item.count } : null;
      socket.emit("hud", {
        health: target.health,
        food: target.food,
        experience: target.experience?.level ?? 0,
        selectedSlot: target.quickBarSlot,
        heldItem: inventoryItem(target.heldItem),
        offhand: inventoryItem(target.inventory.slots[45]),
        armorItems: target.inventory.slots.slice(5, 9).map(inventoryItem),
        armor: target.inventory.slots.slice(5, 9).filter(Boolean).length,
        hotbar: target.inventory.slots.slice(36, 45).map(inventoryItem),
        inventory: target.inventory.slots.slice(9, 45).map(inventoryItem),
        username: target.username,
        players: Object.values(target.players).filter((player) => player?.username).map((player) => ({ username: player.username, ping: player.ping }))
      });
    };
    const sendPosition = () => {
      if (!target.entity?.position) return;
      socket.emit("position", { pos: target.entity.position, yaw: target.entity.yaw, pitch: target.entity.pitch });
      void worldView.updatePosition(target.entity.position);
    };
    worldView.listenToBot(target);
    try {
      await worldView.init(target.entity.position);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.log("error", "viewer", `POV chunk initialization failed: ${message}`);
      socket.emit("viewerDiagnostics", { stage: "error", message });
      socket.removeAllListeners("mouseClick");
      worldView.removeListenersFromBot(target);
      return;
    }
    const initializedChunks = Object.keys(worldView.loadedChunks ?? {}).length;
    events.log("info", "viewer", `POV chunk initialization complete: ${loadedChunkCount} sent, ${initializedChunks} loaded in WorldView`);
    socket.emit("viewerDiagnostics", { stage: "init", loaded: loadedChunkCount, initialized: initializedChunks, unloaded: unloadedChunkCount });
    sendPosition();
    sendHud();
    const hudInterval = setInterval(sendHud, 500);
    const sendChat = (message: string): void => { socket.emit("chatLine", String(message)); };
    target.on("move", sendPosition);
    target.on("health", sendHud);
    target.on("playerJoined", sendHud);
    target.on("playerLeft", sendHud);
    target.on("messagestr", sendChat);
    socket.on("botControl", (payload: { control?: unknown; enabled?: unknown }) => {
      const control = String(payload?.control ?? "") as "forward" | "back" | "left" | "right" | "jump" | "sneak" | "sprint";
      if (!["forward", "back", "left", "right", "jump", "sneak", "sprint"].includes(control)) return;
      const enabled = payload?.enabled === true;
      target.setControlState(control, enabled);
      if (enabled) activeControls.add(control); else activeControls.delete(control);
    });
    socket.on("botLook", (payload: { yaw?: unknown; pitch?: unknown }) => {
      const now = Date.now();
      if (now - lastLookAt < 25) return;
      const yaw = Number(payload?.yaw); const pitch = Number(payload?.pitch);
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
      lastLookAt = now;
      void target.look(yaw, Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)), true);
    });
    socket.on("botAction", async (payload: { action?: unknown; slot?: unknown }) => {
      const action = String(payload?.action ?? "");
      try {
        if (action === "attack") {
          const entity = target.entityAtCursor(5);
          if (entity) target.attack(entity); else {
            const block = target.blockAtCursor(5);
            if (block && target.canDigBlock(block)) await target.dig(block, "ignore"); else target.swingArm("right");
          }
        } else if (action === "use") {
          const block = target.blockAtCursor(5);
          if (block) await target.activateBlock(block); else target.activateItem();
        } else if (action === "hotbar") {
          const slot = Number(payload?.slot);
          if (Number.isInteger(slot) && slot >= 0 && slot <= 8) target.setQuickBarSlot(slot);
        }
      } catch (error) { socket.emit("controlError", (error as Error).message); }
    });
    socket.on("releaseControls", releaseControls);
    socket.on("disconnect", () => {
      releaseControls();
      target.removeListener("move", sendPosition);
      target.removeListener("health", sendHud);
      target.removeListener("playerJoined", sendHud);
      target.removeListener("playerLeft", sendHud);
      target.removeListener("messagestr", sendChat);
      clearInterval(hudInterval);
      socket.removeAllListeners("mouseClick");
      worldView.removeListenersFromBot(target);
    });
  });

  const port = options.port ?? Number(process.env.PORT || 3000);
  server.listen(port, options.host ?? "0.0.0.0", () => {
    const address = server.address();
    events.log("info", "server", `Dashboard running on port ${address && typeof address !== "string" ? address.port : port}`);
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
    return json(response, 200, { node: process.version, provider: "local", dataDirConfigured: Boolean(process.env.DATA_DIR), dataWritable, autoConnectAllowed: process.env.AUTO_CONNECT !== "false", sessionSecretConfigured: Boolean(process.env.SESSION_SECRET), encryptionKeyDedicated: Boolean(process.env.CONFIG_ENCRYPTION_KEY) });
  }
  if (request.url === "/api/settings" && request.method === "PUT") {
    const value = await config.update(await readJson(request));
    bot.applyConfig();
    return json(response, 200, { config: value });
  }
  if (request.url === "/api/webhook/test" && request.method === "POST") {
    const sent = await webhook.send("test", "Webhook test", "Remote Console Client (RCC) notifications are working.");
    return json(response, sent ? 200 : 400, sent ? { sent } : { sent, error: "Webhook is not configured or could not be reached" });
  }
  if (request.url === "/api/proxy/test" && request.method === "POST") {
    const { proxyId, serverId } = await readJson(request);
    const proxy = config.get().proxies.find((item) => item.id === proxyId);
    const target = config.get().servers.find((item) => item.id === serverId) ?? config.get().servers[0];
    if (!proxy || !target) throw new Error("Proxy or server profile is missing");
    const latencyMs = await testHttpProxy(proxy, target.host, target.port);
    return json(response, 200, { ok: true, latencyMs });
  }
  if (request.url === "/api/server/test" && request.method === "POST") {
    const { serverId } = await readJson(request);
    const target = config.get().servers.find((item) => item.id === serverId);
    if (!target) throw new Error("Server profile is missing");
    const latencyMs = await testTcpTarget(target.host, target.port);
    return json(response, 200, { ok: true, latencyMs });
  }
  if (request.url === "/api/emergency-stop" && request.method === "POST") {
    bot.stop();
    const current = config.get();
    const value = await config.update({ sell: { ...current.sell, enabled: false }, spawner: { ...current.spawner, enabled: false }, accounts: current.accounts.map((account) => ({ ...account, sell: account.sell ? { ...account.sell, enabled: false } : null, spawner: account.spawner ? { ...account.spawner, enabled: false } : null })) });
    bot.applyConfig();
    events.log("warn", "safety", "Emergency stop executed: bot disconnected and macros disabled");
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
    if (!current.accounts.some((account) => account.id === accountId)) throw new Error("Account not found");
    if (paused) bot.stop([accountId]);
    const value = await config.update({ accounts: current.accounts.map((account) => account.id === accountId ? { ...account, paused } : account) }); bot.applyConfig();
    return json(response, 200, { ok: true, config: value });
  }
  if (request.url === "/api/account" && request.method === "DELETE") {
    const body = await readJson(request); const accountId = String(body.accountId ?? "");
    const current = config.get(); if (current.accounts.length <= 1) throw new Error("The last account cannot be deleted");
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
      const order = spawner.orderEnabled ? [spawner.homeTopCommand, spawner.orderCommand, spawner.orderAutoDetect ? `Check bone orders on up to ${spawner.orderMaxPages} pages` : `Bone-order slot ${spawner.orderHighestSlot}`, `Deliver all bones (slot ${spawner.orderDeliverAllSlot}, ${spawner.orderMinDelayMs}-${spawner.orderMaxDelayMs} ms)`] : [];
      return { accountId: account.id, name: account.name, online: snapshot?.connection === "online", inventoryItems: snapshot?.inventory.length ?? 0, sell: [`Command ${sell.command}`, `Pause ${sell.minPauseMs}-${sell.maxPauseMs} ms`, `Schedule ${sell.scheduleStart}-${sell.scheduleEnd}`], spawner: [spawner.homeTopCommand, spawner.homeBottomCommand, `W → S → D (${spawner.movementStepMs} ms)`, "Right-click spawner", spawner.autoDetectSlots ? "Auto-detect GUI slots" : `Slots ${spawner.sellAllSlot}/${spawner.pageLeftSlot}/${spawner.pageRightSlot}/${spawner.dropAllSlot}`, spawner.arrowAbort ? "Check Arrow Guard" : "Arrow Guard disabled", ...order, spawner.afkHomeCommand] };
    });
    return json(response, 200, { plans });
  }
  json(response, 404, { error: "Not found" });
}

export function httpStatusForError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/Request too large|Request zu groß/i.test(message)) return 413;
  if (/Too many login attempts|Zu viele Loginversuche/i.test(message)) return 429;
  if (/not online|no selected account is online|paused|connection attempt is already running|accountId is required|no macro is running|nicht online|kein ausgewählter Account ist online|pausiert|Verbindungsaufbau läuft bereits|accountId ist erforderlich|läuft kein Makro/i.test(message)) return 409;
  if (error instanceof SyntaxError || /Invalid|missing|not found|not configured|last account|cannot be deleted|Ungültig|fehlt|nicht gefunden|nicht konfiguriert|letzte Account|kann nicht gelöscht/i.test(message)) return 400;
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
    if (size > 100_000) throw new Error("Request too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>;
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, publicDir: string): Promise<void> {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  const relative = pathname === "/" ? "index.html" : pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
  const file = normalize(join(publicDir, relative));
  if (!file.startsWith(normalize(publicDir))) return json(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not file");
    response.writeHead(200, { "Content-Type": contentTypes[extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

async function serveStaticPath(request: IncomingMessage, response: ServerResponse, root: string, relative: string): Promise<void> {
  const file = normalize(join(root, relative));
  if (!file.startsWith(normalize(root))) return json(response, 403, { error: "Forbidden" });
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return json(response, 404, { error: "Not found" });
  response.statusCode = 200;
  response.setHeader("content-type", contentTypes[extname(file)] ?? "application/octet-stream");
  response.setHeader("vary", "Accept-Encoding");
  if (/\bgzip\b/.test(request.headers["accept-encoding"] ?? "") && [".js", ".json"].includes(extname(file))) {
    response.setHeader("content-encoding", "gzip");
    createReadStream(file).pipe(createGzip({ level: 6 })).pipe(response);
  } else createReadStream(file).pipe(response);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' wss: ws:; style-src 'self'; script-src 'self'");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
