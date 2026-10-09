// Work challenges. The server generates the puzzle and keeps the answer; the
// client only ever receives the prompt and options. Pay depends on correctness.

import type { Challenge, ChallengeKind } from '../shared/types.js';
import { pick, shuffle, uid } from './util.js';

export interface PendingChallenge { c: Challenge; answer: number[]; userId: string; expires: number; purpose: string; ref?: string }

function numOptions(correct: number, spread: number, fmt: (n: number) => string = String) {
  const set = new Set<number>([correct]);
  let guard = 0;
  while (set.size < 4 && guard++ < 50) {
    const d = Math.max(1, Math.round(Math.random() * spread));
    set.add(Math.random() < 0.5 ? correct + d : Math.max(0, correct - d));
  }
  const opts = shuffle([...set]);
  return { options: opts.map(fmt), answer: [opts.indexOf(correct)] };
}

const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US');

function dev(hard: boolean): { c: Omit<Challenge, 'id' | 'kind'>; answer: number[] } {
  const variant = Math.floor(Math.random() * 3);
  if (variant === 0) {
    const n = 5 + Math.floor(Math.random() * (hard ? 20 : 8));
    const k = 2 + Math.floor(Math.random() * 3);
    let s = 0;
    for (let i = 0; i < n; i++) if (i % k === 0) s += i;
    const code = `let total = 0;\nfor (let i = 0; i < ${n}; i++) {\n  if (i % ${k} === 0) total += i;\n}\nreturn total;`;
    const o = numOptions(s, Math.max(3, s * 0.3));
    return { c: { prompt: 'What does this function return?', code, options: o.options, multi: false }, answer: o.answer };
  }
  if (variant === 1) {
    const bal = 100 + Math.floor(Math.random() * 900);
    const amts = Array.from({ length: hard ? 5 : 3 }, () => 10 + Math.floor(Math.random() * 200));
    let b = bal;
    for (const a of amts) if (a <= b) b -= a;
    const code = `let balance = ${bal};\nconst withdrawals = [${amts.join(', ')}];\nfor (const w of withdrawals) {\n  if (w <= balance) balance -= w; // skip if insufficient\n}\nreturn balance;`;
    const o = numOptions(b, Math.max(10, b * 0.4));
    return { c: { prompt: 'Final balance after the withdrawal loop?', code, options: o.options, multi: false }, answer: o.answer };
  }
  // bug-spotting
  const bugs = [
    { code: 'function transfer(from, to, amt) {\n  to.balance += amt;\n  from.balance -= amt;\n}', bug: 'No check that from.balance >= amt', others: ['Uses += instead of =', 'Function should be async', 'Variables should be const'] },
    { code: 'function withdraw(user, amt) {\n  send(user.addr, amt);   // external call\n  user.balance -= amt;\n}', bug: 'State updated after external call (reentrancy)', others: ['send() should be sendAll()', 'amt should be a string', 'Missing semicolon'] },
    { code: 'function avg(prices) {\n  let s = 0;\n  for (let i = 0; i <= prices.length; i++) s += prices[i];\n  return s / prices.length;\n}', bug: 'Off-by-one: loop reads past the end of the array', others: ['Should divide by s', 'let should be var', 'prices must be sorted first'] },
    { code: 'function isOwner(user) {\n  return user.role = "owner";\n}', bug: 'Assignment (=) instead of comparison (===)', others: ['Missing await', 'Should return a number', 'String must use single quotes'] },
  ];
  const b = pick(bugs);
  const opts = shuffle([b.bug, ...b.others]);
  return { c: { prompt: 'Code review: what is the real bug?', code: b.code, options: opts, multi: false }, answer: [opts.indexOf(b.bug)] };
}

function research(): { c: Omit<Challenge, 'id' | 'kind'>; answer: number[] } {
  const name = pick(['Orbit Finance', 'Nimbus Swap', 'Tessellate', 'Kite Protocol', 'Lumen DAO', 'Quarry Labs']);
  const price = pick([0.25, 0.5, 1.2, 2, 4, 8]);
  const supply = pick([100, 250, 400, 1000]) * 1_000_000;
  const circPct = pick([10, 20, 25, 40, 50]);
  const variant = Math.random() < 0.5 ? 'mcap' : 'fdv';
  const ans = variant === 'mcap' ? Math.round(price * supply * circPct / 100) : Math.round(price * supply);
  const set = new Set<number>([ans, Math.round(price * supply), Math.round(price * supply * circPct / 100), Math.round(ans * 2.5), Math.round(ans / 4)]);
  const opts = shuffle([...set]).slice(0, 4);
  if (!opts.includes(ans)) opts[0] = ans;
  const fin = shuffle(opts);
  return {
    c: {
      prompt: `${name} trades at $${price}. Max supply is ${(supply / 1e6).toFixed(0)}M tokens and ${circPct}% is circulating. What is the ${variant === 'mcap' ? 'circulating market cap' : 'fully diluted valuation (FDV)'}?`,
      options: fin.map(fmtUsd), multi: false,
    },
    answer: [fin.indexOf(ans)],
  };
}

function community(): { c: Omit<Challenge, 'id' | 'kind'>; answer: number[] } {
  const scams = [
    'DM me your seed phrase and I will fix your wallet 🙏',
    'URGENT!!! Claim your free airdrop at yieldst0ne-claim.xyz before it ends',
    'Admin here, send 1 ETHN to this address and get 2 back',
    'Support team: please verify your wallet by entering your private key',
    'Guaranteed 50x, insider tip, buy now before the announcement!!!',
  ];
  const fine = [
    'Anyone know when the next governance vote closes?',
    'Great AMA today, thanks team',
    'Is the testnet faucet down for anyone else?',
    'What are the staking APRs looking like this week?',
    'Docs updated — the bridge guide is much clearer now',
    'gm everyone, see you at the conference',
  ];
  const s = shuffle(scams).slice(0, 2 + Math.floor(Math.random() * 2));
  const f = shuffle(fine).slice(0, 6 - s.length);
  const all = shuffle([...s, ...f]);
  return {
    c: { prompt: 'Moderation queue: select EVERY message that is a scam or should be removed.', options: all, multi: true },
    answer: all.map((m, i) => (s.includes(m) ? i : -1)).filter((i) => i >= 0),
  };
}

function creator(trending: string[]): { c: Omit<Challenge, 'id' | 'kind'>; answer: number[] } {
  const topic = trending[0] ?? 'crypto-city';
  const good = `Thread 🧵: what #${topic} means for Crypto City this week — the numbers, the risks, my take`;
  const bad = [
    'Buy my bags, guaranteed moon 🚀🚀🚀 (not financial advice lol)',
    'Random photo of my lunch #food',
    `Copy-paste of someone else's ${topic} post without credit`,
  ];
  const opts = shuffle([good, ...bad]);
  return { c: { prompt: `The city is talking about #${topic}. Which post should the studio publish?`, options: opts, multi: false }, answer: [opts.indexOf(good)] };
}

function analyst(): { c: Omit<Challenge, 'id' | 'kind'>; answer: number[] } {
  const entry = pick([20, 40, 50, 80, 125, 200]);
  const qty = pick([5, 10, 20, 25, 40]);
  const movePct = pick([-30, -20, -10, 10, 15, 25, 50]);
  const exit = entry * (1 + movePct / 100);
  const pnl = Math.round((exit - entry) * qty);
  const vals = new Set<number>([pnl, -pnl, Math.round(pnl * 1.5), Math.round(pnl / 2) + 7]);
  const arr = shuffle([...vals]).slice(0, 4);
  if (!arr.includes(pnl)) arr[0] = pnl;
  const fin = shuffle(arr);
  return {
    c: { prompt: `A desk bought ${qty} tokens at $${entry} and sold after a ${movePct > 0 ? '+' : ''}${movePct}% move. Realized P&L (ignore fees)?`, options: fin.map((n) => (n < 0 ? '-$' + Math.abs(n) : '$' + n)), multi: false },
    answer: [fin.indexOf(pnl)],
  };
}

function barista(): { c: Omit<Challenge, 'id' | 'kind'>; answer: number[] } {
  const items = [{ n: 'Espresso', p: 3 }, { n: 'Oat Latte', p: 4.5 }, { n: 'Iced Matcha', p: 5 }, { n: 'Croissant', p: 3.5 }, { n: 'Avocado Toast', p: 8 }];
  const order = shuffle(items).slice(0, 2 + Math.floor(Math.random() * 2));
  const qtys = order.map(() => 1 + Math.floor(Math.random() * 2));
  const total = order.reduce((s, it, i) => s + it.p * qtys[i], 0);
  const paid = Math.ceil(total / 10) * 10 + (Math.random() < 0.5 ? 10 : 0);
  const change = Math.round((paid - total) * 100) / 100;
  const set = new Set<number>([change, change + 1, Math.max(0.5, change - 1.5), change + 2.5]);
  const opts = shuffle([...set]);
  return {
    c: { prompt: `Order: ${order.map((o, i) => `${qtys[i]}× ${o.n} ($${o.p})`).join(', ')}. Customer pays $${paid}. How much change?`, options: opts.map((n) => '$' + n.toFixed(2)), multi: false },
    answer: [opts.indexOf(change)],
  };
}

export function makeChallenge(kind: ChallengeKind, opts: { hard?: boolean; trending?: string[] } = {}): { c: Challenge; answer: number[] } {
  const gen = kind === 'dev' ? dev(!!opts.hard)
    : kind === 'research' ? research()
    : kind === 'community' ? community()
    : kind === 'creator' ? creator(opts.trending ?? [])
    : kind === 'analyst' ? analyst()
    : barista();
  return { c: { id: uid('c'), kind, ...gen.c }, answer: gen.answer.slice().sort() };
}

export function checkAnswer(expected: number[], given: number[]) {
  const g = [...new Set((given ?? []).map(Number))].sort();
  return g.length === expected.length && g.every((v, i) => v === expected[i]);
}
