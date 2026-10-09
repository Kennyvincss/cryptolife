import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadDb, saveDb } from './db.js';
import { Game } from './game.js';
import { nodeHasher } from './auth-node.js';
import { GameError } from './util.js';
import { register as regLife } from './actions/life.js';
import { register as regFinance } from './actions/finance.js';
import { register as regWork } from './actions/work.js';
import { register as regSocial } from './actions/social.js';
import { register as regTransport } from './actions/transport.js';
import { startWorld } from './world.js';
import type { Vec3 } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 8787);
const db = loadDb();
const sockets = new Map<string, WebSocket>();

const game = new Game(db, {
  send(id, msg) {
    const ws = sockets.get(id);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  },
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(s);
  },
}, nodeHasher);
regLife(game); regFinance(game); regWork(game); regSocial(game); regTransport(game);

const app = express();
app.use(express.json({ limit: '64kb' }));
// allow a client hosted elsewhere (e.g. a static Vercel deploy) to reach this server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CC_ALLOW_ORIGIN ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

function wrap(fn: (body: any) => unknown) {
  return (req: express.Request, res: express.Response) => {
    try { res.json({ ok: true, ...(fn(req.body ?? {}) as object) }); }
    catch (e) { res.status(400).json({ ok: false, error: e instanceof GameError ? e.message : 'Server error' }); if (!(e instanceof GameError)) console.error(e); }
  };
}
app.post('/api/register', wrap((b) => game.register(b.username, b.password)));
app.post('/api/login', wrap((b) => game.login(b.username, b.password)));
app.get('/api/health', (_req, res) => { res.json({ ok: true, online: game.presence.size, residents: Object.keys(db.users).length }); });

const dist = path.join(process.cwd(), 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', 'http://x');
  const u = game.auth(url.searchParams.get('token') ?? '');
  if (!u) { ws.send(JSON.stringify({ t: 'error', error: 'auth' })); ws.close(); return; }
  const prev = sockets.get(u.id);
  if (prev && prev !== ws) { prev.send(JSON.stringify({ t: 'error', error: 'Signed in from another tab' })); prev.close(); }
  sockets.set(u.id, ws);
  ws.send(JSON.stringify(game.onConnect(u)));

  ws.on('message', (raw) => {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.t === 'pos') game.onPos(u, msg);
    else if (msg.t === 'act') {
      const reply = game.onAct(u, msg);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(reply));
    }
  });

  ws.on('close', () => {
    if (sockets.get(u.id) === ws) {
      sockets.delete(u.id);
      game.onDisconnect(u);
    }
  });
});

startWorld(game, db, () => saveDb(db));
const shutdown = () => { saveDb(db); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Crypto City server on http://localhost:${PORT}`));
