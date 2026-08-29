import { timingSafeEqual, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView');
const viewerPublic = join(dirname(require.resolve('prismarine-viewer')), 'public');
const port = Number(process.env.PORT ?? 8080);
const apiToken = process.env.API_TOKEN ?? '';
if (apiToken.length < 32) throw new Error('API_TOKEN must contain at least 32 characters');

let bot = null;
let status = 'offline';
let lastError = '';
let targetOverride = null;
let intentionalStop = false;
let reconnectTimer = null;
let antiAfkTimer = null;
const logs = [];
const viewerTickets = new Map();
const viewerSessions = new Map();

const cleanText = (value) => String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/§[0-9a-fk-or]/gi, '').trim();
function addLog(text, tone) {
  const clean = cleanText(text);
  if (!clean) return;
  logs.push({ time: new Date().toISOString(), text: clean.slice(0, 1000), tone });
  if (logs.length > 400) logs.shift();
}
addLog('Proxy-Guard aktiv · Mineflayer besitzt ausschließlich einen SOCKS5-Verbindungspfad', 'ok');

function authorized(request) {
  const provided = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!provided || provided.length !== apiToken.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(apiToken));
}

function safeConfig() {
  const host = targetOverride?.host ?? String(process.env.MINECRAFT_HOST ?? '').trim();
  const serverPort = targetOverride?.port ?? Number(process.env.MINECRAFT_PORT ?? 25565);
  const username = String(process.env.MINECRAFT_USERNAME ?? '').trim();
  const proxyHost = String(process.env.SOCKS5_HOST ?? '').trim();
  const proxyPort = Number(process.env.SOCKS5_PORT);
  if (!host || !username || !proxyHost) throw new Error('Server, Konto und SOCKS5-Proxy sind Pflicht');
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535 || !Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) throw new Error('Ungültiger Server- oder Proxy-Port');
  if (proxyHost === host && proxyPort === serverPort) throw new Error('Proxy und Spielserver dürfen nicht identisch sein');
  return { host, serverPort, username, proxyHost, proxyPort, proxyUsername: String(process.env.SOCKS5_USERNAME ?? ''), proxyPassword: String(process.env.SOCKS5_PASSWORD ?? '') };
}

function parseServerTarget(input) {
  const value = String(input ?? '').trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, '$1$2');
  if (!value || value.length > 253 || /[\s/@\\]/.test(value)) throw new Error('Nutze: /joinserver "serverip" oder /joinserver "serverip:port"');
  const match = value.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!match) throw new Error('Ungültige Server-Adresse');
  const host = match[1].toLowerCase();
  const targetPort = Number(match[2] ?? 25565);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('Ungültiger Server-Port');
  const parts = host.split('.');
  const isIpv4 = parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (isIpv4) {
    const [a, b] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) throw new Error('Lokale/private Server-Adressen sind nicht erlaubt');
  } else if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) || host.endsWith('.local')) {
    throw new Error('Ungültiger öffentlicher Server-Hostname');
  }
  return { host, port: targetPort };
}

function worldPayload() {
  if (!bot?.entity || status !== 'online') return null;
  const position = bot.entity.position;
  const blocks = [];
  for (let z = -7; z <= 7; z += 1) {
    const row = [];
    for (let x = -7; x <= 7; x += 1) {
      let name = 'unknown';
      for (let y = 2; y >= -4; y -= 1) {
        const block = bot.blockAt(position.offset(x, y, z));
        if (block && block.name !== 'air' && block.name !== 'cave_air') { name = block.name; break; }
      }
      row.push(name);
    }
    blocks.push(row);
  }
  return {
    position: { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10, z: Math.round(position.z * 10) / 10 },
    health: bot.health ?? 0, food: bot.food ?? 0, yaw: bot.entity.yaw ?? 0,
    dimension: bot.game?.dimension ?? 'unknown',
    players: Object.keys(bot.players ?? {}).filter((name) => name !== bot.username),
    inventory: (bot.inventory?.slots ?? []).map((item, slot) => item ? { slot, name: item.name, displayName: item.displayName, count: item.count } : null),
    blocks,
  };
}

function statePayload() { return { status, logs, lastError, proxyOnly: true, engine: 'mineflayer', canSend: status === 'online', world: worldPayload() }; }
function clearRuntimeTimers() { clearTimeout(reconnectTimer); clearInterval(antiAfkTimer); reconnectTimer = null; antiAfkTimer = null; }
function scheduleReconnect(reason) {
  if (intentionalStop || reconnectTimer) return;
  status = 'offline';
  addLog(`Auto-Reconnect in 15 Sekunden${reason ? ` · ${cleanText(reason)}` : ''}`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, 15_000);
}
function stopBot({ reconnect = false } = {}) {
  clearRuntimeTimers();
  const active = bot;
  bot = null;
  status = 'offline';
  if (active) { try { active.quit('Dashboard disconnect'); } catch { try { active.end(); } catch { /* already closed */ } } }
  if (reconnect) scheduleReconnect();
}

async function connect() {
  if (bot) throw new Error('Eine Instanz läuft bereits');
  const cfg = safeConfig();
  intentionalStop = false;
  clearRuntimeTimers();
  status = 'connecting';
  lastError = '';
  const profilesFolder = process.env.AUTH_CACHE_DIR ?? '/home/node/.minecraft';
  mkdirSync(profilesFolder, { recursive: true });
  addLog(`Mineflayer ${process.env.MINECRAFT_VERSION?.trim() || '26.1'} startet · SOCKS5-Tunnel zu ${cfg.host}:${cfg.serverPort}`, 'ok');
  const instance = mineflayer.createBot({
    host: cfg.host, port: cfg.serverPort, username: cfg.username, auth: 'microsoft',
    version: process.env.MINECRAFT_VERSION?.trim() || '26.1', profilesFolder, viewDistance: 'tiny',
    onMsaCode: (data) => addLog(`Microsoft-Gerätecode: ${data.user_code} · ${data.verification_uri}`, 'ok'),
    connect: (client) => {
      SocksClient.createConnection({
        proxy: { host: cfg.proxyHost, port: cfg.proxyPort, type: 5, userId: cfg.proxyUsername || undefined, password: cfg.proxyPassword || undefined },
        command: 'connect', destination: { host: cfg.host, port: cfg.serverPort }, timeout: 20_000,
      }).then(({ socket }) => {
        socket.setNoDelay(true); socket.setKeepAlive(true, 10_000); client.setSocket(socket); client.emit('connect');
      }).catch((error) => {
        lastError = `SOCKS5 fehlgeschlagen: ${error.message}`;
        addLog(`${lastError} · Direktverbindung blockiert`, 'warn');
        client.emit('error', error); client.emit('end', 'proxyError');
      });
    },
  });
  bot = instance;
  instance.once('spawn', () => {
    if (bot !== instance) return;
    status = 'online'; lastError = ''; addLog(`Server erfolgreich betreten als ${instance.username}`, 'ok');
    antiAfkTimer = setInterval(() => { if (bot === instance && status === 'online') { try { instance.swingArm('right'); } catch { /* retry */ } } }, 30_000);
  });
  instance.on('messagestr', (message) => addLog(message));
  instance.on('kicked', (reason) => { lastError = cleanText(reason); addLog(`Vom Server getrennt: ${lastError}`, 'warn'); });
  instance.on('error', (error) => { lastError = cleanText(error.message); addLog(`Clientfehler: ${lastError}`, 'warn'); });
  instance.once('end', (reason) => {
    if (bot === instance) bot = null;
    clearInterval(antiAfkTimer); antiAfkTimer = null; status = 'offline';
    addLog(`Mineflayer beendet${reason ? ` · ${cleanText(reason)}` : ''}`); scheduleReconnect(reason);
  });
}

async function joinServer(target) {
  targetOverride = parseServerTarget(target); intentionalStop = true; stopBot();
  await new Promise((resolve) => setTimeout(resolve, 500));
  addLog(`Neues Ziel: ${targetOverride.host}:${targetOverride.port} · ausschließlich SOCKS5`, 'ok');
  await connect();
}
function sendChat(message) {
  if (!bot || status !== 'online') throw new Error('Client ist offline');
  const clean = String(message ?? '').replace(/[\r\n]/g, '').trim().slice(0, 256);
  if (!clean) throw new Error('Nachricht fehlt');
  bot.chat(clean);
}
function control(action) {
  if (!bot || status !== 'online') throw new Error('Client ist offline');
  const controlName = { forward: 'forward', back: 'back', left: 'left', right: 'right', jump: 'jump', sneak: 'sneak' }[action];
  if (!controlName) throw new Error('Unbekannte Steuerung');
  bot.setControlState(controlName, true);
  setTimeout(() => { if (bot) bot.setControlState(controlName, false); }, controlName === 'jump' ? 350 : 650);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
const httpServer = app.listen(port, '0.0.0.0', () => addLog(`Worker API + Live-Viewer laufen auf Port ${port}`, 'ok'));
const viewerIo = new SocketIOServer(httpServer, { path: '/viewer/socket.io', serveClient: false });
function parseCookies(raw) { return Object.fromEntries(String(raw ?? '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value)); }
function pruneViewerAuth() {
  const now = Date.now();
  for (const [key, expiry] of viewerTickets) if (expiry < now) viewerTickets.delete(key);
  for (const [key, expiry] of viewerSessions) if (expiry < now) viewerSessions.delete(key);
}
app.get('/viewer/', (request, response, next) => {
  pruneViewerAuth();
  const ticket = String(request.query.ticket ?? '');
  if (!ticket) return next();
  if (!viewerTickets.has(ticket)) return response.status(401).send('Viewer-Ticket ungültig oder abgelaufen');
  viewerTickets.delete(ticket);
  const session = randomBytes(24).toString('base64url');
  viewerSessions.set(session, Date.now() + 30 * 60_000);
  response.setHeader('set-cookie', `viewer_session=${session}; Max-Age=1800; Path=/viewer; HttpOnly; Secure; SameSite=None; Partitioned`);
  return response.redirect('/viewer/');
});
app.use('/viewer', express.static(viewerPublic, { index: 'index.html', maxAge: '1h' }));
viewerIo.use((socket, next) => {
  pruneViewerAuth();
  const session = parseCookies(socket.handshake.headers.cookie).viewer_session;
  if (!session || !viewerSessions.has(session)) return next(new Error('Viewer nicht autorisiert'));
  next();
});
viewerIo.on('connection', (socket) => {
  const active = bot;
  if (!active?.entity || status !== 'online') { socket.emit('viewerError', 'Bot ist offline'); return socket.disconnect(true); }
  // prismarine-viewer's published browser assets currently stop at 1.21.4.
  // Keep the live stream usable for newer Mineflayer protocols until the
  // matching viewer assets are released; chunks and entity positions remain
  // live and the browser never receives an unsupported version string.
  const viewerVersion = ['1.8.8', '1.9.4', '1.10.2', '1.11.2', '1.12.2', '1.13.2', '1.14.4', '1.15.2', '1.16.1', '1.16.4', '1.17.1', '1.18.1', '1.19', '1.20.1', '1.21.1', '1.21.4'].includes(active.version) ? active.version : '1.21.4';
  socket.emit('version', viewerVersion);
  if (viewerVersion !== active.version) socket.emit('viewerNotice', `Viewer-Kompatibilitätsmodus: ${viewerVersion} (Client: ${active.version})`);
  const worldView = new WorldView(active.world, 4, active.entity.position, socket);
  worldView.init(active.entity.position);
  const position = () => { if (active.entity) { socket.emit('position', { pos: active.entity.position, yaw: active.entity.yaw, pitch: active.entity.pitch, addMesh: true }); worldView.updatePosition(active.entity.position); } };
  active.on('move', position); worldView.listenToBot(active);
  socket.on('disconnect', () => { active.removeListener('move', position); worldView.removeListenersFromBot(active); });
});

app.get('/healthz', (_request, response) => response.json({ ok: true, service: 'hushcraft-worker', release: '1.0', engine: 'mineflayer', minecraft: process.env.MINECRAFT_VERSION?.trim() || '26.1', proxyOnly: true, liveViewer: true, controls: ['join', 'joinserver', 'disconnect', 'restart', 'chat', 'movement', 'inventory', 'viewer'] }));
app.use('/v1', (request, response, next) => authorized(request) ? next() : response.status(401).json({ error: 'Unauthorized' }));
app.get('/v1/status', (_request, response) => response.json(statePayload()));
app.get('/v1/events', (request, response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const publish = () => response.write(`data: ${JSON.stringify(statePayload())}\n\n`);
  publish(); const timer = setInterval(publish, 250); request.on('close', () => clearInterval(timer));
});
app.post('/v1/viewer-ticket', (request, response) => {
  if (status !== 'online') return response.status(409).json({ error: 'Bot ist offline' });
  pruneViewerAuth(); const ticket = randomBytes(24).toString('base64url'); viewerTickets.set(ticket, Date.now() + 60_000);
  const base = String(process.env.PUBLIC_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
  response.json({ url: `${base}/viewer/?ticket=${encodeURIComponent(ticket)}`, expiresIn: 60 });
});
app.post('/v1/connect', async (_request, response, next) => { try { await connect(); response.status(202).json({ status }); } catch (error) { next(error); } });
app.post('/v1/join', async (_request, response, next) => { try { await connect(); response.status(202).json({ status }); } catch (error) { next(error); } });
app.post('/v1/disconnect', (_request, response) => { intentionalStop = true; stopBot(); response.json({ status }); });
app.post('/v1/restart', async (_request, response, next) => { try { intentionalStop = true; stopBot(); await new Promise((resolve) => setTimeout(resolve, 500)); await connect(); response.status(202).json({ status }); } catch (error) { next(error); } });
app.post('/v1/chat', async (request, response, next) => { try { const message = String(request.body?.message ?? '').trim(); const joinCommand = message.match(/^\/joinserver\s+(.+)$/i); if (joinCommand) await joinServer(joinCommand[1]); else sendChat(message); response.status(joinCommand ? 202 : 200).json({ sent: true, status }); } catch (error) { next(error); } });
app.post('/v1/control', (request, response, next) => { try { control(request.body?.action); response.json({ sent: true }); } catch (error) { next(error); } });
app.use((error, _request, response, next) => { void next; lastError = cleanText(error.message); addLog(lastError, 'warn'); response.status(400).json({ error: lastError }); });
