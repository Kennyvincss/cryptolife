// WebSocket client. All economic actions go through `act()` and are decided by the server.

import type { PresenceEntry } from '../../shared/types.js';
import { emit, store } from '../state.js';

let ws: WebSocket | null = null;
let seq = 1;
const pending = new Map<number, { res: (d: any) => void; rej: (e: Error) => void }>();
let token = '';
let reconnectTimer = 0;
let lastMeKey = '';

// Where the game server lives. Empty = same origin (npm run dev / npm start).
// For a static deploy (Vercel) set VITE_SERVER_URL=https://your-game-server.example.com
const SERVER = String(import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');

export const tokenKey = () => 'cc_token_' + netMode;

export type NetMode = 'online' | 'local';
export let netMode: NetMode = 'online';
let local: typeof import('./local.js') | null = null;

/** Online if a game server answers, otherwise the in-browser single-player engine. */
export async function detectMode(): Promise<NetMode> {
  if (new URLSearchParams(location.search).has('offline')) return useLocal();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(SERVER + '/api/health', { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j?.ok) { netMode = 'online'; return netMode; }
  } catch { /* fall through */ }
  return useLocal();
}
async function useLocal(): Promise<NetMode> {
  local = await import('./local.js');
  await local.boot();
  netMode = 'local';
  return netMode;
}

export async function auth(kind: 'login' | 'register', username: string, password: string) {
  if (netMode === 'local') return local!.auth(kind, username, password);
  let j: any;
  try {
    const r = await fetch(SERVER + '/api/' + kind, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    j = await r.json();
  } catch { throw new Error('Game server unreachable. Reload to play offline.'); }
  if (!j.ok) throw new Error(j.error ?? 'Failed');
  return j as { token: string; id: string };
}

export function connect(t: string): Promise<void> {
  token = t;
  if (netMode === 'local') {
    return new Promise((resolve, reject) => {
      try {
        local!.connect(t, (m) => handle(m, resolve));
        store.online = true;
      } catch { reject(new Error('Session expired')); }
    });
  }
  return new Promise((resolve, reject) => {
    const base = SERVER || `${location.protocol}//${location.host}`;
    ws = new WebSocket(base.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(t)}`);
    let opened = false;
    ws.onopen = () => { opened = true; store.online = true; emit('net', true); };
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      handle(m, resolve);
    };
    ws.onclose = () => {
      store.online = false;
      emit('net', false);
      for (const p of pending.values()) p.rej(new Error('Disconnected'));
      pending.clear();
      if (!opened) { reject(new Error('Could not connect to the game server.')); return; }
      clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => connect(token).catch(() => {}), 2500);
    };
  });
}

function send(msg: unknown) {
  if (netMode === 'local') { local!.send(msg); return true; }
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return true; }
  return false;
}

function handle(m: any, onInit: () => void) {
  switch (m.t) {
    case 'init':
      store.me = m.me;
      store.tokens = m.tokens;
      for (const t of m.tokens) store.prices[t.sym] = t.price;
      store.news = m.news;
      store.clock = { minutes: m.clock.minutes, day: m.clock.day, at: performance.now() };
      store.trending = m.trending;
      emit('me', store.me);
      emit('prices', store.prices);
      onInit();
      break;
    case 'me': {
      // periodic pushes often only change net worth (prices moved): don't re-render views for that
      const key = JSON.stringify({ ...m.me, netWorth: 0 });
      store.me = m.me;
      if (key !== lastMeKey) { lastMeKey = key; emit('me', m.me); }
      break;
    }
    case 'res': {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.ok ? p.res(m.d) : p.rej(new Error(m.e)); }
      break;
    }
    case 'prices':
      store.prices = m.p;
      for (const [s, p] of Object.entries(m.p as Record<string, number>)) {
        const arr = (store.priceHistory[s] ??= []);
        arr.push(p);
        if (arr.length > 90) arr.shift();
      }
      emit('prices', m.p);
      break;
    case 'tokens': store.tokens = m.list; emit('tokens', m.list); break;
    case 'news': store.news.unshift(m.item); store.news.length = Math.min(store.news.length, 100); emit('news', m.item); break;
    case 'time': store.clock = { minutes: m.clock.minutes, day: m.clock.day, at: performance.now() }; emit('time', m.clock); break;
    case 'presence': store.presence = m.list as PresenceEntry[]; emit('presence', m.list); break;
    case 'notify': emit('notify', m); break;
    case 'chat': store.chat.push(m.m); if (store.chat.length > 300) store.chat.shift(); emit('chat', m.m); break;
    case 'post': store.posts.unshift(m.post); emit('post', m.post); break;
    case 'invite': emit('invite', m); break;
    case 'react': emit('react', m); break;
    case 'error': emit('notify', { text: m.error === 'auth' ? 'Session expired — please sign in again.' : m.error, kind: 'warn' }); if (m.error === 'auth') { localStorage.removeItem(tokenKey()); setTimeout(() => location.reload(), 1500); } break;
  }
}

export function act<T = any>(a: string, d: Record<string, unknown> = {}): Promise<T> {
  return new Promise((res, rej) => {
    const id = seq++;
    pending.set(id, { res, rej });
    if (!send({ t: 'act', id, a, d })) { pending.delete(id); rej(new Error('Not connected to the server')); return; }
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('Request timed out')); } }, 15000);
  });
}

export function sendPos(p: [number, number, number], r: number, a: string, veh?: { model: string; color: string; rims: string } | null, mu?: { track: number; t0: number } | null) {
  send({ t: 'pos', p, r, a, veh: veh ?? undefined, mu: mu ?? null });
}
