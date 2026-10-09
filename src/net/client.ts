// WebSocket client. All economic actions go through `act()` and are decided by the server.

import type { PresenceEntry } from '../../shared/types.js';
import { emit, store } from '../state.js';

let ws: WebSocket | null = null;
let seq = 1;
const pending = new Map<number, { res: (d: any) => void; rej: (e: Error) => void }>();
let token = '';
let reconnectTimer = 0;
let lastMeKey = '';

export async function auth(kind: 'login' | 'register', username: string, password: string) {
  const r = await fetch('/api/' + kind, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  let j: any;
  try { j = await r.json(); } catch { throw new Error('Server unreachable. Is `npm run dev` running?'); }
  if (!j.ok) throw new Error(j.error ?? 'Failed');
  return j as { token: string; id: string };
}

export function connect(t: string): Promise<void> {
  token = t;
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(t)}`);
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
    case 'error': emit('notify', { text: m.error === 'auth' ? 'Session expired — please sign in again.' : m.error, kind: 'warn' }); if (m.error === 'auth') { localStorage.removeItem('cc_token'); setTimeout(() => location.reload(), 1500); } break;
  }
}

export function act<T = any>(a: string, d: Record<string, unknown> = {}): Promise<T> {
  return new Promise((res, rej) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) { rej(new Error('Not connected to the server')); return; }
    const id = seq++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ t: 'act', id, a, d }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('Request timed out')); } }, 15000);
  });
}

export function sendPos(p: [number, number, number], r: number, a: string, veh?: { model: string; color: string; rims: string } | null, mu?: { track: number; t0: number } | null) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'pos', p, r, a, veh: veh ?? undefined, mu: mu ?? null }));
}
