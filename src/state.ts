// Client-side mirror of server state + a tiny event bus.

import type { ChatMessage, CityEvent, MarketToken, MeSnapshot, NewsItem, Post, PresenceEntry, ProjectRecord } from '../shared/types.js';

type Fn = (d: any) => void;
const listeners = new Map<string, Set<Fn>>();

export function on(ev: string, fn: Fn) {
  let s = listeners.get(ev);
  if (!s) { s = new Set(); listeners.set(ev, s); }
  s.add(fn);
  return () => s!.delete(fn);
}
export function emit(ev: string, d?: unknown) {
  listeners.get(ev)?.forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });
}

export const store = {
  me: null as MeSnapshot | null,
  prices: {} as Record<string, number>,
  tokens: [] as MarketToken[],
  news: [] as NewsItem[],
  posts: [] as Post[],
  chat: [] as ChatMessage[],
  clock: { minutes: 480, day: 1, at: performance.now() },
  trending: [] as string[],
  presence: [] as PresenceEntry[],
  zone: 'street',
  online: false,
  priceHistory: {} as Record<string, number[]>, // short client-side sparkline buffer
  events: [] as (Omit<CityEvent, 'registered' | 'attended'> & { registered: string[]; attended: number })[],
  projects: [] as ProjectRecord[],
};

export function gameMinutes() {
  return store.clock.minutes + (performance.now() - store.clock.at) / 1000;
}
export function clockString(m = gameMinutes()) {
  const h = Math.floor((m / 60) % 24), mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export const fmt = {
  usd(n: number, dp = 2) {
    const a = Math.abs(n);
    const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (n < 0 ? '-$' : '$') + s;
  },
  price(p: number) { return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p >= 1 ? p.toFixed(3) : p.toPrecision(4); },
  qty(q: number) { return q >= 1000 ? q.toLocaleString('en-US', { maximumFractionDigits: 0 }) : q >= 1 ? q.toFixed(3) : q.toPrecision(4); },
  pct(a: number) { return (a >= 0 ? '+' : '') + a.toFixed(2) + '%'; },
  ago(ts: number) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return Math.floor(s) + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  },
};

export function portfolioValue(me = store.me) {
  if (!me) return 0;
  let v = 0;
  for (const [s, q] of Object.entries(me.holdings)) v += q * (store.prices[s] ?? 0);
  for (const st of me.stakes) v += (st.amount + st.accrued) * (st.sym === 'USD' ? 1 : store.prices[st.sym] ?? 0);
  return v;
}
