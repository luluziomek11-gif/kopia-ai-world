import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { OllamaProvider } from './providers.js';
import { Simulation } from './simulation.js';
import { WorldStore } from './store.js';
import { clientMessageSchema } from './validation.js';
import type { ServerMessage } from '../shared/types.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const localOnly = ['127.0.0.1', 'localhost', '::1'].includes(host);
const token = process.env.WORLD_TOKEN ?? '';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Nieprawidłowy PORT.');
if (!localOnly && token.length < 24) throw new Error('Tryb LAN wymaga WORLD_TOKEN o długości co najmniej 24 znaków.');
const provider = new OllamaProvider(process.env.EDITH_MODEL ?? 'gemma3:4b', process.env.OLLAMA_URL);
const store = new WorldStore(resolve(root, process.env.WORLD_DB ?? 'data/world.sqlite'));
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, handleProtocols: protocols => protocols.has('ai-world') ? 'ai-world' : false });
function broadcast(message: ServerMessage): void {
  const json = JSON.stringify(message);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 1_000_000) client.send(json);
}
const ultronProvider = new OllamaProvider(process.env.ULTRON_MODEL ?? 'gpt-oss:20b', process.env.OLLAMA_URL);
const simulation = new Simulation(store, provider, broadcast, Math.max(10, Number(process.env.DECISION_INTERVAL_SECONDS) || 45), { ultron_001: ultronProvider }, 'edith_002');
const staticRoot = resolve(root, 'dist');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
function tokenMatches(candidate: string): boolean {
  if (!token) return true;
  const expected = Buffer.from(token); const supplied = Buffer.from(candidate);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function allowedHost(request: IncomingMessage): boolean {
  if (!localOnly) return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${request.headers.host}`).hostname); } catch { return false; }
}
function allowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const extra = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
  return [`http://${request.headers.host}`, `https://${request.headers.host}`, ...(localOnly ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []), ...extra].includes(origin);
}
function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body));
}
const server = createServer((request, response) => {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'");
  if (!allowedHost(request) || !allowedOrigin(request)) { json(response, 403, { error: 'Origin not allowed' }); return; }
  if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { error: 'Method not allowed' }); return; }
  let url: URL;
  try { url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`); }
  catch { json(response, 400, { error: 'Bad URL' }); return; }
  if (url.pathname === '/api/health') { json(response, 200, { app: 'ai-world', protocolVersion: 1, ok: true, ai: simulation.world.ai, agents: simulation.world.agents.map(a => ({ id: a.id, ai: a.ai })), clients: wss.clients.size }); return; }
  if (url.pathname === '/api/config') { json(response, 200, { provider: provider.name, model: provider.model, tokenRequired: Boolean(token), protocolVersion: 1 }); return; }
  if (url.pathname === '/api/history') {
    if (!tokenMatches(request.headers.authorization?.replace(/^Bearer /, '') ?? '')) { json(response, 401, { error: 'Authentication required' }); return; }
    json(response, 200, store.history(Number(url.searchParams.get('limit')) || 200, url.searchParams.get('agentId') ?? undefined)); return;
  }
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { json(response, 400, { error: 'Bad path' }); return; }
  const requested = resolve(staticRoot, `.${pathname}`);
  if (requested !== staticRoot && !requested.startsWith(staticRoot + sep)) { json(response, 403, { error: 'Forbidden' }); return; }
  const filename = existsSync(requested) && statSync(requested).isFile() ? requested : resolve(staticRoot, 'index.html');
  if (!existsSync(filename)) { json(response, 503, { error: 'Uruchom npm run dev lub najpierw npm run build.' }); return; }
  response.writeHead(200, { 'content-type': types[extname(filename)] ?? 'application/octet-stream', 'cache-control': filename.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
  if (request.method === 'HEAD') response.end(); else createReadStream(filename).pipe(response);
});
server.on('upgrade', (request, socket, head) => {
  const protocols = (request.headers['sec-websocket-protocol'] ?? '').split(',').map(s => s.trim());
  const supplied = protocols.find(p => p.startsWith('token.'))?.slice(6) ?? '';
  if (request.url !== '/ws' || !allowedHost(request) || !allowedOrigin(request) || !tokenMatches(supplied) || wss.clients.size >= 16) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});
wss.on('connection', ws => {
  const send = (message: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
  send({ type: 'state', world: simulation.world });
  let budget = 40; let last = Date.now(); let lastChat = 0;
  ws.on('message', (data, binary) => {
    const now = Date.now(); budget = Math.min(40, budget + (now - last) / 1000 * 20); last = now;
    if (binary || budget < 1) { ws.close(1008, 'Rate limit'); return; }
    budget -= 1;
    try {
      const parsed = clientMessageSchema.safeParse(JSON.parse(data.toString()));
      if (!parsed.success) { send({ type: 'error', message: 'Nieprawidłowa wiadomość klienta.' }); return; }
      if (parsed.data.type === 'chat') {
        if (now - lastChat < 1500) { send({ type: 'error', message: 'Poczekaj chwilę przed kolejną wiadomością.' }); return; }
        lastChat = now;
      }
      simulation.handle(parsed.data, send);
    } catch { send({ type: 'error', message: 'Nie udało się obsłużyć polecenia.' }); }
  });
  ws.on('error', () => { /* A broken client must not stop the shared world. */ });
});
let lastTick = performance.now();
const tick = setInterval(() => { const now = performance.now(); simulation.tick((now - lastTick) / 1000); lastTick = now; simulation.emit(); }, 200);
const autosave = setInterval(() => simulation.save(), 2000);
const health = setInterval(() => void simulation.checkHealth(), 30000);
let closing = false;
function shutdown(): void {
  if (closing) return; closing = true;
  clearInterval(tick); clearInterval(autosave); clearInterval(health);
  simulation.close(); for (const client of wss.clients) client.close(1001, 'Server stopping');
  wss.close(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
server.listen(port, host, () => {
  console.log(`AI World: http://${host}:${port} | ${provider.name}/${provider.model}`);
  void simulation.checkHealth();
});
