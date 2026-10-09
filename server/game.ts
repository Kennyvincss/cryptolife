// Authoritative game state. Clients send intents ("actions"); every balance,
// reward, ownership change and transaction outcome is decided here.

import {
  ACHIEVEMENTS, CAREERS, DAY_MS, GAME_MINUTE_MS, JOB_TEMPLATES, PROPERTY_BY_ID, SKILLS,
  STARTER_WARDROBE, STARTING_CASH, VEHICLE_BY_ID, defaultLook, levelFromXp,
} from '../shared/catalog.js';
import { FEATURE_BY_ZONE, doorOf } from '../shared/city.js';
import type {
  ChatMessage, Look, MeSnapshot, NewsItem, PresenceEntry, SkillId, TxRecord, Vec3,
} from '../shared/types.js';
import type { DB, UserRec } from './db.js';
import { Market } from './market.js';
import type { PendingChallenge } from './challenges.js';
import {
  RESERVED, assert, cleanText, fail, hashPassword, normalizeName, pick, round2, uid, verifyPassword,
} from './util.js';

export type Handler = (u: UserRec, args: any, g: Game) => unknown;

export interface Presence {
  p: Vec3; r: number; a: string; z: string; look: Look;
  veh?: PresenceEntry['veh']; mu?: PresenceEntry['mu']; t: number;
}

export interface IO {
  send(userId: string, msg: unknown): void;
  broadcast(msg: unknown): void;
}

// hourly caps per reputation source, so repeated low-value actions can't farm reputation
const REP_CAPS: Record<string, number> = {
  work: 6, trading: 4, social: 3, events: 8, projects: 12, driving: 5, governance: 4, airdrops: 4, community: 3,
};

export const NPC_NAMES = ['Mara Quinn', 'Dev Okafor', 'Lena Sato', 'Rafael Cruz', 'Ivy Chen', 'Tomás Reyes', 'Nia Brooks', 'Oskar Lind', 'Priya Nair', 'Kofi Mensah', 'Sasha Volkova', 'Jules Martin', 'Amara Diallo', 'Hiro Tanaka', 'Zoe Clarke'];

export class Game {
  actions: Record<string, Handler> = {};
  presence = new Map<string, Presence>();
  challenges = new Map<string, PendingChallenge>();
  market: Market;
  lastDayIndex: number;
  private rate = new Map<string, number[]>();

  constructor(public db: DB, public io: IO) {
    this.market = new Market(db, (n) => this.pushNews(n), (sym, haircut) => this.onExploit(sym, haircut));
    this.lastDayIndex = this.dayIndex();
    this.ensureJobs();
    for (const u of Object.values(db.users)) this.migrate(u);
  }

  // ---------------- time ----------------
  gameMinutes(now = Date.now()) {
    return (now - this.db.worldStart) / GAME_MINUTE_MS + 8 * 60 + (this.db.timeOffset ?? 0);
  }
  dayIndex(now = Date.now()) { return Math.floor(this.gameMinutes(now) / 1440); }
  clock() { const m = this.gameMinutes(); return { minutes: m, day: Math.floor(m / 1440) + 1 }; }

  // ---------------- accounts ----------------
  register(username: string, password: string) {
    username = String(username ?? '').trim().replace(/^@/, '');
    assert(/^[A-Za-z0-9_]{3,16}$/.test(username), 'Username must be 3–16 letters, numbers or _');
    assert(typeof password === 'string' && password.length >= 6, 'Password must be at least 6 characters');
    const norm = normalizeName(username);
    assert(!RESERVED.some((r) => norm.includes(normalizeName(r))), 'That username is reserved');
    assert(!this.db.usernames[norm], 'That username (or a look-alike) is already taken');
    const { hash, salt } = hashPassword(password);
    const id = uid('u');
    const token = uid('t') + uid();
    const u: UserRec = {
      id, username, passHash: hash, salt, sessions: [token],
      look: defaultLook('m'), career: 'Explorer', xp: 0,
      skills: Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<SkillId, number>,
      following: [], followerIds: [], friends: [], friendRequests: [], blocked: [],
      cash: STARTING_CASH, holdings: {}, costBasis: {}, orders: [], fills: [], watchlist: ['SGLD', 'ETHN', 'MDOG'],
      txs: [], paymentRequests: [],
      properties: [{ id: 'starter', mode: 'starter', since: Date.now(), placements: [] }], homeId: 'starter',
      furniture: {}, vehicles: [], wardrobe: [...STARTER_WARDROBE], outfits: [],
      applications: [], driver: { registered: false, onDuty: false, rides: 0, ratingSum: 0, ratingCount: 0, earnings: 0 },
      stakes: [], airdrops: [], projects: [], daos: [], events: [],
      privacy: { showBalance: false, showPortfolio: false, showVehicles: true, showHome: true, allowDMs: 'everyone' },
      buffs: { rested: 0, fed: 0 }, achievements: [], journey: [], created: Date.now(),
      repEvents: [], lastActive: Date.now(), lastPos: [0, 0, 0], lastZone: 'home', reports: 0, postTimes: [],
      likesReceived: 0, likers: [], airdropWins: 0, dancedSecs: 0,
      rep: {}, vipUntil: 0, homeInvites: [], fleetLast: Date.now(), orderCount: 0,
    };
    this.db.usernames[norm] = id;
    this.db.users[id] = u;
    this.tx(u, 'grant', STARTING_CASH, 'Welcome to Crypto City — starting simulated funds');
    this.log(u, 'start', `Arrived in Crypto City with $${STARTING_CASH} in simulated capital and a starter apartment.`);
    return { token, id };
  }

  login(username: string, password: string) {
    const id = this.db.usernames[normalizeName(String(username ?? '').replace(/^@/, ''))];
    const u = id ? this.db.users[id] : undefined;
    assert(u && u.username.toLowerCase() === String(username).replace(/^@/, '').toLowerCase() && verifyPassword(String(password), u.salt, u.passHash), 'Wrong username or password');
    const token = uid('t') + uid();
    u.sessions = [...u.sessions.slice(-4), token];
    return { token, id: u.id };
  }

  auth(token: string): UserRec | null {
    if (!token) return null;
    for (const u of Object.values(this.db.users)) if (u.sessions.includes(token)) return u;
    return null;
  }

  migrate(u: UserRec) {
    u.rep ??= {};
    u.likers ??= [];
    u.vipUntil ??= 0;
    u.homeInvites ??= [];
    u.fleetLast ??= Date.now();
    u.orderCount ??= 0;
    u.dancedSecs ??= 0;
  }

  byName(name: string): UserRec | null {
    const id = this.db.usernames[normalizeName(String(name ?? '').replace(/^@/, ''))];
    return id ? this.db.users[id] : null;
  }
  mustUser(name: string): UserRec {
    const u = this.byName(name);
    assert(u, `No resident named @${String(name).replace(/^@/, '')}`);
    return u;
  }
  isOnline(id: string) { return this.presence.has(id); }

  // ---------------- ledger ----------------
  tx(u: UserRec, kind: string, amount: number, memo: string, counterparty?: string, status: TxRecord['status'] = 'completed') {
    u.txs.unshift({ id: uid('tx'), ts: Date.now(), kind, amount: round2(amount), memo, counterparty, status });
    if (u.txs.length > 200) u.txs.length = 200;
  }
  debit(u: UserRec, amount: number, kind: string, memo: string, counterparty?: string) {
    amount = round2(amount);
    assert(Number.isFinite(amount) && amount >= 0, 'Invalid amount');
    assert(u.cash + 1e-9 >= amount, `Not enough funds — need $${amount.toLocaleString()} (you have $${round2(u.cash).toLocaleString()})`);
    u.cash = round2(u.cash - amount);
    this.tx(u, kind, -amount, memo, counterparty);
  }
  credit(u: UserRec, amount: number, kind: string, memo: string, counterparty?: string) {
    amount = round2(amount);
    if (!(amount > 0)) return;
    u.cash = round2(u.cash + amount);
    this.tx(u, kind, amount, memo, counterparty);
  }

  // ---------------- progression ----------------
  xpMult(u: UserRec) {
    const now = Date.now();
    return 1 + (u.buffs.rested > now ? 0.1 : 0) + (u.buffs.fed > now ? 0.1 : 0);
  }
  addXp(u: UserRec, skill: SkillId, amount: number) {
    const amt = Math.round(amount * this.xpMult(u));
    if (amt <= 0) return 0;
    const before = levelFromXp(u.xp);
    u.xp += amt;
    u.skills[skill] = (u.skills[skill] ?? 0) + amt;
    const after = levelFromXp(u.xp);
    if (after > before) {
      this.notify(u, `Level up! You are now level ${after}.`, 'level');
      if (after % 5 === 0) this.log(u, 'level', `Reached level ${after}.`);
    }
    return amt;
  }
  addRep(u: UserRec, src: string, pts: number) {
    const now = Date.now();
    u.repEvents = u.repEvents.filter((e) => now - e.ts < 3_600_000);
    const used = u.repEvents.filter((e) => e.src === src).reduce((s, e) => s + e.pts, 0);
    const cap = REP_CAPS[src] ?? 5;
    const give = Math.max(0, Math.min(pts, cap - used));
    if (give <= 0) return 0;
    u.repEvents.push({ ts: now, src, pts: give });
    const rep = u.rep;
    rep[src] = (rep[src] ?? 0) + give;
    return give;
  }
  reputation(u: UserRec) {
    const rep = u.rep;
    const base = Object.values(rep).reduce((s, v) => s + v, 0);
    const drv = u.driver.ratingCount >= 3 ? (u.driver.ratingSum / u.driver.ratingCount - 3.5) * 4 : 0;
    return Math.max(0, Math.round(base + u.achievements.length * 2 + drv - u.reports * 0.5));
  }
  achieve(u: UserRec, id: string) {
    if (u.achievements.includes(id)) return;
    u.achievements.push(id);
    this.notify(u, `Achievement unlocked: ${ACHIEVEMENTS[id] ?? id}`, 'achievement');
  }
  log(u: UserRec, kind: string, text: string) {
    u.journey.push({ ts: Date.now(), kind, text });
    if (u.journey.length > 400) u.journey.splice(0, u.journey.length - 400);
  }

  netWorth(u: UserRec) {
    let nw = u.cash;
    for (const [s, q] of Object.entries(u.holdings)) if (this.market.has(s)) nw += q * this.market.price(s);
    for (const o of u.orders) if (o.side === 'buy') nw += o.reserved; else if (this.market.has(o.sym)) nw += o.reserved * this.market.price(o.sym);
    for (const s of u.stakes) nw += (s.amount + s.accrued) * (s.sym === 'USD' ? 1 : this.market.has(s.sym) ? this.market.price(s.sym) : 0);
    for (const v of u.vehicles) nw += (VEHICLE_BY_ID[v.model]?.price ?? 0) * 0.6 * (1 - v.damage / 200);
    for (const p of u.properties) if (p.mode === 'own') nw += PROPERTY_BY_ID[p.id].price * 0.9;
    return round2(nw);
  }

  // ---------------- snapshots ----------------
  snapshot(u: UserRec): MeSnapshot {
    const rep = u.rep;
    return {
      id: u.id, username: u.username, look: u.look, career: u.career,
      level: levelFromXp(u.xp), xp: u.xp, skills: u.skills,
      reputation: this.reputation(u), repBreakdown: { ...rep, achievements: u.achievements.length * 2 },
      followers: u.followerIds.length, following: u.following.map((id) => this.db.users[id]?.username).filter(Boolean) as string[],
      friends: u.friends.map((id) => this.db.users[id]?.username).filter(Boolean) as string[],
      friendRequests: u.friendRequests.map((id) => this.db.users[id]?.username).filter(Boolean) as string[],
      blocked: u.blocked.map((id) => this.db.users[id]?.username).filter(Boolean) as string[],
      cash: u.cash, holdings: u.holdings, costBasis: u.costBasis, orders: u.orders, fills: u.fills.slice(0, 60), watchlist: u.watchlist,
      txs: u.txs.slice(0, 80), paymentRequests: u.paymentRequests,
      properties: u.properties, homeId: u.homeId, furniture: u.furniture, vehicles: u.vehicles, activeVehicle: u.activeVehicle,
      wardrobe: u.wardrobe, outfits: u.outfits, job: u.job, applications: u.applications, driver: u.driver, fleet: u.fleet, ride: u.ride,
      stakes: u.stakes, airdrops: u.airdrops, projects: u.projects, daos: u.daos, events: u.events, privacy: u.privacy, buffs: u.buffs,
      achievements: u.achievements, journey: u.journey.slice(-60), netWorth: this.netWorth(u), created: u.created,
      realWallet: { connected: false, note: 'Real-asset wallet not connected. All balances are simulated game currency.' },
    };
  }
  pushMe(u: UserRec) { if (this.isOnline(u.id)) this.io.send(u.id, { t: 'me', me: this.snapshot(u) }); }
  notify(u: UserRec, text: string, kind = 'info') { this.io.send(u.id, { t: 'notify', text, kind }); }

  pushNews(n: NewsItem) {
    this.db.news.unshift(n);
    if (this.db.news.length > 120) this.db.news.length = 120;
    this.io.broadcast({ t: 'news', item: n });
  }

  // ---------------- zones ----------------
  zoneOf(u: UserRec) { return this.presence.get(u.id)?.z ?? u.lastZone; }
  requireZone(u: UserRec, ...zones: string[]) {
    const z = this.zoneOf(u);
    assert(zones.includes(z), `You need to be at ${zones.map((zz) => FEATURE_BY_ZONE[zz]?.name ?? zz).join(' or ')} to do that.`);
  }
  isOwnHome(u: UserRec) { return this.zoneOf(u) === 'home:' + u.id; }
  nearDoor(u: UserRec, zone: string, dist = 14) {
    const d = doorOf(zone);
    if (!d) return true;
    const p = u.lastPos;
    return Math.hypot(p[0] - d[0], p[2] - d[2]) <= dist;
  }

  rateLimit(key: string, n: number, windowMs: number) {
    const now = Date.now();
    const arr = (this.rate.get(key) ?? []).filter((t) => now - t < windowMs);
    assert(arr.length < n, 'Slow down a little.');
    arr.push(now);
    this.rate.set(key, arr);
  }

  // ---------------- dispatch ----------------
  handle(u: UserRec, action: string, args: unknown) {
    const h = this.actions[action];
    assert(h, 'Unknown action ' + action);
    this.rateLimit(u.id + ':act', 40, 5000);
    u.lastActive = Date.now();
    const res = h(u, args ?? {}, this);
    this.pushMe(u);
    return res;
  }

  // ---------------- jobs pool ----------------
  ensureJobs() {
    for (const t of JOB_TEMPLATES) {
      const id = 'job_' + normalizeName(t.title + t.company).slice(0, 30);
      if (!this.db.jobs[id]) this.db.jobs[id] = { id, ...t, open: true };
    }
  }

  // ---------------- chat ----------------
  pushChat(m: ChatMessage, recipients: string[]) {
    for (const id of new Set(recipients)) {
      const r = this.db.users[id];
      if (r && r.blocked.includes(m.fromId)) continue;
      this.io.send(id, { t: 'chat', m });
    }
  }

  onExploit(sym: string, haircut: number) {
    if (!haircut) return;
    for (const u of Object.values(this.db.users)) {
      for (const s of u.stakes) {
        if (s.sym === sym) {
          const loss = s.amount * haircut;
          s.amount -= loss;
          this.notify(u, `Exploit: your ${sym} vault position lost ${(haircut * 100).toFixed(0)}% (${loss.toFixed(2)} ${sym}).`, 'warn');
          this.log(u, 'exploit', `Lost ${(haircut * 100).toFixed(0)}% of a ${sym} vault position in a protocol exploit.`);
          this.pushMe(u);
        }
      }
    }
  }

  careerValid(c: string) { return CAREERS.some((x) => x.id === c); }
  npcName() { return pick(NPC_NAMES); }
  clean = cleanText;
  fail = fail;
  DAY_MS = DAY_MS;
}
