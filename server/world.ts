// The world loop: keeps the city evolving whether or not a given player is online.

import { PROPERTY_BY_ID } from '../shared/catalog.js';
import { FEATURE_BY_ZONE } from '../shared/city.js';
import type { CityEvent, PresenceEntry } from '../shared/types.js';
import { accrueStakes, processOrders } from './actions/finance.js';
import { fleetCycle, offerNpcRides } from './actions/transport.js';
import { projectCycle } from './actions/work.js';
import type { DB } from './db.js';
import { NPC_NAMES, type Game } from './game.js';
import { settleQuests } from './quests.js';
import { pick, round2, uid } from './util.js';

const CITY_EVENTS: { name: string; kind: CityEvent['kind']; venue: string; prize: number; description: string }[] = [
  { name: 'Crypto City Summit', kind: 'conference', venue: 'convention', prize: 0, description: 'Keynotes on the main stage, founders in the showcase, networking all day.' },
  { name: 'Satoshi Square Trading Cup', kind: 'trading_competition', venue: 'convention', prize: 500, description: 'Highest realized P&L during the event wins. Simulated prize pool.' },
  { name: 'Builder Night Hackathon', kind: 'hackathon', venue: 'hackhouse', prize: 300, description: 'Solve code challenges at Hackathon House. Most solves wins.' },
  { name: 'Seed Tower VC Summit', kind: 'vc_summit', venue: 'convention', prize: 0, description: 'VCs on stage discussing what they fund next.' },
  { name: 'MemeCon', kind: 'meme_convention', venue: 'convention', prize: 0, description: 'The internet, in person.' },
  { name: 'Liquidity Fridays', kind: 'party', venue: 'club', prize: 0, description: 'Resident DJ night at Liquidity Nightclub.' },
  { name: 'CITY DAO Assembly', kind: 'dao_assembly', venue: 'governance', prize: 0, description: 'Governance town hall at the DAO Hall.' },
];

const NPC_POSTS = [
  (t: string) => `Anyone else watching #${t} today? Feels like a big week.`,
  (t: string) => `Spent the morning at Block Brew reading about #${t}. Thoughts?`,
  (t: string) => `Not financial advice but #${t} is all anyone at the exchange talks about`,
  () => 'Traffic on the Builder District ring road is wild this morning 🚗',
  () => 'Liquidity Nightclub was packed last night. DJ went until sunrise 🎧',
  () => 'Reminder: never share your seed phrase. Real support will never DM you first.',
  () => 'Just tried the Gas Fee Burger. Low fees, high satisfaction.',
  (t: string) => `Hot take: #${t} is overhyped. Change my mind.`,
];

export function startWorld(g: Game, db: DB, save: () => void) {
  let tick = 0;
  let cityEventIdx = Math.floor(Math.random() * CITY_EVENTS.length);
  if (!Object.values(db.events).some((e) => e.status !== 'ended' && !e.organizerId)) scheduleCityEvent(60_000);

  function scheduleCityEvent(delay: number) {
    const t = CITY_EVENTS[cityEventIdx++ % CITY_EVENTS.length];
    const start = Date.now() + delay;
    const e: CityEvent = {
      id: uid('ev'), name: t.name, kind: t.kind, description: t.description, venue: t.venue, start, end: start + 8 * 60_000,
      capacity: 300, fee: 0, prize: t.prize, rules: t.kind === 'trading_competition' ? 'Register, then trade. Score = realized P&L from sells during the event.' : t.kind === 'hackathon' ? 'Register, go to Hackathon House, solve challenges. Score = correct solves.' : 'Show up at the venue while the event is live.',
      organizer: 'Crypto City', organizerId: null, registered: [], attended: [], baseline: {}, status: 'scheduled',
    };
    db.events[e.id] = e;
    g.market.news(`Coming up: ${e.name}`, `${e.description} At ${FEATURE_BY_ZONE[e.venue].name}, starting in ${Math.round(delay / 60_000)} min.`, ['events', e.kind], 'event');
  }

  function endEvent(e: CityEvent) {
    e.status = 'ended';
    const org = e.organizerId ? db.users[e.organizerId] : null;
    if (e.kind === 'trading_competition' || e.kind === 'hackathon') {
      const ranked = Object.entries(e.baseline).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const split = [0.5, 0.3, 0.2];
      e.results = ranked.map(([id, score], i) => {
        const u = db.users[id];
        const prize = round2(e.prize * split[i]);
        if (u && prize > 0) {
          g.credit(u, prize, 'prize', `${e.name} — place #${i + 1} (simulated prize)`);
          g.achieve(u, 'competition_win');
          g.addRep(u, 'events', 5);
          g.log(u, 'event', `Placed #${i + 1} at ${e.name} and won $${prize}.`);
          g.pushMe(u);
        }
        return { name: u?.username ?? '?', score: round2(score), prize };
      });
      const paid = e.results.reduce((s, r) => s + r.prize, 0);
      if (org && e.prize - paid > 0.009) { g.credit(org, e.prize - paid, 'event', `Unclaimed prize pool refunded: ${e.name}`); g.pushMe(org); }
      g.market.news(`${e.name} results`, e.results.length ? e.results.map((r, i) => `#${i + 1} @${r.name} (${r.score})`).join(', ') : 'No qualifying entries this time.', ['events', e.kind], 'event');
    } else if (org && e.prize > 0) {
      // non-competitive events: prize pool is split among attendees as a giveaway
      const att = e.attended.filter((id) => id !== org.id);
      if (att.length) {
        const each = round2(e.prize / att.length);
        for (const id of att) { const u = db.users[id]; if (u) { g.credit(u, each, 'prize', `Giveaway at ${e.name}`); g.pushMe(u); } }
      } else g.credit(org, e.prize, 'event', `Prize pool refunded: ${e.name}`);
    }
    if (org) { g.addRep(org, 'events', Math.min(8, e.attended.length)); g.pushMe(org); }
    if (!e.organizerId) scheduleCityEvent(90_000);
  }

  setInterval(() => {
    const now = Date.now();
    tick++;
    g.market.tick(now);
    const online = [...g.presence.keys()].map((id) => db.users[id]).filter(Boolean);

    for (const u of online) {
      if (processOrders(g, u)) g.pushMe(u);
      // keep the server-side zone and position in sync with presence
      const p = g.presence.get(u.id)!;
      u.lastPos = p.p;
    }
    if (tick % 10 === 0) {
      for (const u of Object.values(db.users)) if (u.stakes.length) accrueStakes(g, u, 10_000);
      for (const u of online) { settleQuests(g, u, now); offerNpcRides(g, u); }
    }
    if (tick % 2 === 0) g.io.broadcast({ t: 'prices', p: db.market.prices });
    if (tick % 15 === 0) g.io.broadcast({ t: 'time', clock: g.clock() });
    if (tick % 5 === 0) for (const u of online) g.pushMe(u);

    // projects & fleets: every 3 minutes; only for owners active in the last 20 minutes (no offline punishment)
    if (tick % 180 === 0) {
      for (const p of Object.values(db.projects)) {
        const f = db.users[p.founderId];
        if (f && now - f.lastActive < 20 * 60_000) projectCycle(g, p);
      }
      for (const u of online) fleetCycle(g, u);
    }

    // day rollover: rent for online renters (offline players aren't charged), daily market open
    const day = g.dayIndex(now);
    if (day !== g.lastDayIndex) {
      g.lastDayIndex = day;
      g.market.rollDay();
      for (const u of online) {
        for (const prop of u.properties.filter((x) => x.mode === 'rent')) {
          const def = PROPERTY_BY_ID[prop.id];
          if (u.cash >= def.rent) g.debit(u, def.rent, 'rent', `Daily rent — ${def.name}`);
          else {
            u.properties = u.properties.filter((x) => x !== prop);
            if (u.homeId === prop.id) u.homeId = 'starter';
            g.notify(u, `Couldn't pay rent for ${def.name}; the lease ended. Your furniture is safe in storage and your starter apartment is still yours.`, 'warn');
            g.log(u, 'home', `Lease on ${def.name} ended (rent unpaid).`);
          }
        }
        g.pushMe(u);
      }
    }

    // events
    for (const e of Object.values(db.events)) {
      if (e.status === 'scheduled' && now >= e.start) {
        e.status = 'live';
        g.market.news(`LIVE: ${e.name}`, `Now at ${FEATURE_BY_ZONE[e.venue]?.name}.`, ['events', e.kind], 'event');
        for (const id of e.registered) { const u = db.users[id]; if (u) g.notify(u, `${e.name} is live at ${FEATURE_BY_ZONE[e.venue]?.name}!`, 'event'); }
      } else if (e.status === 'live') {
        if (now >= e.end) endEvent(e);
        else if (tick % 5 === 0) {
          for (const u of online) {
            if (g.zoneOf(u) !== e.venue || e.attended.includes(u.id)) continue;
            if (!e.registered.includes(u.id)) {
              if (e.fee > 0 || e.registered.length >= e.capacity) continue;
              e.registered.push(u.id);
            }
            e.attended.push(u.id);
            if (!u.events.includes(e.id)) u.events.push(e.id);
            g.addXp(u, 'community', 30);
            g.addRep(u, 'events', 3);
            g.achieve(u, 'event_attendee');
            g.log(u, 'event', `Attended ${e.name}${e.organizerId ? ` hosted by @${e.organizer}` : ''}.`);
            g.notify(u, `Checked in to ${e.name}. Meet people, pitch projects, make friends.`, 'event');
          }
        }
      }
    }

    // DAO proposals
    for (const d of Object.values(db.daos)) {
      for (const p of d.proposals) {
        if (p.status !== 'open' || now < p.ends) continue;
        if (p.yes.length > p.no.length) {
          p.status = 'passed';
          const r = p.recipient ? g.byName(p.recipient) : null;
          if (p.amount > 0 && r && d.treasury >= p.amount) {
            d.treasury = round2(d.treasury - p.amount);
            g.credit(r, p.amount, 'dao', `${d.name} grant: ${p.title}`);
            p.status = 'executed';
            g.pushMe(r);
          }
        } else p.status = 'rejected';
        d.history.unshift({ ts: now, text: `Proposal "${p.title}" ${p.status} (${p.yes.length}–${p.no.length})` });
      }
    }

    // NPC citizens post occasionally, so the feed isn't empty when few players are online
    if (tick % 75 === 0) {
      const t = pick(g.market.mods.trending) ?? 'crypto-city';
      const name = pick(NPC_NAMES);
      const text = pick(NPC_POSTS)(t);
      const post = { id: uid('post'), author: `${name} (NPC)`, authorId: 'npc', text, tags: [...(text.match(/#[a-z0-9_-]+/gi) ?? [])].map((x) => x.slice(1).toLowerCase()), ts: now, likes: [], comments: [] };
      db.posts.unshift(post);
      if (db.posts.length > 600) db.posts.length = 600;
      g.io.broadcast({ t: 'post', post });
    }

    // expire stale challenges
    if (tick % 30 === 0) for (const [id, c] of g.challenges) if (c.expires < now) g.challenges.delete(id);
    if (tick % 15 === 0) save();
  }, 1000);

  // presence at 10 Hz — each client receives players in its own zone (and nearby on the street)
  setInterval(() => {
    const entries: [string, PresenceEntry][] = [...g.presence.entries()].map(([id, p]) => [id, { id, name: db.users[id]?.username ?? '?', p: p.p, r: p.r, a: p.a, z: p.z, look: p.look, veh: p.veh, mu: p.mu }]);
    for (const [id, me] of g.presence) {
      const list = entries.filter(([oid, e]) => oid !== id && e.z === me.z && (me.z !== 'street' || Math.hypot(e.p[0] - me.p[0], e.p[2] - me.p[2]) < 400)).map(([, e]) => e);
      g.io.send(id, { t: 'presence', list });
    }
  }, 100);
}
