// Airdrop quest progress tracking. Hooks are called from the systems that
// generate the underlying activity (trades, visits, votes, posts, stakes).

import { QUESTS, type QuestTaskKind } from '../shared/catalog.js';
import type { UserRec } from './db-core.js';
import type { Game } from './game.js';

export function questHook(g: Game, u: UserRec, kind: QuestTaskKind, data: { amount?: number; zone?: string; tags?: string[]; sym?: string; questId?: string } = {}) {
  let changed = false;
  for (const a of u.airdrops) {
    if (a.status !== 'active') continue;
    const q = QUESTS.find((x) => x.id === a.questId);
    if (!q) continue;
    for (const t of q.tasks) {
      if (a.done[t.id] || t.kind !== kind) continue;
      let ok = false;
      switch (kind) {
        case 'trade_volume':
          a.baseline[t.id] = (a.baseline[t.id] ?? 0) + (data.amount ?? 0);
          ok = a.baseline[t.id] >= (t.amount ?? 0);
          break;
        case 'visit': ok = data.zone === t.zone; break;
        case 'vote': ok = true; break;
        case 'post': ok = !!data.tags?.includes(t.tag!); break;
        case 'stake': ok = data.sym === t.sym; break;
        case 'research': ok = data.questId === q.id; break;
        case 'hold': break; // evaluated at snapshot
      }
      if (ok) {
        a.done[t.id] = true;
        changed = true;
        g.notify(u, `Airdrop task complete: ${q.protocol} — ${t.label}`, 'quest');
      }
    }
  }
  return changed;
}

export function settleQuests(g: Game, u: UserRec, now: number) {
  for (const a of u.airdrops) {
    if (a.status !== 'active') continue;
    const q = QUESTS.find((x) => x.id === a.questId);
    if (!q) continue;
    if (now < a.accepted + q.durationMin * 60_000) continue;
    // snapshot
    let eligible = true;
    for (const t of q.tasks) {
      if (t.kind === 'hold') {
        const held = (u.holdings[t.sym!] ?? 0) + u.stakes.filter((s) => s.sym === t.sym).reduce((s, x) => s + x.amount, 0);
        if (held >= (t.amount ?? 0)) a.done[t.id] = true;
      }
      if (!a.done[t.id]) eligible = false;
    }
    if (!eligible) {
      a.status = 'expired';
      g.notify(u, `${q.protocol} snapshot taken — you did not meet all requirements.`, 'quest');
      continue;
    }
    let r = Math.random();
    let outcome = q.outcomes[q.outcomes.length - 1];
    for (const o of q.outcomes) { if (r < o.p) { outcome = o; break; } r -= o.p; }
    a.reward = outcome.reward;
    if (outcome.reward > 0) {
      a.status = 'paid';
      g.credit(u, outcome.reward, 'airdrop', `${q.protocol} airdrop — ${outcome.label} (simulated)`);
      g.addXp(u, 'research', 60);
      g.addRep(u, 'airdrops', 2);
      u.airdropWins++;
      g.achieve(u, 'airdrop_win');
      g.log(u, 'airdrop', `Qualified for the ${q.protocol} airdrop and received $${outcome.reward} (${outcome.label}).`);
      g.notify(u, `🎁 ${q.protocol} airdrop: ${outcome.label} — $${outcome.reward} credited (simulated).`, 'quest');
    } else {
      a.status = 'nothing';
      g.addXp(u, 'research', 20);
      g.log(u, 'airdrop', `Completed the ${q.protocol} campaign but it paid nothing (${outcome.label}).`);
      g.notify(u, `${q.protocol}: ${outcome.label}. No reward this time.`, 'quest');
    }
    g.pushMe(u);
  }
}
