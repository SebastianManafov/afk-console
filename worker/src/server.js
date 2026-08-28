import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import mineflayer from 'mineflayer';
import { SocksClient } from 'socks';

const port = Number(process.env.PORT ?? 8788);
const apiToken = process.env.API_TOKEN ?? '';
if (apiToken.length < 32) throw new Error('API_TOKEN must contain at least 32 characters');

let bot = null;
let status = 'offline';
const logs = [];
const addLog = (text, tone) => { logs.push({ time: new Date().toISOString(), text: String(text).slice(0, 1000), tone }); if (logs.length > 250) logs.shift(); };
addLog('Proxy-Guard aktiv · direkte Minecraft-Sockets sind nicht implementiert', 'ok');

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

function safeConfig(input) {
  void input;
  const host = String(process.env.MINECRAFT_HOST ?? '').trim();
  const username = String(process.env.MINECRAFT_USERNAME ?? '').trim();
  const proxyHost = String(process.env.SOCKS5_HOST ?? '').trim();
  const serverPort = Number(process.env.MINECRAFT_PORT ?? 25565);
  const proxyPort = Number(process.env.SOCKS5_PORT);
  if (!host || !username || !proxyHost || !Number.isInteger(serverPort) || !Number.isInteger(proxyPort)) throw new Error('Server, Konto und SOCKS5-Proxy sind Pflicht');
  if (proxyPort < 1 || proxyPort > 65535 || serverPort < 1 || serverPort > 65535) throw new Error('Ungültiger Server- oder Proxy-Port');
  if (proxyHost === host && proxyPort === serverPort) throw new Error('Proxy und Spielserver dürfen nicht identisch sein');
  return { host, username, proxyHost, serverPort, proxyPort, proxyUsername: String(process.env.SOCKS5_USERNAME ?? ''), proxyPassword: String(process.env.SOCKS5_PASSWORD ?? '') };
}

async function connect(input) {
  if (bot) throw new Error('Eine Instanz läuft bereits');
  const cfg = safeConfig(input);
  status = 'connecting';
  addLog(`SOCKS5-Tunnel zu ${cfg.host}:${cfg.serverPort} wird aufgebaut`);
  bot = mineflayer.createBot({
    username: cfg.username,
    auth: 'microsoft',
    profilesFolder: process.env.AUTH_CACHE_DIR ?? '/home/node/.minecraft',
    onMsaCode: (code) => addLog(`Microsoft-Gerätecode: ${code.user_code} · ${code.verification_uri}`, 'ok'),
    fakeHost: cfg.host,
    // Security invariant: no host option and no net.connect fallback. The only socket comes from SOCKS5.
    connect: async (client) => {
      try {
        const result = await SocksClient.createConnection({
          proxy: { host: cfg.proxyHost, port: cfg.proxyPort, type: 5, userId: cfg.proxyUsername || undefined, password: cfg.proxyPassword || undefined },
          command: 'connect', destination: { host: cfg.host, port: cfg.serverPort }, timeout: 12_000,
        });
        client.setSocket(result.socket);
        client.emit('connect');
      } catch (error) {
        addLog(`Proxy-Verbindung fehlgeschlagen: ${error.message}`, 'warn');
        status = 'offline'; bot = null; client.end('Proxy required');
      }
    },
  });
  bot.once('spawn', () => { status = 'online'; addLog(`Online als ${bot.username}`, 'ok'); });
  bot.on('messagestr', (message) => addLog(message));
  bot.on('kicked', (reason) => addLog(`Gekickt: ${reason}`, 'warn'));
  bot.on('error', (error) => addLog(`Clientfehler: ${error.message}`, 'warn'));
  bot.on('end', (reason) => { addLog(`Verbindung beendet: ${reason}`); status = 'offline'; bot = null; });
}

const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.method === 'GET' && request.url === '/healthz') return response.end(JSON.stringify({ ok: true, service: 'hushcraft-worker', proxyOnly: true }));
  if (!authorized(request)) { response.writeHead(401); return response.end(JSON.stringify({ error: 'Unauthorized' })); }
  try {
    if (request.method === 'GET' && request.url === '/v1/status') return response.end(JSON.stringify({ status, logs, proxyOnly: true }));
    if (request.method === 'POST' && request.url === '/v1/connect') { await connect(await body(request)); response.writeHead(202); return response.end(JSON.stringify({ status })); }
    if (request.method === 'POST' && request.url === '/v1/disconnect') { bot?.quit('Dashboard disconnect'); return response.end(JSON.stringify({ status: 'disconnecting' })); }
    if (request.method === 'POST' && request.url === '/v1/chat') { const { message } = await body(request); if (!bot || status !== 'online') throw new Error('Client ist offline'); bot.chat(String(message).slice(0, 256)); return response.end(JSON.stringify({ sent: true })); }
    response.writeHead(404); response.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) { addLog(error.message, 'warn'); response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
});
server.listen(port, '0.0.0.0', () => addLog(`Worker API läuft auf Port ${port}`, 'ok'));
