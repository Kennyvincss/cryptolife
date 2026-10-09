// Simulated market engine. Prices are generated here and are NEVER presented as
// live real-world prices; every client view labels them "SIMULATED".

import { TOKENS } from '../shared/catalog.js';
import type { MarketToken, NewsItem } from '../shared/types.js';
import { pick, randn, uid } from './util.js';
import type { DB } from './db.js';

export interface Candle { t: number; o: number; h: number; l: number; c: number }
interface Effect { target: string; drift: number; start: number; until: number }

export interface WorldModifiers {
  jobPay: Record<string, number>; // challenge kind -> multiplier
  fundraising: number;
  sentiment: number; // -1..1
  trending: string[];
}

const CANDLE_MS = 15_000;
const MAX_CANDLES = 240;

interface TokenRuntime { sym: string; name: string; vol: number; sector: string; supply: number; anchor: number; launchedBy?: string }

export class Market {
  tokens = new Map<string, TokenRuntime>();
  candles = new Map<string, Candle[]>();
  effects: Effect[] = [];
  mods: WorldModifiers = { jobPay: {}, fundraising: 1, sentiment: 0, trending: ['crypto-city'] };
  modExpiry: { key: string; until: number }[] = [];
  nextEventAt = Date.now() + 60_000;

  constructor(private db: DB, private onNews: (n: NewsItem) => void, private onExploit: (sym: string, haircut: number) => void) {
    for (const t of TOKENS) this.register(t.sym, t.name, t.vol, t.sector, t.supply, t.price);
    for (const t of db.market.extraTokens) this.register(t.sym, t.name, t.vol, t.sector, t.supply, t.price, t.launchedBy);
  }

  register(sym: string, name: string, vol: number, sector: string, supply: number, price: number, launchedBy?: string) {
    const p = this.db.market.prices[sym] ?? price;
    this.db.market.prices[sym] = p;
    this.db.market.open24[sym] ??= p;
    this.tokens.set(sym, { sym, name, vol, sector, supply, anchor: p, launchedBy });
    if (!this.candles.has(sym)) {
      // backfill a plausible-looking (still simulated) history so charts aren't empty on boot
      const arr: Candle[] = [];
      let c = p;
      const now = Math.floor(Date.now() / CANDLE_MS) * CANDLE_MS;
      const back: number[] = [];
      for (let i = 0; i < 120; i++) { back.push(c); c = c / Math.exp(vol * 0.006 * randn()); }
      back.reverse();
      for (let i = 0; i < back.length; i++) {
        const o = back[i];
        const cl = i + 1 < back.length ? back[i + 1] : p;
        arr.push({ t: now - (back.length - i) * CANDLE_MS, o, c: cl, h: Math.max(o, cl) * (1 + Math.random() * 0.003 * vol), l: Math.min(o, cl) * (1 - Math.random() * 0.003 * vol) });
      }
      this.candles.set(sym, arr);
    }
  }

  price(sym: string): number {
    const p = this.db.market.prices[sym];
    if (p === undefined) throw new Error('Unknown token ' + sym);
    return p;
  }
  has(sym: string) { return this.tokens.has(sym); }

  list(): MarketToken[] {
    return [...this.tokens.values()].map((t) => ({
      sym: t.sym, name: t.name, price: this.db.market.prices[t.sym], open24: this.db.market.open24[t.sym], vol: t.vol, sector: t.sector, launchedBy: t.launchedBy,
    }));
  }
  supply(sym: string) { return this.tokens.get(sym)?.supply ?? 0; }

  /** Price impact for an order of `usd` notional: thin, volatile tokens slip more. */
  slippage(sym: string, usd: number) {
    const t = this.tokens.get(sym)!;
    const liquidity = Math.max(2e5, this.price(sym) * t.supply * 0.0005);
    return Math.min(0.05, (usd / liquidity) * t.vol);
  }
  /** Large trades move the market a little. */
  impact(sym: string, usd: number, side: 'buy' | 'sell') {
    const s = this.slippage(sym, usd) * 0.5;
    this.db.market.prices[sym] *= side === 'buy' ? 1 + s : 1 - s;
  }

  tick(now: number) {
    this.effects = this.effects.filter((e) => e.until > now);
    for (const t of this.tokens.values()) {
      const p = this.db.market.prices[t.sym];
      let drift = 0;
      for (const e of this.effects) {
        if (e.start > now) continue;
        if (e.target === 'all' || e.target === t.sym || e.target === t.sector) drift += e.drift;
      }
      drift += this.mods.sentiment * 0.00005;
      t.anchor *= Math.exp(randn() * 0.0004 * t.vol);
      const revert = 0.0015 * (Math.log(t.anchor) - Math.log(p));
      const ret = drift + revert + randn() * 0.0016 * t.vol;
      const np = Math.max(p * Math.exp(ret), 1e-8);
      this.db.market.prices[t.sym] = np;
      this.pushCandle(t.sym, np, now);
    }
    if (now >= this.nextEventAt) {
      this.randomEvent(now);
      this.nextEventAt = now + 120_000 + Math.random() * 180_000;
    }
    for (const m of this.modExpiry.filter((m) => m.until <= now)) {
      if (m.key === 'fundraising') this.mods.fundraising = 1;
      else if (m.key === 'sentiment') this.mods.sentiment = 0;
      else delete this.mods.jobPay[m.key];
    }
    this.modExpiry = this.modExpiry.filter((m) => m.until > now);
  }

  private pushCandle(sym: string, p: number, now: number) {
    const arr = this.candles.get(sym)!;
    const t = Math.floor(now / CANDLE_MS) * CANDLE_MS;
    const last = arr[arr.length - 1];
    if (last && last.t === t) {
      last.c = p; last.h = Math.max(last.h, p); last.l = Math.min(last.l, p);
    } else {
      arr.push({ t, o: last ? last.c : p, h: p, l: p, c: p });
      if (arr.length > MAX_CANDLES) arr.shift();
    }
  }

  history(sym: string) { return this.candles.get(sym) ?? []; }

  rollDay() { for (const s of this.tokens.keys()) this.db.market.open24[s] = this.db.market.prices[s]; }

  shock(target: string, pct: number) {
    for (const t of this.tokens.values()) {
      if (target === 'all' || target === t.sym || target === t.sector) {
        this.db.market.prices[t.sym] *= 1 + pct;
        t.anchor *= 1 + pct * 0.8;
      }
    }
  }
  addEffect(target: string, drift: number, durMs: number, delayMs = 0) {
    const now = Date.now();
    this.effects.push({ target, drift, start: now + delayMs, until: now + delayMs + durMs });
  }
  setMod(key: string, val: number, durMs: number) {
    if (key === 'fundraising') this.mods.fundraising = val;
    else if (key === 'sentiment') this.mods.sentiment = val;
    else this.mods.jobPay[key] = val;
    this.modExpiry.push({ key, until: Date.now() + durMs });
  }

  news(title: string, body: string, tags: string[], kind: NewsItem['kind'] = 'market') {
    const n: NewsItem = { id: uid('n'), ts: Date.now(), title, body, tags, kind, simulated: true };
    this.mods.trending = [...new Set([...tags, ...this.mods.trending])].slice(0, 6);
    this.onNews(n);
  }

  randomEvent(now: number, forced?: string) {
    const events: Record<string, () => void> = {
      rally: () => {
        this.addEffect('all', 0.0007, 150_000);
        this.setMod('sentiment', 0.8, 300_000);
        this.news('Market rally lifts every major token', 'Buyers return across the board as Satoshi Gold breaks resistance. Analysts at Alpha Labs warn rallies can reverse quickly.', ['rally', 'sgld'], 'market');
      },
      crash: () => {
        this.shock('all', -0.07);
        this.addEffect('all', -0.0004, 90_000);
        this.setMod('sentiment', -0.8, 300_000);
        this.setMod('research', 1.4, 300_000);
        this.news('Flash crash: liquidations cascade across Crypto City', 'Leveraged positions unwind; every sector is red. Research desks report higher demand for analysts (+40% research pay for 5 min).', ['crash', 'liquidations'], 'market');
      },
      upgrade: () => {
        const sym = pick(['ETHN', 'SOLR']);
        this.shock(sym, 0.05);
        this.addEffect(sym, 0.0008, 120_000);
        this.setMod('dev', 1.3, 400_000);
        this.news(`${sym === 'ETHN' ? 'Etherion' : 'Solaris'} ships a major network upgrade`, 'Lower fees and faster blocks. Developer demand rises: dev shifts pay +30% for a few minutes.', [sym.toLowerCase(), 'upgrade'], 'market');
      },
      exploit: () => {
        const sym = pick(['YLD', 'LQD']);
        this.shock(sym, -0.22);
        this.addEffect('defi', -0.0005, 90_000);
        this.onExploit(sym, sym === 'YLD' ? 0.15 : 0);
        this.news(`Exploit drains a ${sym === 'YLD' ? 'Yieldstone' : 'Liquidity Labs'} contract`, `${sym} falls sharply. ${sym === 'YLD' ? 'The Yieldstone Vault takes a 15% haircut on staked principal.' : 'Funds in Liquidity Labs pools are safe; token holders take the hit.'} DeFi sentiment cools.`, [sym.toLowerCase(), 'exploit', 'defi'], 'market');
      },
      whale: () => {
        this.addEffect('SGLD', 0.0009, 120_000);
        this.news('Whale wallets accumulate Satoshi Gold', 'On-chain trackers (simulated) see steady buying from large holders.', ['whales', 'sgld'], 'market');
      },
      chain: () => {
        this.shock('BLD', 0.12);
        this.addEffect('infra', 0.0006, 150_000);
        this.setMod('dev', 1.3, 400_000);
        this.news('Builder Network mainnet goes live', 'A new chain launches with grants for builders. BLD jumps; Genesis Hub is hiring (dev pay +30%).', ['bld', 'builder-network', 'launch'], 'market');
      },
      meme: () => {
        this.shock('MDOG', 0.45);
        this.addEffect('MDOG', -0.004, 60_000, 40_000);
        this.setMod('creator', 1.5, 300_000);
        this.news('Moon Doge goes viral', 'MDOG rips on social hype. Meme studios pay creators +50% for a few minutes. Historically these pumps fade fast.', ['moondoge', 'meme', 'viral'], 'market');
      },
      vc: () => {
        this.setMod('fundraising', 1.6, 600_000);
        this.addEffect('infra', 0.0004, 120_000);
        this.news('VC funding wave hits Crypto City', 'Seed Round Tower partners are writing bigger checks: pitches are 60% more likely to close for 10 minutes.', ['vc', 'funding', 'builders'], 'project');
      },
      fud: () => {
        this.shock('all', -0.03);
        this.setMod('community', 1.3, 300_000);
        this.news('Regulatory rumor spreads FUD', 'Unverified rumors rattle traders. Communities need moderators (+30% community pay).', ['fud', 'regulation'], 'market');
      },
      nft: () => {
        this.shock('PXL', 0.15);
        this.addEffect('nft', 0.0005, 120_000);
        this.setMod('creator', 1.3, 300_000);
        this.news('NFT season returns', 'Mint Gallery sells out its latest drop; Pixelverse surges. Creator pay +30%.', ['nft', 'pixelverse'], 'market');
      },
      airdrop: () => {
        this.news('New airdrop campaigns open at the Airdrop Center', 'Protocols are running quest campaigns. Requirements and outcomes vary — some campaigns pay nothing.', ['airdrop', 'quests'], 'airdrop');
      },
    };
    const key = forced ?? pick(Object.keys(events));
    events[key]?.();
  }
}
