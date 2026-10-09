import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadDb, saveDb } from './db.js';
import { Game } from './game.js';
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
});
regLife(game); regFinance(game); regWork(game); regSocial(game); regTransport(game);

const app = express();
app.use(express.json({ limit: '64kb' }));

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
  game.presence.set(u.id, { p: [0, 0, 0], r: 0, a: 'idle', z: 'home:' + u.id, look: u.look, t: Date.now() });
  u.lastZone = 'home:' + u.id;
  u.lastActive = Date.now();
  if (u.driver.onDuty) u.driver.onDuty = false;

  ws.send(JSON.stringify({
    t: 'init',
    me: game.snapshot(u),
    tokens: game.market.list(),
    news: db.news.slice(0, 40),
    clock: game.clock(),
    trending: game.market.mods.trending,
  }));

  ws.on('message', (raw) => {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.t === 'pos') {
      const p = game.presence.get(u.id);
      if (!p) return;
      const v = msg.p as Vec3;
      if (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))) p.p = [v[0], v[1], v[2]];
      p.r = Number(msg.r) || 0;
      p.a = String(msg.a ?? 'idle').slice(0, 16);
      p.veh = msg.veh && typeof msg.veh === 'object' ? { model: String(msg.veh.model).slice(0, 16), color: String(msg.veh.color).slice(0, 9), rims: String(msg.veh.rims).slice(0, 8) } : undefined;
      p.mu = msg.mu && Number.isFinite(msg.mu.track) ? { track: Number(msg.mu.track), t0: Number(msg.mu.t0) } : null;
      p.look = u.look;
      p.t = Date.now();
      u.lastPos = p.p;
      return;
    }
    if (msg.t === 'act') {
      let reply: any;
      try {
        const d = game.handle(u, String(msg.a), msg.d);
        reply = { t: 'res', id: msg.id, ok: true, d };
      } catch (e) {
        if (!(e instanceof GameError)) console.error('action error', msg.a, e);
        reply = { t: 'res', id: msg.id, ok: false, e: e instanceof GameError ? e.message : 'Server error' };
      }
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(reply));
    }
  });

  ws.on('close', () => {
    if (sockets.get(u.id) === ws) {
      sockets.delete(u.id);
      game.presence.delete(u.id);
      u.driver.onDuty = false;
      u.lastActive = Date.now();
    }
  });
});

startWorld(game, db, () => saveDb(db));
const shutdown = () => { saveDb(db); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Crypto City server on http://localhost:${PORT}`));
