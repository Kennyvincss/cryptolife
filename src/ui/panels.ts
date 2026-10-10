// In-world terminal panels (shops, counters, workstations, garages…).

import {
  CLOTHING, CLOTHING_BY_ID, EYE_COLORS, FURNITURE, FURNITURE_BY_ID, HAIR_COLORS, HAIR_STYLES, MENUS, PAINTS, PAINT_PRICE, POOLS, PROPERTIES,
  PROPERTY_BY_ID, RIMS, SKIN_TONES, UPGRADE_PRICE, VEHICLES, VEHICLE_BY_ID, VIP_PRICE,
  PEOPLE,
} from '../../shared/catalog.js';
import { FEATURE_BY_ZONE } from '../../shared/city.js';
import type { Challenge, Look, ProjectRecord, Slot } from '../../shared/types.js';
import { api } from '../api.js';
import { audio } from '../audio/audio.js';
import { act } from '../net/client.js';
import { fmt, store } from '../state.js';
import { APP_BY_ID, type AppCtx } from './apps.js';
import { challengeView, run, toast } from './components.js';
import { SIM, add, badge, btn, h, input, invalidate, useData } from './dom.js';

export interface Panel { title: string | ((d: any) => string); wide?: boolean; render: (el: HTMLElement, rr: () => void, data: any, ctx: AppCtx) => void; onClose?: () => void }

const sub = (t: string) => h('h4.sub', t);
const VENUE_NAME = (v: string) => FEATURE_BY_ZONE[v]?.name ?? v;

// ------------------------------------------------------------- food
const menu: Panel = {
  title: (d) => `Menu — ${VENUE_NAME(d?.venue)}`,
  render(el, _rr, d) {
    const items = MENUS[d.venue] ?? [];
    add(el, h('small.muted', 'Prices in simulated currency. Food is optional — it gives a temporary +10% XP “well fed” bonus.'),
      items.map((it) => h('div.item', h('div', h('b', it.name), h('small.muted', ` · ${it.kind}`)), h('div', h('span', fmt.usd(it.price) + ' '), btn('Order', async () => {
        const r = await run(act('food.order', { venue: d.venue, item: it.id }));
        if (r) { toast(`Enjoy your ${it.name}!`, 'ok'); api.hold(it.model); if (api.isSeated()) api.emote('eat', 12); api.closePanel(); }
      }, 'primary small')))));
  },
};

// ------------------------------------------------------------- clothing
let wardSlot: Slot = 'top';
let draft: Look | null = null;
function lookDraft(): Look { if (!draft) draft = JSON.parse(JSON.stringify(store.me!.look)); return draft!; }
const SLOTS: Slot[] = ['top', 'bottom', 'shoes', 'hat', 'glasses', 'watch', 'chain', 'bag'];

const boutique: Panel = {
  title: 'HODL Threads', wide: true,
  render(el, rr) {
    const me = store.me!;
    const L = lookDraft();
    add(el, h('div.seg.small', SLOTS.map((s) => btn(s, () => { wardSlot = s; rr(); }, wardSlot === s ? 'on' : ''))),
      h('div.grid', CLOTHING.filter((c) => c.slot === wardSlot).map((c) => {
        const owned = me.wardrobe.includes(c.id);
        return h('div.tile' + (L.outfit[c.slot] === c.id ? '.sel' : ''),
          h('b', c.name), h('div', owned ? badge('owned', 'ok') : fmt.usd(c.price)),
          h('div.swatches', c.colors.map((col) => h('span.swatch' + (L.outfit[c.slot] === c.id && L.colors[c.slot] === col ? '.on' : ''), { style: { background: col }, onclick: () => { L.outfit[c.slot] = c.id; L.colors[c.slot] = col; api.previewLook(L); rr(); } }))),
          h('div', btn('Try on', () => { L.outfit[c.slot] = c.id; L.colors[c.slot] = L.colors[c.slot] && c.colors.includes(L.colors[c.slot]!) ? L.colors[c.slot] : c.colors[0]; api.previewLook(L); rr(); }, 'ghost small'),
            owned ? null : btn(`Buy ${fmt.usd(c.price)}`, () => run(act('shop.buyClothing', { id: c.id }), `Bought ${c.name}`), 'primary small')));
      })),
      h('div.row', btn('Wear outfit', async () => {
        const missing = Object.values(L.outfit).filter((id) => id && !me.wardrobe.includes(id));
        if (missing.length) { toast('Buy the items you are trying on first: ' + missing.map((m) => CLOTHING_BY_ID[m!].name).join(', '), 'warn'); return; }
        const r = await run(act('profile.setLook', { look: L }), 'Outfit updated');
        if (r !== undefined) { draft = null; api.previewLook(null); }
      }, 'primary'), btn('Reset', () => { draft = null; api.previewLook(null); rr(); }, 'ghost'), wardSlot !== 'top' && wardSlot !== 'bottom' && wardSlot !== 'shoes' ? btn('Remove ' + wardSlot, () => { delete L.outfit[wardSlot]; api.previewLook(L); rr(); }, 'ghost') : null),
    );
  },
  onClose() { draft = null; api.previewLook(null); },
};

const wardrobe: Panel = {
  title: 'Wardrobe', wide: true,
  render(el, rr) {
    const me = store.me!;
    const L = lookDraft();
    add(el, h('div.seg.small', SLOTS.map((s) => btn(s, () => { wardSlot = s; rr(); }, wardSlot === s ? 'on' : ''))),
      h('div.grid', [...me.wardrobe.map((id) => CLOTHING_BY_ID[id]).filter((c) => c && c.slot === wardSlot).map((c) => h('div.tile' + (L.outfit[c.slot] === c.id ? '.sel' : ''), h('b', c.name),
        h('div.swatches', c.colors.map((col) => h('span.swatch' + (L.outfit[c.slot] === c.id && L.colors[c.slot] === col ? '.on' : ''), { style: { background: col }, onclick: () => { L.outfit[c.slot] = c.id; L.colors[c.slot] = col; api.previewLook(L); rr(); } }))))),
        ['hat', 'glasses', 'watch', 'chain', 'bag'].includes(wardSlot) ? h('div.tile', h('b', 'None'), btn('Remove', () => { delete L.outfit[wardSlot]; api.previewLook(L); rr(); }, 'ghost small')) : null]),
      h('div.row', btn('Save look', () => run(act('profile.setLook', { look: L }), 'Changed clothes').then(() => { draft = null; api.previewLook(null); }), 'primary'), btn('Reset', () => { draft = null; api.previewLook(null); rr(); }, 'ghost')),
      sub('Saved outfits'),
      h('div.chips', me.outfits.map((o) => h('span.chip', btn(o.name, () => run(act('profile.loadOutfit', { name: o.name }), 'Outfit on').then(() => { draft = null; api.previewLook(null); }), 'ghost small'), btn('✕', () => run(act('profile.deleteOutfit', { name: o.name })), 'ghost small')))),
      btn('Save current outfit', () => { const n = prompt('Outfit name?'); if (n) run(act('profile.saveOutfit', { name: n }), 'Outfit saved'); }, 'ghost'),
      h('small.muted', 'Buy more clothes at HODL Threads (Social District).'));
  },
  onClose() { draft = null; api.previewLook(null); },
};

const mirror: Panel = {
  title: 'Mirror — appearance',
  render(el, rr) {
    const L = lookDraft();
    const set = (fn: () => void) => { fn(); api.previewLook(L); rr(); };
    add(el, h('small.muted', 'Appearance changes are free.'),
      h('div.seg.small', btn('Masc', () => set(() => { L.body = 'm'; L.model = 0; }), L.body === 'm' ? 'on' : ''), btn('Fem', () => set(() => { L.body = 'f'; L.model = 0; }), L.body === 'f' ? 'on' : '')),
      sub('Person'), h('div.chips', PEOPLE[L.body].map((p, i) => btn(p.name, () => set(() => (L.model = i)), (L.model ?? 0) === i ? 'on small' : 'ghost small'))),
      h('label.field', h('span', 'Height'), h('input', { type: 'range', min: 0.9, max: 1.1, step: 0.01, value: L.height, onchange: (e: Event) => set(() => (L.height = Number((e.target as HTMLInputElement).value))) })),
      h('label.field', h('span', 'Build'), h('input', { type: 'range', min: 0.85, max: 1.2, step: 0.01, value: L.build, onchange: (e: Event) => set(() => (L.build = Number((e.target as HTMLInputElement).value))) })),
      h('div.row', btn('Save', () => run(act('profile.setLook', { look: L }), 'Looking good').then(() => { draft = null; api.previewLook(null); }), 'primary'), btn('Reset', () => { draft = null; api.previewLook(null); rr(); }, 'ghost')));
  },
  onClose() { draft = null; api.previewLook(null); },
};

// ------------------------------------------------------------- homes
const furniture: Panel = {
  title: 'Nest & Node — Catalog', wide: true,
  render(el) {
    const me = store.me!;
    const cats = [...new Set(FURNITURE.map((f) => f.cat))];
    add(el, h('small.muted', 'Purchases go to storage. Place them at home via the toolbox (Decorate). Higher tier homes have more spots.'),
      cats.map((c) => h('div', sub(c), h('div.grid', FURNITURE.filter((f) => f.cat === c).map((f) => h('div.tile', h('b', f.name), h('div', fmt.usd(f.price), ' ', SIM()), f.use ? h('small.muted', '▸ ' + f.use) : null, f.bonus ? h('small.up', f.bonus) : null, h('small.muted', `Owned: ${me.furniture[f.id] ?? 0}`), btn('Buy', () => run(act('furniture.buy', { id: f.id })), 'primary small')))))));
  },
};

const decorate: Panel = {
  title: 'Decorate your home', wide: true,
  render(el) {
    const me = store.me!;
    const prop = me.properties.find((p) => p.id === me.homeId)!;
    const def = PROPERTY_BY_ID[me.homeId];
    const used = (id: string) => me.properties.reduce((s, p) => s + p.placements.filter((x) => x.item === id).length, 0);
    const avail = Object.entries(me.furniture).filter(([id, n]) => n - used(id) > 0);
    add(el, h('small.muted', `${def.name}: ${def.slots} furniture spots. Changes appear when you re-enter the room.`),
      h('div.grid', Array.from({ length: def.slots }, (_, slot) => {
        const placed = prop.placements.find((p) => p.slot === slot);
        return h('div.tile', h('b', `Spot ${slot + 1}`), h('div', placed ? FURNITURE_BY_ID[placed.item]?.name : h('span.muted', 'empty')),
          placed ? btn('Remove', () => run(act('furniture.place', { slot, item: null }), 'Moved to storage'), 'ghost small') : null,
          avail.map(([id]) => btn('Place ' + FURNITURE_BY_ID[id].name, () => run(act('furniture.place', { slot, item: id }), 'Placed — re-enter to see it'), 'small')));
      })),
      btn('Re-enter room to refresh', () => { api.closePanel(); api.enterZone('home:' + me.id); }, 'primary'),
      !avail.length ? h('p.muted', 'Storage is empty. Buy furniture at Nest & Node (Social District).') : null);
  },
};

const realestate: Panel = {
  title: 'Keystone Realty', wide: true,
  render(el) {
    const me = store.me!;
    add(el, h('small.muted', 'Rent is charged once per in-game day while you are online. If you can’t pay, the lease ends — your furniture stays in storage and your starter apartment is always yours.'),
      h('div.grid', PROPERTIES.map((p) => {
        const own = me.properties.find((x) => x.id === p.id);
        return h('div.tile' + (me.homeId === p.id ? '.sel' : ''), h('b', p.name), h('div.muted', p.desc), h('div', `${p.layout} layout · ${p.slots} furniture spots · ${p.garage} garage`),
          h('div', p.price ? `Buy ${fmt.usd(p.price, 0)} · Rent ${fmt.usd(p.rent, 0)}/day ` : 'Free starter ', SIM()),
          own ? h('div', badge(own.mode === 'starter' ? 'yours' : own.mode, 'ok'), me.homeId !== p.id ? btn('Move in', () => run(act('property.setHome', { id: p.id }), 'Home updated'), 'small') : badge('current home'), own.mode === 'rent' ? btn('End lease', () => confirm('End lease?') && run(act('property.endLease', { id: p.id }), 'Lease ended'), 'ghost small') : null, own.mode === 'rent' ? btn(`Buy ${fmt.usd(p.price, 0)}`, () => run(act('property.buy', { id: p.id }), 'Purchased!'), 'primary small') : null)
            : p.price ? h('div', btn(`Rent ${fmt.usd(p.rent, 0)}/day`, () => run(act('property.rent', { id: p.id }), 'Lease signed! It’s now your home.'), 'small'), btn(`Buy ${fmt.usd(p.price, 0)}`, () => run(act('property.buy', { id: p.id }), 'Purchased! It’s now your home.'), 'primary small')) : null);
      })));
  },
};

// ------------------------------------------------------------- vehicles
let dealColor = '';
const dealer: Panel = {
  title: (d) => (d?.model ? VEHICLE_BY_ID[d.model]?.name ?? 'Vehicle' : 'Showroom'), wide: true,
  render(el, rr, d) {
    const used = api.zone() === 'usedcars';
    const list = VEHICLES.filter((v) => !!v.used === used);
    const m = d?.model ? VEHICLE_BY_ID[d.model] : null;
    if (!m) { add(el, h('div.grid', list.map((v) => h('div.tile', h('b', v.name), h('div', fmt.usd(v.price, 0)), btn('Details', () => api.panel('dealer', { model: v.id }), 'small'))))); return; }
    const col = dealColor || m.color;
    add(el, h('div.card', h('div.muted', m.cat + (m.used ? ' · pre-owned' : ' · new') + (m.electric ? ' · electric' : '')), h('div.big', fmt.usd(m.price, 0), ' ', SIM()),
      h('div.statbars', [['Top speed', m.top / 82], ['Acceleration', m.accel / 21], ['Handling', m.grip / 1.15]].map(([n, v]) => h('div.skill', h('span', n as string), h('div.bar', h('i', { style: { width: Math.round((v as number) * 100) + '%' } }))))),
      h('div', `${Math.round(m.top * 3.6)} km/h · ${m.seats} seat(s)${m.seats > 1 ? ' · CityRide eligible' : ''}`),
      sub('Color'), h('div.swatches', PAINTS.map((c) => h('span.swatch' + (col === c ? '.on' : ''), { style: { background: c }, onclick: () => { dealColor = c; rr(); } }))),
      h('div.row', btn(`Buy for ${fmt.usd(m.price, 0)}`, async () => { const r = await run(act('vehicle.buy', { model: m.id, color: col }), `You bought a ${m.name}!`); if (r) { api.closePanel(); api.callVehicle((r as any).uid); } }, 'primary'),
        btn('Test drive (90s)', async () => { const r = await run(act('vehicle.testDrive', { model: m.id })); if (r) { api.closePanel(); api.testDrive(m.id); } }, 'ghost'))));
  },
};

const sellcar: Panel = {
  title: 'Second Block — buy & sell', wide: true,
  render(el) {
    const me = store.me!;
    add(el, sub('Pre-owned for sale'), h('div.grid', VEHICLES.filter((v) => v.used).map((v) => h('div.tile', h('b', v.name), h('div', fmt.usd(v.price, 0), ' ', SIM()), btn('Details', () => api.panel('dealer', { model: v.id }), 'small')))),
      sub('Sell one of yours (≈60% of list, less damage)'),
      me.vehicles.length ? me.vehicles.map((v) => { const d = VEHICLE_BY_ID[v.model]; const est = d.price * 0.6 * (1 - v.damage / 200) + (v.engine + v.handling) * 200; return h('div.item', h('div', h('b', d.name), h('small.muted', ` condition ${100 - Math.round(v.damage)}%`)), btn(`Sell ≈ ${fmt.usd(est, 0)}`, () => confirm(`Sell your ${d.name}?`) && run(act('vehicle.sell', { id: v.uid }), 'Sold'), 'ghost')); }) : h('p.muted', 'You have no vehicles.'));
  },
};

let custSel = '';
const customs: Panel = {
  title: 'Gwei Customs', wide: true,
  render(el, rr) {
    const me = store.me!;
    if (!me.vehicles.length) { add(el, h('p', 'You don’t own a vehicle yet.')); return; }
    const v = me.vehicles.find((x) => x.uid === custSel) ?? me.vehicles.find((x) => x.uid === me.activeVehicle) ?? me.vehicles[0];
    custSel = v.uid;
    const d = VEHICLE_BY_ID[v.model];
    const repair = Math.round((v.damage * d.price * 0.0015 + (v.damage > 0 ? 15 : 0)) * 100) / 100;
    add(el, h('div.chips', me.vehicles.map((x) => btn(VEHICLE_BY_ID[x.model].name, () => { custSel = x.uid; rr(); }, x.uid === v.uid ? 'on small' : 'ghost small'))),
      h('div.card', h('h3', d.name), h('div', `Condition ${100 - Math.round(v.damage)}%`), v.damage > 0 ? btn(`Repair ${fmt.usd(repair)}`, () => run(act('vehicle.repair', { id: v.uid }), 'Repaired'), 'primary') : badge('Perfect condition', 'ok')),
      sub(`Paint (${fmt.usd(PAINT_PRICE)})`), h('div.swatches', PAINTS.map((c) => h('span.swatch' + (v.color === c ? '.on' : ''), { style: { background: c }, onclick: () => c !== v.color && run(act('vehicle.customize', { id: v.uid, color: c }), 'Fresh paint!') }))),
      sub('Rims'), h('div.chips', RIMS.map((r) => btn(`${r.name} ${r.price ? fmt.usd(r.price, 0) : ''}`, () => r.id !== v.rims && run(act('vehicle.customize', { id: v.uid, rims: r.id }), 'Rims fitted'), v.rims === r.id ? 'on small' : 'ghost small'))),
      sub('Performance'),
      ...(['engine', 'handling'] as const).map((k) => h('div.item', h('div', h('b', k), ` level ${v[k]}/3`), v[k] < 3 ? btn(`Upgrade ${fmt.usd(UPGRADE_PRICE[v[k] + 1], 0)}`, () => run(act('vehicle.customize', { id: v.uid, [k]: v[k] + 1 }), 'Upgraded'), 'small') : badge('max', 'ok'))));
  },
};

const transport: Panel = {
  title: 'CityRide HQ',
  render(el) {
    const me = store.me!;
    let fname = '';
    add(el, h('div.card', h('h3', 'Driver registration'), me.driver.registered ? h('div.up', '✔ Registered. Open the Drive app in your car to go on duty.') : btn('Register as driver', () => run(act('driver.register'), 'Welcome to CityRide!'), 'primary'),
      h('small.muted', 'Requirements: own a vehicle with passenger seats. Earnings are simulated currency (85% of fare).')),
      h('div.card', h('h3', 'Transport company'), me.fleet ? h('div', `${me.fleet.name}: ${me.fleet.drivers.length} drivers. Manage in the Drive app.`) : h('div', h('div.muted', 'Requires 5 completed rides and a $5,000 registration fee.'), input({ placeholder: 'Company name', oninput: (e: Event) => (fname = (e.target as HTMLInputElement).value) }), btn('Found company', () => run(act('fleet.create', { name: fname }), 'Company founded!'), 'primary'))));
  },
};

const callcar: Panel = {
  title: 'Vehicle delivery',
  render(el, _rr, d) {
    const v = store.me!.vehicles.find((x) => x.uid === d?.uid);
    if (!v) { add(el, h('p', 'Vehicle not found.')); return; }
    add(el, h('p', `Your ${VEHICLE_BY_ID[v.model].name} will be parked at the nearest curb. (Valet delivery — a convenience feature; you need to be outdoors.)`), btn('Deliver it', () => { api.callVehicle(v.uid); api.closePanel(); }, 'primary'));
  },
};

// ------------------------------------------------------------- work
let workChallenge: Challenge | null = null;
const work: Panel = {
  title: 'Workstation',
  render(el, rr) {
    const j = store.me!.job;
    if (!j) { add(el, h('p', 'You need a job here.')); return; }
    if (workChallenge) {
      const box = h('div');
      add(el, h('h4', `${j.title} — ${j.company}`), box);
      challengeView(box, workChallenge, (answer) => act('jobs.submit', { id: workChallenge!.id, answer }), () => { workChallenge = null; api.closePanel(); });
      return;
    }
    const wait = Math.max(0, j.lastShift + 90_000 - Date.now());
    add(el, h('div.card', h('h3', j.title), h('div', j.company, ' · ', fmt.usd(j.pay), '/shift ', SIM()), h('div.muted', `${j.shifts} shifts so far. Correct work pays in full; mistakes pay 30%.`),
      wait > 0 ? h('div', `Next shift available in ${Math.ceil(wait / 1000)}s`) : btn('Start shift', async () => { const c = await run(act('jobs.startShift')); if (c) { workChallenge = c; rr(); } }, 'primary')));
    if (wait > 0) setTimeout(rr, 1000);
  },
  onClose() { workChallenge = null; api.stand(); },
};

const pitch: Panel = {
  title: 'Pitch to Seed Round Tower',
  render(el) {
    const me = store.me!;
    const { data } = useData<ProjectRecord[]>('projects', () => act('project.list'), 8000, () => api.panel('pitch'));
    const mine = me.projects.map((id) => (data ?? []).find((p) => p.id === id)).filter(Boolean) as ProjectRecord[];
    add(el, h('small.muted', 'VCs weigh progress, users, project & founder reputation, and current market sentiment. You can pitch each project once every 5 minutes.'),
      mine.length ? mine.map((p) => h('div.item', h('div', h('b', p.name), h('div.muted', `${p.users} users · progress ${p.progress} · ${p.equitySold}% sold`)), btn('Pitch', async () => {
        const r = await run(act('project.pitch', { id: p.id }));
        if (r) toast(r.ok ? `Term sheet! Raised ${fmt.usd(r.raise)} at ${fmt.usd(r.valuation)}.` : `Passed (${Math.round(r.chance * 100)}% odds): “${r.feedback}”`, r.ok ? 'money' : 'warn');
        invalidate('projects');
      }, 'primary small'))) : h('p', 'You have no projects. Start one at Genesis Hub Coworking.'));
  },
  onClose() { api.stand(); },
};

// ------------------------------------------------------------- defi
let stakeAmt: Record<string, string> = {};
const defi: Panel = {
  title: 'Yield Plaza — Staking & Lending', wide: true,
  render(el) {
    const me = store.me!;
    add(el, h('div.banner.sim', 'Simulated DeFi. Yields are paid in simulated assets. The Yieldstone Vault can suffer exploits (principal haircut). Yield accrues ~30× faster than real time so it is visible in a session.'),
      POOLS.map((p) => h('div.item.col', h('div', h('b', p.name), ` · ${(p.apr * 100).toFixed(1)}% APR · risk: ${p.risk}`),
        h('div.muted', p.sym === 'USD' ? `Wallet: ${fmt.usd(me.cash)}` : `You hold ${fmt.qty(me.holdings[p.sym] ?? 0)} ${p.sym}`),
        h('div.row', input({ type: 'number', placeholder: `Amount (${p.sym === 'USD' ? '$' : p.sym})`, value: stakeAmt[p.id] ?? '', oninput: (e: Event) => (stakeAmt[p.id] = (e.target as HTMLInputElement).value) }), btn(p.sym === 'USD' ? 'Deposit' : 'Stake', () => run(act('defi.stake', { pool: p.id, amount: Number(stakeAmt[p.id]) }), 'Staked').then(() => (stakeAmt[p.id] = '')), 'primary small')))),
      h('h4.sub', 'Your positions'),
      me.stakes.length ? me.stakes.map((s) => h('div.item', h('div', h('b', POOLS.find((p) => p.id === s.pool)?.name ?? s.pool), h('div.muted', `${s.sym === 'USD' ? fmt.usd(s.amount) : fmt.qty(s.amount) + ' ' + s.sym} + accrued ${s.sym === 'USD' ? fmt.usd(s.accrued) : fmt.qty(s.accrued) + ' ' + s.sym}`)), btn('Withdraw', () => run(act('defi.unstake', { id: s.id }), 'Withdrawn'), 'ghost small'))) : h('p.muted', 'No positions.'));
  },
};

// ------------------------------------------------------------- nightlife
const vip: Panel = {
  title: 'VIP area',
  render(el) {
    const me = store.me!;
    add(el, h('p', `Reserve a VIP table for 30 minutes (${fmt.usd(VIP_PRICE)}, simulated). Friends of an active VIP holder can join them.`),
      btn('Enter VIP', async () => { const r = await run(act('club.vipCheck')); if (r) { api.closePanel(); api.teleportLocal(9.5, 7, 0.6); toast('Welcome to the VIP area.', 'ok'); } }, 'primary'),
      btn(`Reserve table ${fmt.usd(VIP_PRICE)}`, async () => { const r = await run(act('club.vip'), 'Table reserved'); if (r) { api.closePanel(); api.teleportLocal(9.5, 7, 0.6); } }, 'ghost'),
      h('small.muted', `Hosting a private night? Create a “party” event at Liquidity Nightclub in the Events app. ${me.friends.length ? '' : 'Make friends to share VIP access.'}`));
  },
};

const react: Panel = {
  title: 'React',
  render(el) {
    add(el, h('div.chips.big', ['👏', '🔥', '🚀', '😂', '❤️', '🤔'].map((e) => btn(e, () => run(act('events.react', { emoji: e })), 'ghost'))), h('small.muted', 'Everyone in the venue sees your reaction.'));
  },
};

// ------------------------------------------------------------- computer
const computer: Panel = {
  title: 'Home computer', wide: true,
  render(el, _rr, _d, ctx) {
    const ids = ['market', 'projects', 'jobs', 'wallet', 'social', 'messages', 'news', 'events', 'dao', 'airdrops', 'leaders', 'music', 'profile'];
    add(el, h('div.desktop', ids.map((id) => { const a = APP_BY_ID[id]; return h('div.dicon', { onclick: () => ctx.open(id) }, h('div.ic', { style: { background: a.color } }, a.icon), h('small', a.name)); })),
      h('small.muted', 'Tip: use the furniture store’s Six-Monitor Trading Rig for a trading XP bonus at home.'));
  },
};

// ------------------------------------------------------------- arcade
const arcade: Panel = {
  title: 'Block Breaker',
  render(el) {
    const c = h('canvas', { width: 480, height: 320, style: { width: '100%', background: '#05070c', borderRadius: '8px' } }) as HTMLCanvasElement;
    add(el, c, h('small.muted', 'Move the mouse to steer. Just for fun — no rewards.'));
    const x = c.getContext('2d')!;
    let px = 200, bx = 240, by = 250, vx = 160, vy = -200, score = 0, alive = true;
    const bricks: boolean[] = Array(40).fill(true);
    c.addEventListener('mousemove', (e) => { const r = c.getBoundingClientRect(); px = ((e.clientX - r.left) / r.width) * 480 - 40; });
    let last = performance.now();
    const loop = (t: number) => {
      if (!c.isConnected) return;
      const dt = Math.min(0.03, (t - last) / 1000); last = t;
      if (alive) {
        bx += vx * dt; by += vy * dt;
        if (bx < 5 || bx > 475) vx = -vx;
        if (by < 5) vy = -vy;
        if (by > 295 && by < 305 && bx > px && bx < px + 80) { vy = -Math.abs(vy) * 1.02; vx += (bx - (px + 40)) * 3; }
        if (by > 330) alive = false;
        bricks.forEach((b, i) => { if (!b) return; const rx = (i % 10) * 48 + 2, ry = Math.floor(i / 10) * 20 + 20; if (bx > rx && bx < rx + 44 && by > ry && by < ry + 16) { bricks[i] = false; vy = -vy; score += 10; } });
        if (bricks.every((b) => !b)) bricks.fill(true);
      }
      x.fillStyle = '#05070c'; x.fillRect(0, 0, 480, 320);
      bricks.forEach((b, i) => { if (b) { x.fillStyle = ['#ff2f9a', '#2fe6ff', '#ffd23f', '#38f2a5'][Math.floor(i / 10)]; x.fillRect((i % 10) * 48 + 2, Math.floor(i / 10) * 20 + 20, 44, 16); } });
      x.fillStyle = '#fff'; x.fillRect(px, 300, 80, 8); x.beginPath(); x.arc(bx, by, 6, 0, 7); x.fill();
      x.font = 'bold 16px Consolas'; x.fillText('SCORE ' + score, 10, 14);
      if (!alive) { x.font = 'bold 28px Consolas'; x.textAlign = 'center'; x.fillText('GAME OVER — click to retry', 240, 180); x.textAlign = 'left'; }
      requestAnimationFrame(loop);
    };
    c.addEventListener('click', () => { if (!alive) { alive = true; bx = 240; by = 250; vx = 160; vy = -200; score = 0; bricks.fill(true); } });
    requestAnimationFrame(loop);
  },
};


// ------------------------------------------------------------- pool / snooker
const pool: Panel = {
  title: 'Pool table',
  render(el) {
    const W = 600, H = 330, R = 9, rail = 26;
    const c = h('canvas', { width: W, height: H, style: { width: '100%', touchAction: 'none', borderRadius: '10px' } }) as HTMLCanvasElement;
    const info = h('div.muted', 'Drag back from the white ball and release to shoot. Pot all the coloured balls.');
    add(el, c, info, h('div.row', btn('Rack again', () => rack(), 'ghost')));
    const x = c.getContext('2d')!;
    type B = { x: number; y: number; vx: number; vy: number; c: string; n: number; in: boolean };
    let balls: B[] = [];
    let shots = 0, potted = 0;
    const pockets = [[rail, rail], [W / 2, rail - 4], [W - rail, rail], [rail, H - rail], [W / 2, H - rail + 4], [W - rail, H - rail]];
    const cols = ['#ffd23f', '#1e4fd9', '#d92b3a', '#6b4ea8', '#e46f2e', '#2f7d5b', '#8c2f39', '#111', '#ffd23f', '#1e4fd9'];
    function rack() {
      balls = [{ x: W * 0.25, y: H / 2, vx: 0, vy: 0, c: '#fff', n: 0, in: false }];
      let n = 1;
      for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) balls.push({ x: W * 0.68 + row * R * 1.8, y: H / 2 + (i - row / 2) * R * 2.05, vx: 0, vy: 0, c: cols[(n - 1) % cols.length], n: n++, in: false });
      shots = 0; potted = 0; info.textContent = 'Drag back from the white ball and release to shoot.';
    }
    rack();
    const pos = (e: PointerEvent) => ({ x: e.offsetX * (W / c.clientWidth), y: e.offsetY * (H / c.clientHeight) });
    let aim: { x: number; y: number } | null = null;
    const moving = () => balls.some((b) => !b.in && Math.hypot(b.vx, b.vy) > 2);
    c.addEventListener('pointerdown', (e) => { if (!moving()) { aim = pos(e); c.setPointerCapture(e.pointerId); } });
    c.addEventListener('pointermove', (e) => { if (aim) aim = pos(e); });
    c.addEventListener('pointerup', () => {
      if (!aim) return;
      const cue = balls[0];
      const dx = cue.x - aim.x, dy = cue.y - aim.y;
      const pw = Math.min(160, Math.hypot(dx, dy)) * 7;
      const d = Math.hypot(dx, dy) || 1;
      cue.vx = (dx / d) * pw; cue.vy = (dy / d) * pw;
      aim = null; shots++;
    });
    let last = performance.now();
    const step = (t: number) => {
      if (!c.isConnected) return;
      const dt = Math.min(0.03, (t - last) / 1000); last = t;
      for (let sub = 0; sub < 4; sub++) {
        const h2 = dt / 4;
        for (const b of balls) {
          if (b.in) continue;
          b.x += b.vx * h2; b.y += b.vy * h2;
          const f = Math.max(0, 1 - 0.9 * h2);
          b.vx *= f; b.vy *= f;
          if (Math.hypot(b.vx, b.vy) < 4) { b.vx = 0; b.vy = 0; }
          if (b.x < rail + R) { b.x = rail + R; b.vx = Math.abs(b.vx) * 0.85; }
          if (b.x > W - rail - R) { b.x = W - rail - R; b.vx = -Math.abs(b.vx) * 0.85; }
          if (b.y < rail + R) { b.y = rail + R; b.vy = Math.abs(b.vy) * 0.85; }
          if (b.y > H - rail - R) { b.y = H - rail - R; b.vy = -Math.abs(b.vy) * 0.85; }
          for (const [px, py] of pockets) if (Math.hypot(b.x - px, b.y - py) < R * 1.9) {
            if (b.n === 0) { b.x = W * 0.25; b.y = H / 2; b.vx = b.vy = 0; info.textContent = 'Scratch! The white ball is back on the spot.'; }
            else { b.in = true; potted++; info.textContent = `Potted! ${potted}/10 in ${shots} shots.`; if (potted === 10) info.textContent = `Cleared the table in ${shots} shots! 🎱`; }
          }
        }
        for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i], b = balls[j];
          if (a.in || b.in) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d > 0 && d < R * 2) {
            const nx = dx / d, ny = dy / d, ov = (R * 2 - d) / 2;
            a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
            const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (rel > 0) { a.vx -= rel * nx * 0.96; a.vy -= rel * ny * 0.96; b.vx += rel * nx * 0.96; b.vy += rel * ny * 0.96; }
          }
        }
      }
      x.fillStyle = '#3d2a1e'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#1f6b3a'; x.fillRect(rail - 6, rail - 6, W - rail * 2 + 12, H - rail * 2 + 12);
      x.fillStyle = '#000'; for (const [px, py] of pockets) { x.beginPath(); x.arc(px, py, R * 1.6, 0, 7); x.fill(); }
      for (const b of balls) if (!b.in) { x.fillStyle = b.c; x.beginPath(); x.arc(b.x, b.y, R, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.arc(b.x - 3, b.y - 3, 3, 0, 7); x.fill(); }
      if (aim) {
        const cue = balls[0];
        const dx = cue.x - aim.x, dy = cue.y - aim.y, d = Math.hypot(dx, dy) || 1;
        x.strokeStyle = 'rgba(255,255,255,0.5)'; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(cue.x, cue.y); x.lineTo(cue.x + (dx / d) * 220, cue.y + (dy / d) * 220); x.stroke(); x.setLineDash([]);
        x.strokeStyle = '#d9a04a'; x.lineWidth = 5; x.beginPath(); x.moveTo(cue.x - (dx / d) * (R + 4), cue.y - (dy / d) * (R + 4)); x.lineTo(cue.x - (dx / d) * (R + 4 + 160), cue.y - (dy / d) * (R + 4 + 160)); x.stroke(); x.lineWidth = 1;
        x.fillStyle = '#fff'; x.font = '14px sans-serif'; x.fillText('Power ' + Math.round(Math.min(160, Math.hypot(dx, dy)) / 1.6) + '%', 12, 18);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
};

// ------------------------------------------------------------- piano
const piano: Panel = {
  title: 'Piano',
  render(el) {
    audio.init();
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const keyMap = 'awsedftgyhujkolp;';
    const play = (midi: number) => {
      const ctx = audio.ctx; if (!ctx) return;
      const t = ctx.currentTime, f = 440 * Math.pow(2, (midi - 69) / 12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      for (const [type, mul, v] of [['triangle', 1, 1], ['sine', 2, 0.3], ['sine', 3, 0.1]] as const) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
        const og = ctx.createGain(); og.gain.value = v; o.connect(og).connect(g); o.start(t); o.stop(t + 1.7);
      }
      g.connect(audio.musicBus);
      api.emote('type', 2);
    };
    const kb = h('div.piano');
    for (let i = 0; i < 17; i++) {
      const midi = 60 + i, black = notes[midi % 12].includes('#');
      const k = h('button.pkey' + (black ? '.black' : ''), { onpointerdown: (e: Event) => { e.preventDefault(); play(midi); k.classList.add('down'); setTimeout(() => k.classList.remove('down'), 150); } }, h('small', keyMap[i] ?? ''));
      kb.append(k);
    }
    const onKey = (e: KeyboardEvent) => { const i = keyMap.indexOf(e.key); if (i >= 0 && !e.repeat) { play(60 + i); (kb.children[i] as HTMLElement)?.classList.add('down'); setTimeout(() => (kb.children[i] as HTMLElement)?.classList.remove('down'), 150); } };
    window.addEventListener('keydown', onKey);
    const stop = () => { if (!kb.isConnected) { window.removeEventListener('keydown', onKey); } else setTimeout(stop, 1000); };
    setTimeout(stop, 1000);
    add(el, kb, h('small.muted', 'Tap the keys (or use A W S E D F T G Y H U J K on a keyboard). Everyone in the room can hear you.'),
      h('div.row', btn('Play a melody', async () => { for (const n of [64, 62, 60, 62, 64, 64, 64, 62, 62, 62, 64, 67, 67]) { play(n); await new Promise((r) => setTimeout(r, 320)); } }, 'ghost')));
  },
  onClose() { api.stand(); },
};

const quality: Panel = { title: 'Graphics', render(el, _rr, d) { localStorage.setItem('cc_quality_manual', '1'); api.setQuality(d.q); add(el, h('p', `Graphics quality set to ${d.q}.`)); setTimeout(() => api.closePanel(), 600); } };

export const PANELS: Record<string, Panel> = {
  menu, pool, piano, boutique, wardrobe, mirror, furniture, decorate, realestate, dealer, sellcar, customs, transport, callcar, work, pitch, defi, vip, react, computer, arcade, quality,
};
