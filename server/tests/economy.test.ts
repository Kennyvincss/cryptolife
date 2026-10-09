import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDb } from '../db.js';
import { Game } from '../game.js';
import { nodeHasher } from '../auth-node.js';
import { register as regLife } from '../actions/life.js';
import { register as regFinance, processOrders } from '../actions/finance.js';
import { register as regWork, projectCycle } from '../actions/work.js';
import { register as regSocial } from '../actions/social.js';
import { register as regTransport } from '../actions/transport.js';
import { doorOf } from '../../shared/city.js';
import type { UserRec } from '../db.js';

function setup() {
  const sent: { id: string; msg: any }[] = [];
  const g = new Game(emptyDb(), { send: (id, msg) => sent.push({ id, msg }), broadcast: () => {} }, nodeHasher);
  regLife(g); regFinance(g); regWork(g); regSocial(g); regTransport(g);
  const mk = (name: string) => {
    const { id } = g.register(name, 'password1');
    const u = g.db.users[id];
    g.presence.set(id, { p: [0, 0, 0], r: 0, a: 'idle', z: 'street', look: u.look, t: Date.now() });
    return u;
  };
  const at = (u: UserRec, zone: string) => {
    const d = doorOf(zone);
    const p = g.presence.get(u.id)!;
    if (d) { p.p = [d[0], 0, d[2]]; u.lastPos = p.p; }
    p.z = zone;
  };
  return { g, mk, at, sent };
}

test('registration: starting funds, unique & look-alike usernames rejected', () => {
  const { g, mk } = setup();
  const a = mk('Kennyvincs');
  assert.equal(a.cash, 100);
  assert.throws(() => g.register('kennyvincs', 'password1'), /taken/);
  assert.throws(() => g.register('KennyVlncs', 'password1'), /taken/); // l/i look-alike
  assert.throws(() => g.register('admin_1', 'password1'), /reserved/);
  assert.equal(g.login('Kennyvincs', 'password1').id, a.id);
  assert.throws(() => g.login('Kennyvincs', 'nope'), /Wrong/);
});

test('trading: market buy/sell updates cash, holdings, fees and realized P&L', () => {
  const { g, mk } = setup();
  const u = mk('trader');
  const px = g.market.price('CITY');
  g.handle(u, 'market.order', { sym: 'CITY', side: 'buy', type: 'market', usd: 50 });
  assert.ok(u.holdings.CITY > 0);
  assert.ok(u.cash < 50.1 && u.cash > 49.8, 'paid ~$50 + fee');
  g.db.market.prices.CITY = px * 1.5;
  g.handle(u, 'market.order', { sym: 'CITY', side: 'sell', type: 'market', qty: u.holdings.CITY });
  assert.equal(u.holdings.CITY, undefined);
  const sell = u.fills.find((f) => f.side === 'sell')!;
  assert.ok(sell.pnl! > 20, 'profit realized');
  assert.ok(u.cash > 100);
  assert.throws(() => g.handle(u, 'market.order', { sym: 'CITY', side: 'sell', type: 'market', qty: 5 }), /only have/);
  assert.throws(() => g.handle(u, 'market.order', { sym: 'SGLD', side: 'buy', type: 'market', usd: 1e6 }), /Not enough funds/);
});

test('limit orders reserve funds and fill when price crosses; cancel refunds', () => {
  const { g, mk } = setup();
  const u = mk('limiter');
  const px = g.market.price('ETHN');
  g.handle(u, 'market.order', { sym: 'ETHN', side: 'buy', type: 'limit', qty: 0.01, price: px * 0.9 });
  const reserved = u.orders[0].reserved;
  assert.ok(Math.abs(u.cash - (100 - reserved)) < 0.01);
  g.db.market.prices.ETHN = px * 0.85;
  processOrders(g, u);
  assert.equal(u.orders.length, 0);
  assert.ok(Math.abs(u.holdings.ETHN - 0.01) < 1e-9);
  g.handle(u, 'market.order', { sym: 'ETHN', side: 'sell', type: 'stop', qty: 0.01, price: px * 0.5 });
  g.handle(u, 'market.order', { sym: 'ETHN', side: 'buy', type: 'limit', qty: 0.001, price: px * 0.1 });
  const before = u.cash;
  g.handle(u, 'market.cancel', { id: u.orders.find((o) => o.side === 'buy')!.id });
  assert.ok(u.cash > before);
});

test('username payments: resolve, send, limits, blocking', () => {
  const { g, mk } = setup();
  const a = mk('alice'), b = mk('bob');
  const r = g.handle(a, 'wallet.resolve', { to: '@bob' }) as any;
  assert.equal(r.username, 'bob');
  g.handle(a, 'wallet.send', { to: 'bob', amount: 25, memo: 'lunch' });
  assert.equal(a.cash, 75);
  assert.equal(b.cash, 125);
  assert.throws(() => g.handle(a, 'wallet.send', { to: 'bob', amount: 1000 }), /Not enough/);
  g.handle(b, 'social.block', { username: 'alice', on: true });
  assert.throws(() => g.handle(a, 'wallet.send', { to: 'bob', amount: 1 }), /not accepting/);
  assert.throws(() => g.handle(a, 'wallet.send', { to: 'alice', amount: 1 }), /yourself/);
});

test('location-gated actions require being at the venue', () => {
  const { g, mk, at } = setup();
  const u = mk('walker');
  assert.throws(() => g.handle(u, 'shop.buyClothing', { id: 'cap' }), /need to be at/);
  at(u, 'boutique');
  g.handle(u, 'shop.buyClothing', { id: 'cap' });
  assert.ok(u.wardrobe.includes('cap'));
  assert.throws(() => g.handle(u, 'profile.setLook', { look: { ...u.look, outfit: { ...u.look.outfit, top: 'whale_suit' } } }), /don't own/);
  at(u, 'cafe');
  g.handle(u, 'food.order', { venue: 'cafe', item: 'latte' });
  assert.ok(u.buffs.fed > Date.now());
});

test('zone.enter checks proximity and residence rules', () => {
  const { g, mk, at } = setup();
  const u = mk('resident');
  g.presence.get(u.id)!.p = [0, 0, 0]; u.lastPos = [0, 0, 0];
  assert.throws(() => g.handle(u, 'zone.enter', { zone: 'exchange' }), /entrance/);
  at(u, 'apt_lux'); g.presence.get(u.id)!.z = 'street';
  assert.throws(() => g.handle(u, 'zone.enter', { zone: 'apt_lux' }), /Residents only/);
  at(u, 'apt_starter'); g.presence.get(u.id)!.z = 'street';
  const r = g.handle(u, 'zone.enter', { zone: 'apt_starter' }) as any;
  assert.equal(r.zone, 'home:' + u.id);
});

test('jobs: apply, accept, shift challenge pays only for verified work at the workplace', async () => {
  const { g, mk, at } = setup();
  const u = mk('worker');
  const job = Object.values(g.db.jobs).find((j) => j.title === 'Barista')!;
  g.handle(u, 'jobs.apply', { id: job.id });
  u.applications[0].status = 'offered';
  g.handle(u, 'jobs.accept', { id: job.id });
  assert.equal(u.job?.title, 'Barista');
  assert.throws(() => g.handle(u, 'jobs.startShift', {}), /need to be at/);
  at(u, 'cafe');
  const c = g.handle(u, 'jobs.startShift', {}) as any;
  assert.ok(c.prompt && !('answer' in c));
  const pending = g.challenges.get(c.id)!;
  const before = u.cash;
  const res = g.handle(u, 'jobs.submit', { id: c.id, answer: pending.answer }) as any;
  assert.equal(res.correct, true);
  assert.equal(u.cash, before + 14);
  assert.throws(() => g.handle(u, 'jobs.startShift', {}), /break/);
});

test('projects: create at Genesis Hub, budget burns treasury, underfunded projects fail', () => {
  const { g, mk, at } = setup();
  const u = mk('founder');
  at(u, 'builderhub');
  const p = g.handle(u, 'project.create', { name: 'Orbit', description: 'test', narrative: 'defi', category: 'DeFi', chain: 'Etherion', seed: 20 }) as any;
  assert.equal(u.cash, 30);
  g.handle(u, 'project.hire', { id: p.id, role: 'Developer' });
  projectCycle(g, g.db.projects[p.id]);
  assert.equal(g.db.projects[p.id].status, 'struggling');
  projectCycle(g, g.db.projects[p.id]);
  assert.equal(g.db.projects[p.id].status, 'failed');
});

test('DAO proposals can only be voted by members', () => {
  const { g, mk, at } = setup();
  const a = mk('daoA'), b = mk('daoB');
  at(a, 'governance');
  const d = g.handle(a, 'dao.create', { name: 'Builders', purpose: 'grants' }) as any;
  g.handle(a, 'dao.deposit', { id: d.id, amount: 10 });
  g.handle(a, 'dao.propose', { id: d.id, title: 'Grant', body: 'x', amount: 5, recipient: 'daoB' });
  const pid = g.db.daos[d.id].proposals[0].id;
  assert.throws(() => g.handle(b, 'dao.vote', { id: d.id, pid, yes: true }), /Members only/);
  g.handle(b, 'dao.join', { id: d.id });
  g.handle(b, 'dao.vote', { id: d.id, pid, yes: true });
  assert.deepEqual(g.db.daos[d.id].proposals[0].yes, ['daoB']);
});

test('rides: NPC ride charges fare only on arrival at destination', () => {
  const { g, mk, at } = setup();
  const u = mk('rider');
  at(u, 'apt_starter'); g.presence.get(u.id)!.z = 'street';
  const ride = g.handle(u, 'ride.request', { dest: 'exchange', category: 'economy' }) as any;
  assert.equal(ride.status, 'assigned');
  g.handle(u, 'ride.arrived', {});
  g.handle(u, 'ride.board', {});
  assert.throws(() => g.handle(u, 'ride.complete', {}), /destination/);
  const d = doorOf('exchange')!;
  u.lastPos = [d[0], 0, d[2]];
  const before = u.cash;
  g.handle(u, 'ride.complete', {});
  assert.ok(u.cash < before && Math.abs(before - u.cash - ride.fare) < 0.01);
});

test('reputation is capped per source per hour (no farming)', () => {
  const { g, mk } = setup();
  const u = mk('farmer');
  let total = 0;
  for (let i = 0; i < 50; i++) total += g.addRep(u, 'social', 1);
  assert.equal(total, 3);
});

test('vehicles: buy at dealership, customize at Gwei Customs', () => {
  const { g, mk, at } = setup();
  const u = mk('driver');
  u.cash = 10000;
  assert.throws(() => g.handle(u, 'vehicle.buy', { model: 'ledger', color: '#111114' }), /need to be at/);
  at(u, 'dealership');
  const v = g.handle(u, 'vehicle.buy', { model: 'ledger', color: '#111114' }) as any;
  assert.equal(u.activeVehicle, v.uid);
  at(u, 'customs');
  g.handle(u, 'vehicle.customize', { id: v.uid, rims: 'sport' });
  assert.equal(u.vehicles[0].rims, 'sport');
  at(u, 'transport');
  g.handle(u, 'driver.register', {});
  assert.ok(u.driver.registered);
});
