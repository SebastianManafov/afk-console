import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.env.PORT ?? 8788);
const apiToken = process.env.API_TOKEN ?? '';
if (apiToken.length < 32) throw new Error('API_TOKEN must contain at least 32 characters');

let client = null;
let status = 'offline';
let lastError = '';
let targetOverride = null;
let failureTimer = null;
const logs = [];
function statePayload() { return { status, logs, lastError, proxyOnly: true, engine: 'mcc', canSend: status === 'online', world: null }; }
const addLog = (text, tone) => {
  const clean = String(text).replace(/\x1b\[[0-9;]*m/g, '').replace(/§[0-9a-fk-or]/gi, '').trim();
  if (!clean) return;
  logs.push({ time: new Date().toISOString(), text: clean.slice(0, 1000), tone });
  if (logs.length > 300) logs.shift();
};
addLog('Proxy-Guard aktiv · MCC darf Minecraft nur über SOCKS5 erreichen', 'ok');

function authorized(request) {
  const provided = (request.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!provided || provided.length !== apiToken.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(apiToken));
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 32_768) throw new Error('Request too large'); }
  return raw ? JSON.parse(raw) : {};
}

function safeConfig() {
  const host = targetOverride?.host ?? String(process.env.MINECRAFT_HOST ?? '').trim();
  const username = String(process.env.MINECRAFT_USERNAME ?? '').trim();
  const proxyHost = String(process.env.SOCKS5_HOST ?? '').trim();
  const serverPort = targetOverride?.port ?? Number(process.env.MINECRAFT_PORT ?? 25565);
  const proxyPort = Number(process.env.SOCKS5_PORT);
  if (!host || !username || !proxyHost || !Number.isInteger(serverPort) || !Number.isInteger(proxyPort)) throw new Error('Server, Konto und SOCKS5-Proxy sind Pflicht');
  if (proxyPort < 1 || proxyPort > 65535 || serverPort < 1 || serverPort > 65535) throw new Error('Ungültiger Server- oder Proxy-Port');
  if (proxyHost === host && proxyPort === serverPort) throw new Error('Proxy und Spielserver dürfen nicht identisch sein');
  return { host, username, proxyHost, serverPort, proxyPort, proxyUsername: String(process.env.SOCKS5_USERNAME ?? ''), proxyPassword: String(process.env.SOCKS5_PASSWORD ?? '') };
}

function parseServerTarget(input) {
  const value = String(input ?? '').trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, '$1$2');
  if (!value || value.length > 253 || /[\s/@\\]/.test(value)) throw new Error('Nutze: /joinserver "serverip" oder /joinserver "serverip:port"');
  const match = value.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!match) throw new Error('Ungültige Server-Adresse');
  const host = match[1].toLowerCase();
  const parsedPort = Number(match[2] ?? 25565);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) throw new Error('Ungültiger Server-Port');
  const parts = host.split('.');
  const isIpv4 = parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (isIpv4) {
    const [a, b] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) throw new Error('Lokale/private Server-Adressen sind nicht erlaubt');
  } else if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) || host.endsWith('.local')) {
    throw new Error('Ungültiger öffentlicher Server-Hostname');
  }
  return { host, port: parsedPort };
}

const q = (value) => JSON.stringify(String(value));
function createMccConfig(cfg, directory) {
  const configPath = join(directory, 'MinecraftClient.ini');
  const config = `[Main.General]
Account = { Login = ${q(cfg.username)}, Password = "" }
Server = { Host = ${q(cfg.host)}, Port = ${cfg.serverPort} }
AccountType = "microsoft"
Method = "mcc"

[Main.Advanced]
Language = "en_us"
MinecraftVersion = ${q(process.env.MINECRAFT_VERSION?.trim() || '26.1')}
TerrainAndMovements = true
EntityHandling = true
InventoryHandling = true
ExitOnFailure = false
SessionCache = "disk"
ProfileKeyCache = "disk"
EnableSentry = false
ShowGithubStarReminder = false

[Proxy]
Enabled_Update = false
Enabled_Login = true
Enabled_Ingame = true
Server = { Host = ${q(cfg.proxyHost)}, Port = ${cfg.proxyPort} }
Proxy_Type = "SOCKS5"
Username = ${q(cfg.proxyUsername)}
Password = ${q(cfg.proxyPassword)}

[Console.General]
ConsoleMode = "classic"
ConsoleColorMode = "disable"
Display_Icon_Banner = false
Display_Input = false
Display_Chat = true

[Console.CommandSuggestion]
Enable = false

[MCSettings]
Enabled = true
ChatMode = "enabled"
`;
  writeFileSync(configPath, config, { mode: 0o600 });
  return configPath;
}

function handleOutput(chunk) {
  for (const rawLine of String(chunk).split(/\r?\n/)) {
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '').replace(/§[0-9a-fk-or]/gi, '').trim();
    if (!line) continue;
    if (/Server was successfully joined|Type '\/quit' to leave the server/i.test(line)) { status = 'online'; lastError = ''; }
    if (/Du bist bereits auf HugoSMP/i.test(line)) {
      lastError = 'Das Konto ist bereits auf HugoSMP aktiv. Trenne den anderen Client und warte kurz.';
      addLog(lastError, 'warn');
    }
    if (/Disconnected by Server|Login failed|Failed to login|Not connected to any server|Connection has been lost|SocketException|error occured when attempting to join/i.test(line)) {
      status = 'offline';
      if (/Connection has been lost|SocketException|aborted|failed/i.test(line)) lastError = line;
      if (!failureTimer && client) {
        const failedClient = client;
        failureTimer = setTimeout(() => {
          failureTimer = null;
          if (client === failedClient && !failedClient.killed) {
            addLog('Fehlgeschlagene MCC-Instanz automatisch beendet · bereit für neuen Join', 'ok');
            failedClient.kill('SIGTERM');
          }
        }, 350);
      }
    }
    const device = line.match(/(?:code|Code)[: ]+([A-Z0-9]{6,12})/);
    const link = line.match(/https:\/\/www\.microsoft\.com\/link/i);
    if (device || link || /device code|authentication/i.test(line)) addLog(line, 'ok'); else addLog(line);
  }
}

async function connect() {
  if (client) throw new Error('Eine Instanz läuft bereits');
  const cfg = safeConfig();
  const directory = process.env.AUTH_CACHE_DIR ?? '/home/node/.minecraft';
  mkdirSync(directory, { recursive: true });
  const configPath = createMccConfig(cfg, directory);
  status = 'connecting';
  lastError = '';
  addLog(`MCC 26.1 startet · SOCKS5-Tunnel zu ${cfg.host}:${cfg.serverPort}`, 'ok');
  const executable = process.env.MCC_EXECUTABLE ?? '/opt/mcc/MinecraftClient';
  const processHandle = spawn(executable, [configPath, 'BasicIO-NoColor'], { cwd: directory, env: { ...process.env, HOME: directory, MCC_HEADLESS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  client = processHandle;
  processHandle.stdout.on('data', handleOutput);
  processHandle.stderr.on('data', (chunk) => handleOutput(chunk));
  processHandle.on('error', (error) => { addLog(`MCC konnte nicht starten: ${error.message}`, 'warn'); status = 'offline'; if (client === processHandle) client = null; });
  processHandle.on('exit', (code, signal) => { addLog(`MCC beendet (${signal ?? code ?? 'unbekannt'})`); status = 'offline'; if (client === processHandle) client = null; });
}

async function joinServer(targetText) {
  const nextTarget = parseServerTarget(targetText);
  const active = client;
  if (active) {
    try { if (active.stdin?.writable) active.stdin.write('/quit\n'); } catch { /* force-stop below */ }
    active.kill('SIGTERM');
    if (client === active) client = null;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  targetOverride = nextTarget;
  addLog(`Neues Ziel gesetzt: ${nextTarget.host}:${nextTarget.port} · Verbindung ausschließlich über SOCKS5`, 'ok');
  await connect();
}

function sendLine(line) {
  if (!client?.stdin?.writable) throw new Error('Client ist offline');
  client.stdin.write(`${String(line).replace(/[\r\n]/g, '').slice(0, 256)}\n`);
}

function disconnect() {
  if (!client) return;
  status = 'disconnecting';
  sendLine('/quit');
  const active = client;
  setTimeout(() => { if (client === active && !active.killed) active.kill('SIGTERM'); }, 5000);
}

async function restart() {
  const active = client;
  if (active) {
    try { if (active.stdin?.writable) active.stdin.write('/quit\n'); } catch { /* force-stop below */ }
    active.kill('SIGTERM');
    if (client === active) client = null;
  }
  status = 'offline';
  await new Promise((resolve) => setTimeout(resolve, 600));
  await connect();
}

const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.method === 'GET' && request.url === '/healthz') return response.end(JSON.stringify({ ok: true, service: 'hushcraft-worker', release: '0.4', engine: 'mcc', protocol: 775, proxyOnly: true, controls: ['join', 'joinserver', 'disconnect', 'restart', 'chat'] }));
  if (!authorized(request)) { response.writeHead(401); return response.end(JSON.stringify({ error: 'Unauthorized' })); }
  try {
    if (request.method === 'GET' && request.url === '/v1/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const publish = () => response.write(`data: ${JSON.stringify(statePayload())}\n\n`);
      publish();
      const timer = setInterval(publish, 250);
      request.on('close', () => clearInterval(timer));
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/status') return response.end(JSON.stringify(statePayload()));
    if (request.method === 'POST' && request.url === '/v1/connect') { await connect(); response.writeHead(202); return response.end(JSON.stringify({ status })); }
    if (request.method === 'POST' && request.url === '/v1/join') { await connect(); response.writeHead(202); return response.end(JSON.stringify({ status })); }
    if (request.method === 'POST' && request.url === '/v1/disconnect') { disconnect(); return response.end(JSON.stringify({ status })); }
    if (request.method === 'POST' && request.url === '/v1/restart') { await restart(); response.writeHead(202); return response.end(JSON.stringify({ status })); }
    if (request.method === 'POST' && request.url === '/v1/chat') {
      const { message } = await body(request);
      const joinCommand = String(message ?? '').trim().match(/^\/joinserver\s+(.+)$/i);
      if (joinCommand) { await joinServer(joinCommand[1]); response.writeHead(202); return response.end(JSON.stringify({ sent: true, status })); }
      if (status !== 'online') throw new Error('Offline ist nur /joinserver "serverip" verfügbar');
      sendLine(message);
      return response.end(JSON.stringify({ sent: true }));
    }
    if (request.method === 'POST' && request.url === '/v1/control') { throw new Error('Bewegungssteuerung ist mit MCC 26.1 noch nicht verfügbar'); }
    response.writeHead(404); return response.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) { addLog(error.message, 'warn'); response.writeHead(400); return response.end(JSON.stringify({ error: error.message })); }
});
server.listen(port, '0.0.0.0', () => addLog(`Worker API läuft auf Port ${port}`, 'ok'));
