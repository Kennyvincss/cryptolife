// Everyday-life actions: identity, zones, homes, furniture, clothing, food, nightlife, sleep.

import {
  CLOTHING_BY_ID, FURNITURE_BY_ID, HAIR_COLORS, MENUS, PROPERTIES, PROPERTY_BY_ID, SKILLS, SKIN_TONES, EYE_COLORS, VIP_PRICE, levelFromXp,
} from '../../shared/catalog.js';
import { FEATURE_BY_ZONE, doorOf } from '../../shared/city.js';
import type { Look, PublicProfile, Slot } from '../../shared/types.js';
import type { UserRec } from '../db-core.js';
import type { Game } from '../game.js';
import { questHook } from '../quests.js';
import { assert, clamp } from '../util.js';

const RESIDENCES = ['apt_starter', 'apt_mid', 'apt_lux', 'mansion'];

export function publicProfile(g: Game, viewer: UserRec | null, u: UserRec): PublicProfile {
  const p = u.privacy;
  return {
    id: u.id, username: u.username, career: u.career, level: levelFromXp(u.xp), reputation: g.reputation(u),
    followers: u.followerIds.length, following: u.following.length, achievements: u.achievements, skills: u.skills,
    projects: u.projects.map((id) => ({ id, name: g.db.projects[id]?.name ?? '?' })),
    balance: p.showBalance ? u.cash : undefined,
    netWorth: p.showPortfolio ? g.netWorth(u) : undefined,
    vehicles: p.showVehicles ? u.vehicles.map((v) => v.model) : undefined,
    home: p.showHome ? PROPERTY_BY_ID[u.homeId]?.name : undefined,
    driverRating: u.driver.ratingCount ? Math.round((u.driver.ratingSum / u.driver.ratingCount) * 10) / 10 : undefined,
    look: u.look, online: g.isOnline(u.id),
    isFriend: !!viewer && viewer.friends.includes(u.id),
    followsYou: !!viewer && u.following.includes(viewer.id),
    youFollow: !!viewer && viewer.following.includes(u.id),
  };
}

function validateLook(u: UserRec, look: Look): Look {
  assert(look && typeof look === 'object', 'Invalid look');
  const out: Look = {
    body: look.body === 'f' ? 'f' : 'm',
    skin: SKIN_TONES.includes(look.skin) ? look.skin : SKIN_TONES[3],
    hairStyle: clamp(Math.floor(Number(look.hairStyle) || 0), 0, 7),
    hairColor: HAIR_COLORS.includes(look.hairColor) ? look.hairColor : HAIR_COLORS[0],
    eyeColor: EYE_COLORS.includes(look.eyeColor) ? look.eyeColor : EYE_COLORS[0],
    height: clamp(Number(look.height) || 1, 0.9, 1.1),
    build: clamp(Number(look.build) || 1, 0.85, 1.2),
    outfit: {}, colors: {},
  };
  for (const [slot, id] of Object.entries(look.outfit ?? {}) as [Slot, string][]) {
    if (!id) continue;
    const c = CLOTHING_BY_ID[id];
    assert(c && c.slot === slot, 'Unknown clothing item');
    assert(u.wardrobe.includes(id), `You don't own ${c.name}`);
    out.outfit[slot] = id;
    const col = look.colors?.[slot];
    out.colors[slot] = col && c.colors.includes(col) ? col : c.colors[0];
  }
  assert(out.outfit.top && out.outfit.bottom && out.outfit.shoes, 'You need a top, bottoms and shoes');
  return out;
}

export function register(g: Game) {
  const A = g.actions;

  A['profile.setLook'] = (u, { look }) => { u.look = validateLook(u, look); };
  A['profile.setCareer'] = (u, { career }) => {
    assert(g.careerValid(career), 'Unknown career');
    if (u.career !== career) g.log(u, 'career', `Changed career focus to ${career}.`);
    u.career = career;
  };
  A['profile.setPrivacy'] = (u, { privacy }) => {
    const p = privacy ?? {};
    u.privacy = {
      showBalance: !!p.showBalance, showPortfolio: !!p.showPortfolio, showVehicles: !!p.showVehicles, showHome: !!p.showHome,
      allowDMs: p.allowDMs === 'friends' ? 'friends' : 'everyone',
    };
  };
  A['profile.get'] = (u, { username }) => {
    const t = g.mustUser(username);
    return publicProfile(g, u, t);
  };
  A['profile.saveOutfit'] = (u, { name }) => {
    const n = g.clean(name, 24) || `Outfit ${u.outfits.length + 1}`;
    u.outfits = [...u.outfits.filter((o) => o.name !== n), { name: n, outfit: { ...u.look.outfit }, colors: { ...u.look.colors } }].slice(-8);
  };
  A['profile.loadOutfit'] = (u, { name }) => {
    const o = u.outfits.find((x) => x.name === name);
    assert(o, 'No such outfit');
    u.look = validateLook(u, { ...u.look, outfit: o.outfit, colors: o.colors });
  };
  A['profile.deleteOutfit'] = (u, { name }) => { u.outfits = u.outfits.filter((x) => x.name !== name); };

  // ---------- zones ----------
  A['zone.enter'] = (u, { zone }) => {
    zone = String(zone);
    const pres = g.presence.get(u.id);
    if (zone.startsWith('home:')) {
      const ownerId = zone.slice(5);
      const owner = g.db.users[ownerId];
      assert(owner, 'Unknown home');
      const prop = PROPERTY_BY_ID[owner.homeId];
      if (ownerId !== u.id) {
        const invited = owner.homeInvites.some((i) => i.id === u.id && i.until > Date.now());
        assert(invited || owner.friends.includes(u.id), `@${owner.username} hasn't invited you.`);
        assert(g.isOnline(ownerId), `@${owner.username} isn't home right now.`);
      }
      if (pres) pres.z = zone;
      u.lastZone = zone;
      const op = owner.properties.find((p) => p.id === owner.homeId)!;
      return { zone, home: { ownerId, owner: owner.username, property: prop.id, layout: prop.layout, placements: op.placements, tier: prop.tier, achievements: owner.achievements } };
    }
    const f = FEATURE_BY_ZONE[zone];
    assert(f, 'Unknown place');
    assert(g.nearDoor(u, zone), 'Walk up to the entrance first.');
    if (RESIDENCES.includes(zone)) {
      const home = PROPERTY_BY_ID[u.homeId];
      if (home.building !== zone) {
        const mine = u.properties.find((p) => PROPERTY_BY_ID[p.id].building === zone);
        assert(mine, `Residents only. Your home is in ${FEATURE_BY_ZONE[home.building].name}. Visit Keystone Realty to move.`);
        u.homeId = mine.id;
      }
      return A['zone.enter'](u, { zone: 'home:' + u.id }, g);
    }
    if (zone === 'whaleclub') {
      const nw = g.netWorth(u);
      assert(nw >= 50_000, `The Whale Club requires a net worth of $50,000 (yours: $${Math.round(nw).toLocaleString()}).`);
      g.achieve(u, 'whale');
    }
    if (pres) pres.z = zone;
    u.lastZone = zone;
    questHook(g, u, 'visit', { zone });
    return { zone };
  };
  A['zone.exit'] = (u) => {
    const pres = g.presence.get(u.id);
    const from = g.zoneOf(u);
    if (pres) pres.z = 'street';
    u.lastZone = 'street';
    let door = doorOf(from);
    if (from.startsWith('home:')) {
      const owner = g.db.users[from.slice(5)];
      door = doorOf(owner ? PROPERTY_BY_ID[owner.homeId].building : 'apt_starter');
    }
    return { zone: 'street', door };
  };

  // ---------- homes ----------
  A['property.list'] = (u) => PROPERTIES.map((p) => ({ ...p, owned: u.properties.find((x) => x.id === p.id)?.mode ?? null, current: u.homeId === p.id }));
  A['property.buy'] = (u, { id }) => {
    g.requireZone(u, 'realestate');
    const p = PROPERTY_BY_ID[id];
    assert(p && p.price > 0, 'Unknown property');
    const ex = u.properties.find((x) => x.id === id);
    assert(!ex || ex.mode !== 'own', 'You already own this');
    g.debit(u, p.price, 'purchase', `Bought ${p.name}`);
    if (ex) ex.mode = 'own'; else u.properties.push({ id, mode: 'own', since: Date.now(), placements: [] });
    u.homeId = id;
    g.achieve(u, 'homeowner'); g.achieve(u, 'moved_up');
    g.addRep(u, 'community', 2);
    g.log(u, 'home', `Bought ${p.name} for $${p.price.toLocaleString()}.`);
    return { ok: true };
  };
  A['property.rent'] = (u, { id }) => {
    g.requireZone(u, 'realestate');
    const p = PROPERTY_BY_ID[id];
    assert(p && p.rent > 0, 'Unknown property');
    assert(!u.properties.find((x) => x.id === id), 'You already have this property');
    g.debit(u, p.rent, 'rent', `First day's rent — ${p.name}`);
    u.properties.push({ id, mode: 'rent', since: Date.now(), placements: [] });
    u.homeId = id;
    g.achieve(u, 'moved_up');
    g.log(u, 'home', `Moved into ${p.name} (renting at $${p.rent}/day).`);
  };
  A['property.endLease'] = (u, { id }) => {
    const ex = u.properties.find((x) => x.id === id && x.mode === 'rent');
    assert(ex, 'No lease on that property');
    // furniture placed there returns to storage
    u.properties = u.properties.filter((x) => x !== ex);
    if (u.homeId === id) u.homeId = 'starter';
  };
  A['property.setHome'] = (u, { id }) => {
    assert(u.properties.find((x) => x.id === id), "You don't have that property");
    u.homeId = id;
  };
  A['home.invite'] = (u, { username }) => {
    const t = g.mustUser(username);
    assert(t.id !== u.id, 'That is you');
    u.homeInvites = [...u.homeInvites.filter((i) => i.until > Date.now() && i.id !== t.id), { id: t.id, until: Date.now() + 30 * 60_000 }];
    g.io.send(t.id, { t: 'invite', kind: 'home', from: u.username, ownerId: u.id, text: `@${u.username} invited you to their home (${PROPERTY_BY_ID[u.homeId].name}).` });
  };
  A['home.sleep'] = (u) => {
    assert(g.isOwnHome(u), 'You can only sleep in your own bed.');
    const now = Date.now();
    u.buffs.rested = now + 20 * 60_000;
    const others = [...g.presence.keys()].filter((id) => id !== u.id).length;
    let advanced = false;
    if (others === 0) {
      // solo in the city: fast-forward the shared clock to the next 07:00
      const m = g.gameMinutes(now);
      const dayStart = Math.floor(m / 1440) * 1440;
      let target = dayStart + 7 * 60;
      if (target <= m + 30) target += 1440;
      g.db.timeOffset += target - m;
      advanced = true;
      g.io.broadcast({ t: 'time', clock: g.clock() });
    }
    return { advanced, minutes: g.gameMinutes() };
  };

  // ---------- furniture ----------
  A['furniture.buy'] = (u, { id }) => {
    g.requireZone(u, 'furniture');
    const f = FURNITURE_BY_ID[id];
    assert(f, 'Unknown item');
    g.debit(u, f.price, 'purchase', `Furniture: ${f.name}`);
    u.furniture[id] = (u.furniture[id] ?? 0) + 1;
    g.notify(u, `${f.name} delivered to your storage. Place it from your home (press E at the laptop or use Decorate).`, 'info');
  };
  A['furniture.place'] = (u, { slot, item }) => {
    assert(g.isOwnHome(u), 'Go home to decorate.');
    const prop = u.properties.find((p) => p.id === u.homeId)!;
    const def = PROPERTY_BY_ID[u.homeId];
    slot = Math.floor(Number(slot));
    assert(slot >= 0 && slot < def.slots, 'Invalid spot');
    // count usage across all properties
    const used = (id: string) => u.properties.reduce((s, p) => s + p.placements.filter((x) => x.item === id).length, 0);
    prop.placements = prop.placements.filter((p) => p.slot !== slot);
    if (item) {
      assert(FURNITURE_BY_ID[item], 'Unknown item');
      assert((u.furniture[item] ?? 0) > used(item), `No unplaced ${FURNITURE_BY_ID[item].name} in storage.`);
      prop.placements.push({ slot, item });
    }
    return { placements: prop.placements };
  };

  // ---------- clothing ----------
  A['shop.buyClothing'] = (u, { id }) => {
    g.requireZone(u, 'boutique');
    const c = CLOTHING_BY_ID[id];
    assert(c, 'Unknown item');
    assert(!u.wardrobe.includes(id), 'Already in your wardrobe');
    g.debit(u, c.price, 'purchase', `Clothing: ${c.name}`);
    u.wardrobe.push(id);
  };

  // ---------- food & nightlife ----------
  A['food.order'] = (u, { venue, item }) => {
    const menu = MENUS[venue];
    assert(menu, 'Unknown venue');
    g.requireZone(u, venue);
    const it = menu.find((m) => m.id === item);
    assert(it, 'Not on the menu');
    g.debit(u, it.price, 'food', `${it.name} at ${FEATURE_BY_ZONE[venue].name}`);
    u.buffs.fed = Date.now() + 15 * 60_000;
    const count = u.txs.filter((t) => t.kind === 'food').length;
    if (count >= 5) g.achieve(u, 'foodie');
    if (venue === 'club' && item === 'bottle') u.vipUntil = Math.max(u.vipUntil, Date.now() + 30 * 60_000);
    return { item: it };
  };
  A['club.vip'] = (u) => {
    g.requireZone(u, 'club');
    if (u.vipUntil > Date.now()) return { until: u.vipUntil };
    g.debit(u, VIP_PRICE, 'nightlife', 'VIP table reservation — Liquidity Nightclub (30 min)');
    u.vipUntil = Date.now() + 30 * 60_000;
    return { until: u.vipUntil };
  };
  A['club.vipCheck'] = (u) => {
    g.requireZone(u, 'club');
    const friendsVip = u.friends.some((id) => (g.db.users[id]?.vipUntil ?? 0) > Date.now() && g.zoneOf(g.db.users[id]) === 'club');
    assert(u.vipUntil > Date.now() || friendsVip, `VIP area: reserve a table ($${VIP_PRICE}) or join a friend who has one.`);
    return { ok: true };
  };
  A['activity.dance'] = (u, { secs }) => {
    const s = clamp(Number(secs) || 0, 0, 30);
    u.dancedSecs += s;
    if (u.dancedSecs > 300) g.achieve(u, 'dancer');
    g.addXp(u, 'community', Math.floor(s / 10));
  };
  A['activity.home'] = (u, { what }) => {
    assert(g.isOwnHome(u) || g.zoneOf(u).startsWith('home:'), 'Only at home');
    // small, capped rewards for home activities (books -> research, rig -> trading practice, gym -> rested)
    g.rateLimit(u.id + ':home:' + what, 1, 60_000);
    if (what === 'read') g.addXp(u, 'research', 8);
    else if (what === 'rig') g.addXp(u, 'trading', 8);
    else if (what === 'gym') u.buffs.rested = Math.max(u.buffs.rested, Date.now() + 10 * 60_000);
    else if (what === 'cook') u.buffs.fed = Date.now() + 15 * 60_000;
    else if (what === 'shower') u.buffs.rested = Math.max(u.buffs.rested, Date.now() + 5 * 60_000);
    return { ok: true };
  };

  // ---------- leaderboards & history ----------
  A['leaderboard'] = (_u, { cat }) => {
    const users = Object.values(g.db.users);
    const score: Record<string, (x: UserRec) => number> = {
      wealth: (x) => g.netWorth(x),
      reputation: (x) => g.reputation(x),
      trading: (x) => {
        const sells = x.fills.filter((f) => f.side === 'sell' && f.pnl !== undefined);
        if (sells.length < 3) return 0;
        const pnl = sells.reduce((s, f) => s + (f.pnl ?? 0), 0);
        const wins = sells.filter((f) => (f.pnl ?? 0) > 0).length / sells.length;
        return Math.round(pnl * (0.5 + wins)); // rewards consistency, not one lucky bet
      },
      founders: (x) => x.projects.reduce((s, id) => s + (g.db.projects[id]?.users ?? 0), 0),
      investors: (x) => x.skills.investing + x.stakes.reduce((s, k) => s + k.accrued, 0),
      kols: (x) => x.likers.length * 3 + x.followerIds.filter((id) => levelFromXp(g.db.users[id]?.xp ?? 0) >= 2).length,
      airdrop: (x) => x.airdropWins,
      developers: (x) => x.skills.dev,
      drivers: (x) => (x.driver.ratingCount ? x.driver.rides * (x.driver.ratingSum / x.driver.ratingCount) : 0),
      social: (x) => x.followerIds.filter((id) => levelFromXp(g.db.users[id]?.xp ?? 0) >= 2).length,
    };
    const f = score[cat] ?? score.reputation;
    const hide = cat === 'wealth';
    return users
      .map((x) => ({ name: x.username, career: x.career, level: levelFromXp(x.xp), score: f(x), hidden: hide && !x.privacy.showPortfolio }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((r) => (r.hidden ? { ...r, score: -1 } : r));
  };

  A['summary'] = (u) => {
    // built ONLY from recorded journey entries + stats
    const lines: string[] = [];
    const first = (k: string) => u.journey.find((j) => j.kind === k);
    const all = (k: string) => u.journey.filter((j) => j.kind === k);
    const s = first('start'); if (s) lines.push(s.text);
    for (const k of ['career', 'job', 'trade', 'home', 'car', 'airdrop', 'event', 'friend', 'project', 'hire', 'raise', 'launch', 'driver', 'dao', 'level']) {
      const es = all(k);
      if (!es.length) continue;
      lines.push(es[0].text + (es.length > 1 ? ` (+${es.length - 1} more)` : ''));
    }
    const sells = u.fills.filter((f) => f.side === 'sell');
    const pnl = sells.reduce((a, f) => a + (f.pnl ?? 0), 0);
    return {
      season: g.db.season.n,
      lines,
      stats: {
        netWorth: g.netWorth(u), level: levelFromXp(u.xp), reputation: g.reputation(u), trades: u.fills.length,
        realizedPnl: Math.round(pnl * 100) / 100, shifts: u.job?.shifts ?? 0, rides: u.driver.rides, achievements: u.achievements.length,
        topSkill: SKILLS.reduce((a, b) => (u.skills[a] >= u.skills[b] ? a : b)),
      },
    };
  };
}
