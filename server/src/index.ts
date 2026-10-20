import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import { uid } from '@velvet/shared';
import type { ClientMsg, ServerMsg } from '@velvet/shared';
import { Hub } from './hub.js';
import type { Room } from './room.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));

const hub = new Hub();

/* ------------------------------------------------------------------ */
/* static (production build)                                           */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const LANDING = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VELVET — table server</title>
<style>
 html,body{height:100%;margin:0;background:#06060c;color:#e9e9f5;font:500 15px/1.6 ui-sans-serif,system-ui,sans-serif}
 .wrap{height:100%;display:grid;place-items:center;padding:24px}
 .card{max-width:34rem;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:28px 30px;
   background:linear-gradient(160deg,rgba(255,62,165,.10),rgba(34,211,238,.08));backdrop-filter:blur(10px)}
 h1{margin:0 0 6px;font-size:30px;letter-spacing:.22em}
 code{background:rgba(255,255,255,.08);padding:2px 7px;border-radius:6px}
 a{color:#7df3ff}
 .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22e08a;box-shadow:0 0 12px #22e08a;margin-right:8px}
</style><div class="wrap"><div class="card">
<h1>VELVET</h1>
<p><span class="dot"></span>Table server online — ${hub.size} rooms warming up.</p>
<p>The client is built separately. Run <code>npm run dev</code> for the live table, or
<code>npm run build &amp;&amp; npm start</code> to serve the production bundle from this port.</p>
<p>WebSocket endpoint: <code>/ws</code> · health: <a href="/healthz">/healthz</a></p>
</div></div>`;

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz' || url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: hub.size, players: hub.playerCount, uptime: process.uptime() }));
    return;
  }
  let indexExists = true;
  try { await stat(join(DIST, 'index.html')); } catch { indexExists = false; }
  if (!indexExists) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(LANDING);
    return;
  }
  const rel = normalize(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end('nope'); return; }
  try {
    const s = await stat(file);
    if (s.isDirectory()) throw new Error('dir');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(body);
  } catch {
    // SPA fallback
    const body = await readFile(join(DIST, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(body);
  }
}

const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  void serveStatic(req, res);
});

/* ------------------------------------------------------------------ */
/* websocket table protocol                                            */
/* ------------------------------------------------------------------ */

interface Conn {
  id: string;
  ws: WebSocket;
  room: Room | null;
  alive: boolean;
  personId: string | null;
  token: string | null;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const conns = new Map<string, Conn>();

function send(conn: Conn, msg: ServerMsg): void {
  if (conn.ws.readyState !== WebSocket.OPEN) return;
  try { conn.ws.send(JSON.stringify(msg)); } catch { /* drop */ }
}

wss.on('connection', (ws, req) => {
  const conn: Conn = { id: uid('s'), ws, room: null, alive: true, personId: null, token: null };
  conns.set(conn.id, conn);
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').toString();
  console.log(`[velvet] socket ${conn.id} from ${ip} · ${conns.size} live`);

  ws.on('pong', () => { conn.alive = true; });

  ws.on('message', (raw: RawData) => {
    conn.alive = true;
    let msg: ClientMsg;
    try { msg = JSON.parse(raw.toString()) as ClientMsg; } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    try { route(conn, msg); } catch (err) {
      console.error('[velvet] handler error', err);
      send(conn, { type: 'error', code: 'internal', message: 'table hiccup' });
    }
  });

  ws.on('close', () => {
    if (conn.room) conn.room.host.detach(conn.id, { permanent: true });
    conns.delete(conn.id);
    console.log(`[velvet] socket ${conn.id} closed · ${conns.size} live`);
  });
  ws.on('error', () => { /* handled by close */ });

  send(conn, { type: 'welcome', you: conn.id, token: conn.token ?? '', serverTime: Date.now(), rooms: hub.summaries() });
});

function detachFromRoom(conn: Conn): void {
  if (!conn.room) return;
  const room = conn.room;
  room.host.detach(conn.id, { permanent: false });
  conn.room = null;
}

function joinRoom(conn: Conn, room: Room, identity: { name: string; hue: number; token?: string | null; seat?: number | null }): void {
  if (conn.room === room) return;
  detachFromRoom(conn);
  conn.room = room;
  const session = { id: conn.id, send: (m: ServerMsg) => send(conn, m) };
  const res = room.host.attach(session, { name: identity.name, hue: identity.hue, token: identity.token ?? null });
  conn.personId = res.personId;
  conn.token = res.token;
  send(conn, { type: 'joined', roomId: room.meta.roomId, you: res.personId, seat: res.seat, token: res.token });
  room.host.push();
  if (identity.seat !== null && identity.seat !== undefined && res.seat === null) {
    room.host.handle(conn.id, { type: 'sit', seat: identity.seat });
  }
}

function route(conn: Conn, msg: ClientMsg): void {
  switch (msg.type) {
    case 'hello': {
      conn.token = msg.token ?? null;
      send(conn, { type: 'welcome', you: conn.id, token: conn.token ?? '', serverTime: Date.now(), rooms: hub.summaries() });
      return;
    }
    case 'listRooms': {
      send(conn, { type: 'rooms', rooms: hub.summaries() });
      return;
    }
    case 'createRoom': {
      const accent = Math.floor(Math.random() * 360);
      const room = hub.createRoom({
        name: msg.name || 'PRIVATE TABLE',
        isPrivate: msg.private,
        accent,
        rules: msg.rules ?? {},
        bots: 2,
        tagline: msg.private ? 'Private table — share the code' : 'Open floor',
      });
      send(conn, { type: 'rooms', rooms: hub.summaries() });
      joinRoom(conn, room, {
        name: msg.playerName?.trim() || 'Host',
        hue: msg.hue ?? accent,
        token: conn.token,
        seat: 0,
      });
      return;
    }
    case 'join': {
      const p = msg.payload;
      let room: Room | undefined;
      if (p.roomId) room = hub.get(p.roomId);
      if (!room && p.code) room = hub.byRoomCode(p.code);
      if (!room) room = hub.defaultRoom();
      joinRoom(conn, room, { name: p.name, hue: p.hue, token: p.token, seat: p.seat ?? null });
      send(conn, { type: 'rooms', rooms: hub.summaries() });
      return;
    }
    default:
      if (conn.room) conn.room.host.handle(conn.id, msg);
      else send(conn, { type: 'error', code: 'no-room', message: 'join a table first' });
  }
}

/* ------------------------------------------------------------------ */
/* housekeeping                                                        */
/* ------------------------------------------------------------------ */

setInterval(() => {
  for (const conn of conns.values()) {
    if (!conn.alive) { conn.ws.terminate(); continue; }
    conn.alive = false;
    try { conn.ws.ping(); } catch { /* gone */ }
  }
  hub.reap();
}, 25_000).unref?.();

server.listen(PORT, HOST, () => {
  console.log(`\n  ♠  VELVET table server`);
  console.log(`     ws   → ws://${HOST}:${PORT}/ws`);
  console.log(`     http → http://${HOST}:${PORT}/healthz`);
  console.log(`     rooms: ${hub.summaries().map((r) => `${r.name} [${r.code}]`).join(', ')}\n`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
