// Wallet (simulated ledger), username payments, simulated exchange, DeFi.

import { POOLS, TRADE_FEE } from '../../shared/catalog.js';
import type { Order, OrderType } from '../../shared/types.js';
import type { UserRec } from '../db-core.js';
import type { Game } from '../game.js';
import { questHook } from '../quests.js';
import { assert, round2, uid } from '../util.js';

const MAX_TRANSFER = 25_000;
const DAILY_TRANSFER = 100_000;

export function fill(g: Game, u: UserRec, sym: string, side: 'buy' | 'sell', qty: number, price: number, orderType: OrderType, prepaid = 0) {
  const notional = qty * price;
  const slip = orderType === 'market' ? g.market.slippage(sym, notional) : 0;
  const px = side === 'buy' ? price * (1 + slip) : price * (1 - slip);
  const gross = qty * px;
  const fee = gross * TRADE_FEE;
  let pnl: number | undefined;
  if (side === 'buy') {
    const cost = gross + fee;
    if (prepaid) {
      // limit order: reserved funds cover it; refund any difference
      const refund = prepaid - cost;
      if (refund > 0) u.cash = round2(u.cash + refund);
      g.tx(u, 'trade', refund > 0 ? refund : 0, `Limit buy filled: ${fmtQty(qty)} ${sym} @ $${fmtPx(px)} (paid from reserve)`);
    } else {
      g.debit(u, cost, 'trade', `Bought ${fmtQty(qty)} ${sym} @ $${fmtPx(px)}`);
    }
    u.holdings[sym] = (u.holdings[sym] ?? 0) + qty;
    u.costBasis[sym] = (u.costBasis[sym] ?? 0) + cost;
  } else {
    const have = u.holdings[sym] ?? 0;
    const basisPer = have > 0 ? (u.costBasis[sym] ?? 0) / have : 0;
    const proceeds = gross - fee;
    pnl = round2(proceeds - basisPer * qty);
    u.holdings[sym] = have - qty;
    u.costBasis[sym] = Math.max(0, (u.costBasis[sym] ?? 0) - basisPer * qty);
    if (u.holdings[sym] < 1e-9) { delete u.holdings[sym]; delete u.costBasis[sym]; }
    g.credit(u, proceeds, 'trade', `Sold ${fmtQty(qty)} ${sym} @ $${fmtPx(px)} (P&L ${pnl >= 0 ? '+' : ''}$${pnl})`);
  }
  g.market.impact(sym, notional, side);
  u.fills.unshift({ id: uid('f'), sym, side, qty, price: px, fee: round2(fee), pnl, ts: Date.now(), orderType });
  if (u.fills.length > 300) u.fills.length = 300;
  // progression: volume gives a little XP (capped); profits give more; reputation only via the hourly-capped source
  const zoneBonus = ['exchange', 'tradingfirm'].includes(g.zoneOf(u)) ? 1.2 : 1;
  const rigBonus = g.isOwnHome(u) && u.properties.some((p) => p.placements.some((x) => x.item === 'rig')) ? 1.25 : 1;
  g.addXp(u, 'trading', Math.min(15, 2 + notional / 100) * zoneBonus * rigBonus);
  if (pnl !== undefined && pnl > 0) {
    g.addXp(u, 'trading', Math.min(40, pnl / 5) * zoneBonus * rigBonus);
    g.addRep(u, 'trading', 1);
    g.achieve(u, 'first_profit');
  }
  if (!u.achievements.includes('first_trade')) {
    g.achieve(u, 'first_trade');
    g.log(u, 'trade', `Made a first trade: ${side} ${fmtQty(qty)} ${sym} at $${fmtPx(px)}.`);
  }
  if (pnl !== undefined) {
    for (const e of Object.values(g.db.events)) {
      if (e.kind === 'trading_competition' && e.status === 'live' && e.registered.includes(u.id)) e.baseline[u.id] = round2((e.baseline[u.id] ?? 0) + pnl);
    }
  }
  if (notional > 10_000) g.market.news(`Large ${side} on the exchange: @${u.username} ${side === 'buy' ? 'bought' : 'sold'} $${Math.round(notional).toLocaleString()} of ${sym}`, 'Big flow spotted on the Satoshi Square order book.', [sym.toLowerCase(), 'whales'], 'player');
  questHook(g, u, 'trade_volume', { amount: notional });
  return { price: px, fee, pnl };
}
const fmtQty = (q: number) => (q >= 1000 ? q.toFixed(0) : q >= 1 ? q.toFixed(3) : q.toPrecision(4));
const fmtPx = (p: number) => (p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toPrecision(4));

export function processOrders(g: Game, u: UserRec) {
  if (!u.orders.length) return false;
  let changed = false;
  for (const o of u.orders.slice()) {
    if (!g.market.has(o.sym)) continue;
    const p = g.market.price(o.sym);
    let trigger = false;
    if (o.type === 'limit') trigger = o.side === 'buy' ? p <= o.price! : p >= o.price!;
    else if (o.type === 'stop') trigger = p <= o.price!;
    else if (o.type === 'take_profit') trigger = p >= o.price!;
    if (!trigger) continue;
    u.orders = u.orders.filter((x) => x !== o);
    changed = true;
    try {
      if (o.type === 'limit' && o.side === 'buy') {
        fill(g, u, o.sym, 'buy', o.qty, Math.min(p, o.price!), 'limit', o.reserved);
      } else if (o.type === 'limit') {
        u.holdings[o.sym] = (u.holdings[o.sym] ?? 0) + o.reserved; // release reservation then sell
        fill(g, u, o.sym, 'sell', o.qty, Math.max(p, o.price!), 'limit');
      } else {
        const qty = Math.min(o.qty, u.holdings[o.sym] ?? 0);
        if (qty <= 0) { g.notify(u, `${o.type === 'stop' ? 'Stop-loss' : 'Take-profit'} on ${o.sym} cancelled — no position left.`, 'warn'); continue; }
        fill(g, u, o.sym, 'sell', qty, p, o.type);
        // one-cancels-other: remove the sibling protective order on the same token
        u.orders = u.orders.filter((x) => !(x.sym === o.sym && (x.type === 'stop' || x.type === 'take_profit') && (u.holdings[o.sym] ?? 0) <= 0));
      }
      g.notify(u, `Order filled: ${o.type.replace('_', '-')} ${o.side} ${o.sym} at ~$${fmtPx(p)}`, 'trade');
    } catch (e) {
      g.notify(u, `Order on ${o.sym} failed: ${(e as Error).message}`, 'warn');
    }
  }
  return changed;
}

export function register(g: Game) {
  const A = g.actions;

  // ---------- wallet ----------
  A['wallet.resolve'] = (u, { to }) => {
    const t = g.mustUser(to);
    assert(t.id !== u.id, "You can't pay yourself");
    return { id: t.id, username: t.username, career: t.career, level: Math.floor(Math.sqrt(t.xp / 50)) + 1, since: t.created, friend: u.friends.includes(t.id) };
  };
  A['wallet.send'] = (u, { to, amount, memo }) => {
    const t = g.mustUser(to);
    assert(t.id !== u.id, "You can't pay yourself");
    assert(!t.blocked.includes(u.id), `@${t.username} is not accepting payments from you.`);
    amount = round2(Number(amount));
    assert(amount >= 0.01, 'Minimum transfer is $0.01');
    assert(amount <= MAX_TRANSFER, `Max single transfer is $${MAX_TRANSFER.toLocaleString()}`);
    const today = u.txs.filter((x) => x.kind === 'transfer_out' && Date.now() - x.ts < 86_400_000).reduce((s, x) => s - x.amount, 0);
    assert(today + amount <= DAILY_TRANSFER, 'Daily transfer limit reached');
    g.rateLimit(u.id + ':send', 5, 60_000);
    const m = g.clean(memo, 80);
    g.debit(u, amount, 'transfer_out', m || `Payment to @${t.username}`, t.username);
    g.credit(t, amount, 'transfer_in', m || `Payment from @${u.username}`, u.username);
    g.notify(t, `💸 @${u.username} sent you $${amount.toFixed(2)} (simulated)${m ? ` — "${m}"` : ''}`, 'money');
    g.pushMe(t);
    return { ok: true, to: t.username, amount };
  };
  A['wallet.request'] = (u, { to, amount, memo }) => {
    const t = g.mustUser(to);
    assert(t.id !== u.id, "You can't request from yourself");
    assert(!t.blocked.includes(u.id), 'Request not allowed');
    amount = round2(Number(amount));
    assert(amount >= 0.01 && amount <= MAX_TRANSFER, 'Invalid amount');
    g.rateLimit(u.id + ':req', 5, 60_000);
    t.paymentRequests = [...t.paymentRequests, { id: uid('pr'), from: u.username, amount, memo: g.clean(memo, 80), ts: Date.now() }].slice(-20);
    g.notify(t, `@${u.username} requested $${amount.toFixed(2)} from you. Open Wallet to review.`, 'money');
    g.pushMe(t);
  };
  A['wallet.payRequest'] = (u, { id }) => {
    const r = u.paymentRequests.find((x) => x.id === id);
    assert(r, 'Request not found');
    u.paymentRequests = u.paymentRequests.filter((x) => x !== r);
    return A['wallet.send'](u, { to: r.from, amount: r.amount, memo: r.memo || 'Payment request' }, g);
  };
  A['wallet.declineRequest'] = (u, { id }) => { u.paymentRequests = u.paymentRequests.filter((x) => x.id !== id); };

  // ---------- market ----------
  A['market.list'] = () => g.market.list();
  A['market.history'] = (_u, { sym }) => {
    assert(g.market.has(sym), 'Unknown token');
    return g.market.history(sym);
  };
  A['market.watch'] = (u, { sym, on }) => {
    assert(g.market.has(sym), 'Unknown token');
    u.watchlist = on ? [...new Set([...u.watchlist, sym])] : u.watchlist.filter((s) => s !== sym);
  };
  A['market.order'] = (u, args) => {
    const sym = String(args.sym);
    const side: 'buy' | 'sell' = args.side === 'sell' ? 'sell' : 'buy';
    const type: OrderType = ['market', 'limit', 'stop', 'take_profit'].includes(args.type) ? args.type : 'market';
    assert(g.market.has(sym), 'Unknown token');
    g.rateLimit(u.id + ':order', 8, 10_000);
    const p = g.market.price(sym);
    let qty = Number(args.qty);
    if (!(qty > 0) && Number(args.usd) > 0) qty = Number(args.usd) / (type === 'market' ? p : Number(args.price));
    assert(Number.isFinite(qty) && qty > 0, 'Enter an amount');
    assert(qty * p >= 1, 'Minimum order is $1');
    if (type === 'market') {
      if (side === 'sell') assert((u.holdings[sym] ?? 0) + 1e-9 >= qty, `You only have ${fmtQty(u.holdings[sym] ?? 0)} ${sym}`);
      qty = side === 'sell' ? Math.min(qty, u.holdings[sym] ?? 0) : qty;
      return fill(g, u, sym, side, qty, p, 'market');
    }
    const price = Number(args.price);
    assert(price > 0, 'Enter a price');
    assert(u.orders.length < 20, 'Too many open orders');
    const o: Order = { id: uid('o'), sym, side, type, qty, price, reserved: 0, ts: Date.now() };
    if (type === 'limit') {
      if (side === 'buy') {
        const cost = round2(qty * price * (1 + TRADE_FEE));
        g.debit(u, cost, 'order_reserve', `Reserved for limit buy ${fmtQty(qty)} ${sym} @ $${fmtPx(price)}`);
        o.reserved = cost;
      } else {
        assert((u.holdings[sym] ?? 0) + 1e-9 >= qty, `You only have ${fmtQty(u.holdings[sym] ?? 0)} ${sym}`);
        u.holdings[sym] -= qty;
        o.reserved = qty;
      }
    } else {
      assert(side === 'sell', 'Stop-loss / take-profit orders protect positions you hold (sell side).');
      assert((u.holdings[sym] ?? 0) > 0, `You don't hold ${sym}`);
      if (type === 'stop') assert(price < p, 'Stop price must be below the current price');
      if (type === 'take_profit') assert(price > p, 'Take-profit price must be above the current price');
    }
    u.orders.push(o);
    u.orderCount++;
    return { order: o };
  };
  A['market.cancel'] = (u, { id }) => {
    const o = u.orders.find((x) => x.id === id);
    assert(o, 'Order not found');
    u.orders = u.orders.filter((x) => x !== o);
    if (o.type === 'limit' && o.side === 'buy') g.credit(u, o.reserved, 'order_release', `Cancelled limit buy ${o.sym}`);
    if (o.type === 'limit' && o.side === 'sell') u.holdings[o.sym] = (u.holdings[o.sym] ?? 0) + o.reserved;
  };

  // ---------- DeFi (simulated) ----------
  A['defi.pools'] = () => POOLS;
  A['defi.stake'] = (u, { pool, amount }) => {
    g.requireZone(u, 'defihub');
    const p = POOLS.find((x) => x.id === pool);
    assert(p, 'Unknown pool');
    amount = Number(amount);
    assert(amount > 0, 'Enter an amount');
    if (p.sym === 'USD') g.debit(u, amount, 'stake', `Deposited to ${p.name}`);
    else {
      assert((u.holdings[p.sym] ?? 0) + 1e-9 >= amount, `Not enough ${p.sym}`);
      const have = u.holdings[p.sym];
      const basisPer = (u.costBasis[p.sym] ?? 0) / have;
      u.holdings[p.sym] = have - amount;
      u.costBasis[p.sym] = Math.max(0, (u.costBasis[p.sym] ?? 0) - basisPer * amount);
      if (u.holdings[p.sym] < 1e-9) delete u.holdings[p.sym];
    }
    u.stakes.push({ id: uid('st'), pool: p.id, sym: p.sym, amount, apr: p.apr, since: Date.now(), accrued: 0 });
    g.addXp(u, 'investing', 15);
    g.achieve(u, 'staker');
    questHook(g, u, 'stake', { sym: p.sym });
  };
  A['defi.unstake'] = (u, { id }) => {
    g.requireZone(u, 'defihub');
    const s = u.stakes.find((x) => x.id === id);
    assert(s, 'Position not found');
    u.stakes = u.stakes.filter((x) => x !== s);
    const total = s.amount + s.accrued;
    if (s.sym === 'USD') g.credit(u, total, 'unstake', `Withdrew from lending (+$${s.accrued.toFixed(2)} interest)`);
    else {
      u.holdings[s.sym] = (u.holdings[s.sym] ?? 0) + total;
      u.costBasis[s.sym] = (u.costBasis[s.sym] ?? 0) + s.amount * g.market.price(s.sym);
    }
    g.addXp(u, 'investing', Math.min(50, 5 + s.accrued));
    g.addRep(u, 'trading', 1);
  };
}

export function accrueStakes(g: Game, u: UserRec, dtMs: number) {
  const dayFrac = dtMs / g.DAY_MS;
  for (const s of u.stakes) s.accrued += s.amount * (s.apr / 365) * dayFrac * 30; // 30x accelerated so yield is visible within a session
}
