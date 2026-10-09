// Jobs, work shifts, player projects/startups, airdrop quests.

import {
  CHAINS, CHALLENGE_SKILL, NPC_HIRES, PROJECT_CATEGORIES, PROJECT_FEE, QUESTS, SHIFT_COOLDOWN_MS, levelFromXp,
} from '../../shared/catalog.js';
import type { ChallengeKind, JobListing, ProjectRecord } from '../../shared/types.js';
import { checkAnswer, makeChallenge } from '../challenges.js';
import type { UserRec } from '../db.js';
import type { Game } from '../game.js';
import { questHook } from '../quests.js';
import { assert, clamp, pick, round2, uid } from '../util.js';

const KINDS: ChallengeKind[] = ['dev', 'research', 'community', 'creator', 'analyst', 'barista'];

function eligibility(u: UserRec, j: JobListing) {
  const lvl = levelFromXp(u.xp);
  if (lvl < j.minLevel) return `Requires level ${j.minLevel}`;
  if ((u.skills[j.skill] ?? 0) < j.minSkill) return `Requires ${j.minSkill} ${j.skill} XP (you have ${u.skills[j.skill] ?? 0})`;
  return null;
}

function issueChallenge(g: Game, u: UserRec, kind: ChallengeKind, purpose: string, ref?: string, hard = false) {
  for (const [id, c] of g.challenges) if (c.userId === u.id) g.challenges.delete(id);
  const { c, answer } = makeChallenge(kind, { hard, trending: g.market.mods.trending });
  g.challenges.set(c.id, { c, answer, userId: u.id, expires: Date.now() + 5 * 60_000, purpose, ref });
  return c;
}

function takeChallenge(g: Game, u: UserRec, id: string, answer: number[]) {
  const pc = g.challenges.get(id);
  assert(pc && pc.userId === u.id && pc.expires > Date.now(), 'That task expired. Start a new one.');
  g.challenges.delete(id);
  return { pc, correct: checkAnswer(pc.answer, answer) };
}

export function projectCycle(g: Game, p: ProjectRecord) {
  if (p.status === 'failed') return;
  const founder = g.db.users[p.founderId];
  const salaries = p.members.filter((m) => m.npc).reduce((s, m) => s + m.salary, 0);
  const spend = salaries + p.budget.dev + p.budget.marketing + p.budget.community;
  let factor = 1;
  if (p.treasury < spend) {
    factor = spend > 0 ? Math.max(0, p.treasury / spend) : 1;
    p.ledger.unshift({ ts: Date.now(), text: `Underfunded cycle: paid ${(factor * 100).toFixed(0)}% of costs`, amount: -p.treasury });
    p.treasury = 0;
    p.status = p.status === 'struggling' ? 'failed' : 'struggling';
  } else {
    p.treasury = round2(p.treasury - spend);
    if (spend > 0) p.ledger.unshift({ ts: Date.now(), text: `Cycle costs (salaries $${salaries}, budget $${spend - salaries})`, amount: -spend });
    if (p.status === 'struggling') p.status = p.token ? 'launched' : 'active';
  }
  p.cycles++;
  const devs = p.members.filter((m) => /Developer|Designer/.test(m.role)).length;
  const kols = p.members.filter((m) => /KOL|Marketer/.test(m.role)).length;
  const cms = p.members.filter((m) => /Community/.test(m.role)).length;
  const rnd = () => 0.6 + Math.random() * 0.8;
  p.progress = Math.round(p.progress + (devs * 12 + p.budget.dev / 4) * factor * rnd());
  const words = (p.category + ' ' + p.narrative + ' ' + p.name).toLowerCase();
  const narrativeFit = g.market.mods.trending.some((t) => words.includes(t.replace(/-/g, ' ')) || words.includes(t)) ? 1.6 : 1;
  const sentiment = 1 + g.market.mods.sentiment * 0.3;
  const growth = (p.budget.marketing * 2 + kols * 40 + p.budget.community + cms * 15 + p.progress * 0.05) * narrativeFit * sentiment * (1 + p.reputation / 100) * rnd() * factor;
  const churn = p.users * (cms > 0 || p.budget.community > 0 ? 0.02 : 0.08);
  p.users = Math.max(0, Math.round(p.users + growth - churn));
  p.community = Math.round(p.users * (0.15 + cms * 0.05));
  const ms: [number, string][] = [[100, 'MVP'], [300, 'Testnet'], [600, 'Mainnet']];
  for (const [th, name] of ms) {
    if (p.progress >= th && !p.milestones.includes(name)) {
      p.milestones.push(name);
      p.reputation += 5;
      g.market.news(`${p.name} reaches ${name}`, `${p.category} project by @${p.founder} on ${p.chain}. ${p.users.toLocaleString()} users so far.`, [p.category.toLowerCase(), 'builders'], 'project');
      if (founder) {
        g.addXp(founder, 'founder', 80);
        g.addRep(founder, 'projects', 5);
        g.log(founder, 'project', `${p.name} hit the ${name} milestone.`);
        if (name === 'Mainnet') g.achieve(founder, 'project_launch');
      }
    }
  }
  if (p.status === 'failed' && founder) {
    g.notify(founder, `${p.name} ran out of money and shut down.`, 'warn');
    g.log(founder, 'project', `${p.name} failed after ${p.cycles} cycles. Lesson learned.`);
    g.market.news(`${p.name} shuts down`, 'Treasury depleted after consecutive underfunded cycles.', ['builders'], 'project');
  } else if (p.status === 'struggling' && founder) {
    g.notify(founder, `${p.name} is underfunded. Deposit to the treasury or cut costs, or it will fail next cycle.`, 'warn');
  }
  if (founder) { g.addXp(founder, 'founder', 10); g.pushMe(founder); }
}

export function register(g: Game) {
  const A = g.actions;

  // ---------- jobs ----------
  A['jobs.list'] = (u) => Object.values(g.db.jobs).filter((j) => j.open).map((j) => ({
    ...j, pay: round2(j.pay * (g.market.mods.jobPay[j.kind] ?? 1)), ineligible: eligibility(u, j),
    application: u.applications.find((a) => a.listingId === j.id)?.status ?? null,
  }));
  A['jobs.apply'] = (u, { id }) => {
    const j = g.db.jobs[id];
    assert(j && j.open, 'Job not found');
    assert(u.job?.listingId !== id, 'You already work there');
    assert(!u.applications.some((a) => a.listingId === id && a.status === 'pending'), 'Application already pending');
    const why = eligibility(u, j);
    u.applications = u.applications.filter((a) => a.listingId !== id);
    if (why) { u.applications.push({ listingId: id, status: 'rejected', ts: Date.now() }); return { status: 'rejected', reason: why }; }
    u.applications.push({ listingId: id, status: 'pending', ts: Date.now() });
    // hiring decision arrives a few seconds later
    setTimeout(() => {
      const a = u.applications.find((x) => x.listingId === id && x.status === 'pending');
      if (!a) return;
      const rep = g.reputation(u);
      const chance = clamp(0.75 + rep / 200 + ((u.skills[j.skill] ?? 0) - j.minSkill) / 3000, 0.5, 0.98);
      a.status = Math.random() < chance ? 'offered' : 'rejected';
      g.notify(u, a.status === 'offered' ? `📨 Job offer: ${j.title} at ${j.company} — $${j.pay}/shift. Open Jobs to accept.` : `${j.company} went with another candidate for ${j.title}.`, 'job');
      if (j.postedBy && a.status === 'offered') {
        const poster = g.db.users[j.postedBy];
        if (poster) g.notify(poster, `@${u.username} applied to ${j.title} and received an offer.`, 'job');
      }
      g.pushMe(u);
    }, 4000 + Math.random() * 4000);
    return { status: 'pending' };
  };
  A['jobs.accept'] = (u, { id }) => {
    const a = u.applications.find((x) => x.listingId === id && x.status === 'offered');
    assert(a, 'No offer for that job');
    const j = g.db.jobs[id];
    assert(j, 'Job closed');
    if (u.job) g.log(u, 'job', `Left ${u.job.title} at ${u.job.company} after ${u.job.shifts} shifts.`);
    u.job = { listingId: j.id, title: j.title, company: j.company, kind: j.kind, pay: j.pay, zone: j.zone, since: Date.now(), shifts: 0, lastShift: 0, projectId: j.projectId };
    u.applications = u.applications.filter((x) => x !== a);
    g.achieve(u, 'first_job');
    g.log(u, 'job', `Started working as ${j.title} at ${j.company}.`);
    if (j.projectId) {
      const p = g.db.projects[j.projectId];
      if (p) {
        p.members.push({ id: u.id, name: u.username, role: j.title, npc: false, salary: j.pay });
        const f = g.db.users[p.founderId];
        if (f) { g.notify(f, `@${u.username} joined ${p.name} as ${j.title}.`, 'job'); g.achieve(f, 'first_hire'); g.log(f, 'hire', `Hired @${u.username} as ${j.title} at ${p.name}.`); g.pushMe(f); }
        g.log(u, 'project', `Joined @${p.founder}'s project ${p.name}.`);
      }
    }
  };
  A['jobs.decline'] = (u, { id }) => { u.applications = u.applications.filter((x) => x.listingId !== id); };
  A['jobs.quit'] = (u) => {
    assert(u.job, 'You have no job');
    if (u.job.projectId) {
      const p = g.db.projects[u.job.projectId];
      if (p) p.members = p.members.filter((m) => m.id !== u.id);
    }
    g.log(u, 'job', `Left ${u.job.title} at ${u.job.company} after ${u.job.shifts} shifts.`);
    u.job = undefined;
  };
  A['jobs.startShift'] = (u) => {
    assert(u.job, 'You need a job first — visit the Jobs Center or open the Jobs app.');
    g.requireZone(u, u.job.zone);
    const wait = u.job.lastShift + SHIFT_COOLDOWN_MS - Date.now();
    assert(wait <= 0, `Take a break — next shift available in ${Math.ceil(wait / 1000)}s.`);
    return issueChallenge(g, u, u.job.kind, 'shift', undefined, u.job.pay >= 50);
  };
  A['jobs.submit'] = (u, { id, answer }) => {
    assert(u.job, 'No job');
    const { pc, correct } = takeChallenge(g, u, id, answer);
    assert(pc.purpose === 'shift', 'Wrong task');
    u.job.lastShift = Date.now();
    u.job.shifts++;
    const mult = g.market.mods.jobPay[u.job.kind] ?? 1;
    let pay = round2(u.job.pay * mult * (correct ? 1 : 0.3));
    const skill = CHALLENGE_SKILL[u.job.kind];
    let source = u.job.company;
    if (u.job.projectId) {
      const p = g.db.projects[u.job.projectId];
      if (!p || p.status === 'failed') { pay = 0; source = 'failed project'; }
      else {
        const paid = Math.min(pay, p.treasury);
        p.treasury = round2(p.treasury - paid);
        p.ledger.unshift({ ts: Date.now(), text: `Salary: @${u.username} (${u.job.title})`, amount: -paid });
        pay = paid;
        if (correct) { p.progress += u.job.kind === 'dev' ? 18 : 6; p.users += u.job.kind === 'community' || u.job.kind === 'creator' ? 40 : 0; }
      }
    }
    if (pay > 0) g.credit(u, pay, 'salary', `${u.job.title} shift at ${source}${correct ? '' : ' (partial — task incorrect)'}`);
    const xp = g.addXp(u, skill, correct ? 40 : 10);
    if (correct) g.addRep(u, 'work', 1);
    if (u.job.shifts >= 10) g.achieve(u, 'ten_shifts');
    return { correct, pay, xp, answer: pc.answer };
  };

  // ---------- projects ----------
  A['project.list'] = () => Object.values(g.db.projects).filter((p) => p.status !== 'failed').sort((a, b) => b.users - a.users).slice(0, 40);
  A['project.get'] = (_u, { id }) => { const p = g.db.projects[id]; assert(p, 'Project not found'); return p; };
  A['project.create'] = (u, { name, description, narrative, category, chain, seed }) => {
    g.requireZone(u, 'builderhub');
    const n = g.clean(name, 32);
    assert(n.length >= 3, 'Name your project (3+ characters)');
    assert(!Object.values(g.db.projects).some((p) => p.name.toLowerCase() === n.toLowerCase() && p.status !== 'failed'), 'A project with that name exists');
    assert(PROJECT_CATEGORIES.includes(category), 'Pick a category');
    assert(CHAINS.includes(chain), 'Pick a chain');
    assert(u.projects.filter((id) => g.db.projects[id]?.status !== 'failed').length < 3, 'You can run at most 3 active projects');
    const seedAmt = Math.max(0, round2(Number(seed) || 0));
    g.debit(u, PROJECT_FEE + seedAmt, 'project', `Registered ${n}${seedAmt ? ` + $${seedAmt} seed` : ''}`);
    const p: ProjectRecord = {
      id: uid('p'), name: n, description: g.clean(description, 280), narrative: g.clean(narrative, 120), category, chain,
      founderId: u.id, founder: u.username, members: [{ id: u.id, name: u.username, role: 'Founder', npc: false, salary: 0 }],
      treasury: seedAmt, users: 0, community: 0, progress: 0, reputation: 0, budget: { dev: 0, marketing: 0, community: 0 },
      milestones: [], status: 'active', equitySold: 0, ledger: seedAmt ? [{ ts: Date.now(), text: 'Founder seed', amount: seedAmt }] : [],
      created: Date.now(), cycles: 0,
    };
    g.db.projects[p.id] = p;
    u.projects.push(p.id);
    g.achieve(u, 'first_project');
    g.addXp(u, 'founder', 50);
    g.log(u, 'project', `Founded ${p.name}, a ${category} project on ${chain}.`);
    g.market.news(`New project: ${p.name}`, `@${u.username} registered a ${category} project on ${chain}. ${p.description}`, [category.toLowerCase(), 'builders'], 'project');
    return p;
  };
  const mine = (u: UserRec, id: string) => {
    const p = g.db.projects[id];
    assert(p && p.founderId === u.id, 'Not your project');
    assert(p.status !== 'failed', 'Project has failed');
    return p;
  };
  A['project.deposit'] = (u, { id, amount }) => {
    const p = g.db.projects[id];
    assert(p && p.status !== 'failed', 'Project not found');
    assert(p.members.some((m) => m.id === u.id) || u.id === p.founderId, 'Only team members can deposit');
    amount = round2(Number(amount));
    g.debit(u, amount, 'project', `Deposit to ${p.name} treasury`);
    p.treasury = round2(p.treasury + amount);
    p.ledger.unshift({ ts: Date.now(), text: `Deposit from @${u.username}`, amount });
    return p;
  };
  A['project.withdraw'] = (u, { id, amount }) => {
    const p = mine(u, id);
    amount = round2(Number(amount));
    assert(amount > 0 && amount <= p.treasury, 'Invalid amount');
    assert(p.equitySold === 0, 'Investor funds are locked: projects that raised money cannot withdraw the treasury to the founder.');
    p.treasury = round2(p.treasury - amount);
    p.ledger.unshift({ ts: Date.now(), text: 'Founder withdrawal', amount: -amount });
    g.credit(u, amount, 'project', `Withdrawal from ${p.name}`);
    return p;
  };
  A['project.hire'] = (u, { id, role }) => {
    const p = mine(u, id);
    const r = NPC_HIRES.find((x) => x.role === role);
    assert(r, 'Unknown role');
    assert(p.members.filter((m) => m.npc).length < 12, 'Team is full');
    const name = g.npcName();
    p.members.push({ id: uid('npc'), name: name + ' (NPC)', role: r.role, npc: true, salary: r.salary });
    p.ledger.unshift({ ts: Date.now(), text: `Hired ${name} (NPC ${r.role}, $${r.salary}/cycle)`, amount: 0 });
    g.achieve(u, 'first_hire');
    if (!u.journey.some((j) => j.kind === 'hire')) g.log(u, 'hire', `Hired a first team member for ${p.name}: ${name} (${r.role}).`);
    return p;
  };
  A['project.fire'] = (u, { id, memberId }) => {
    const p = mine(u, id);
    const m = p.members.find((x) => x.id === memberId);
    assert(m && m.role !== 'Founder', 'Member not found');
    p.members = p.members.filter((x) => x !== m);
    if (!m.npc) {
      const w = g.db.users[m.id];
      if (w?.job?.projectId === p.id) { w.job = undefined; g.notify(w, `You were let go from ${p.name}.`, 'job'); g.pushMe(w); }
    }
    return p;
  };
  A['project.budget'] = (u, { id, dev, marketing, community }) => {
    const p = mine(u, id);
    p.budget = { dev: clamp(Math.round(Number(dev) || 0), 0, 5000), marketing: clamp(Math.round(Number(marketing) || 0), 0, 5000), community: clamp(Math.round(Number(community) || 0), 0, 5000) };
    return p;
  };
  A['project.postJob'] = (u, { id, title, kind, pay }) => {
    const p = mine(u, id);
    assert(KINDS.includes(kind) && kind !== 'barista' && kind !== 'analyst', 'Pick a role type');
    const t = g.clean(title, 40) || `${kind} contributor`;
    pay = clamp(round2(Number(pay) || 0), 5, 500);
    const j: JobListing = { id: uid('job'), title: t, company: p.name, kind, pay, minLevel: 1, skill: CHALLENGE_SKILL[kind as ChallengeKind], minSkill: 0, zone: 'builderhub', description: `Join @${p.founder}'s ${p.category} project. Paid from the project treasury.`, projectId: p.id, postedBy: u.id, open: true };
    g.db.jobs[j.id] = j;
    return j;
  };
  A['project.closeJob'] = (u, { jobId }) => {
    const j = g.db.jobs[jobId];
    assert(j && j.postedBy === u.id, 'Not your listing');
    j.open = false;
  };
  A['project.pitch'] = (u, { id }) => {
    g.requireZone(u, 'vctower');
    const p = mine(u, id);
    const last = p.ledger.find((l) => l.text.startsWith('Pitch'));
    assert(!last || Date.now() - last.ts > 5 * 60_000, 'VCs need time — pitch again in a few minutes.');
    assert(p.equitySold < 40, 'You have sold enough equity.');
    const score = (p.progress / 300 + p.users / 2000 + p.reputation / 50 + g.reputation(u) / 100) * g.market.mods.fundraising * (1 + g.market.mods.sentiment * 0.3);
    const chance = clamp(0.1 + score * 0.25, 0.05, 0.85);
    const ok = Math.random() < chance;
    if (!ok) {
      p.ledger.unshift({ ts: Date.now(), text: 'Pitch declined by Seed Round Tower partners', amount: 0 });
      g.addXp(u, 'founder', 20);
      return { ok: false, chance, feedback: pick(['Come back with more users.', 'Traction is too early for us.', 'Great team, wrong narrative for this market.', 'We want to see the Testnet first.']) };
    }
    const valuation = Math.round(20_000 + p.users * 25 + p.progress * 200);
    const raise = Math.round(valuation * 0.1);
    p.treasury = round2(p.treasury + raise);
    p.equitySold += 10;
    p.reputation += 8;
    p.ledger.unshift({ ts: Date.now(), text: `Pitch success: raised $${raise.toLocaleString()} for 10% at $${valuation.toLocaleString()} valuation`, amount: raise });
    g.achieve(u, 'raised');
    g.addXp(u, 'founder', 150);
    g.addRep(u, 'projects', 8);
    g.log(u, 'raise', `Raised $${raise.toLocaleString()} for ${p.name} at a $${valuation.toLocaleString()} valuation.`);
    g.market.news(`${p.name} raises $${raise.toLocaleString()}`, `Seed Round Tower leads a round in @${u.username}'s ${p.category} project.`, ['funding', 'vc', p.category.toLowerCase()], 'project');
    return { ok: true, raise, valuation };
  };
  A['project.launchToken'] = (u, { id, sym }) => {
    g.requireZone(u, 'convention', 'builderhub');
    const p = mine(u, id);
    assert(p.milestones.includes('Mainnet'), 'Reach Mainnet before launching a token');
    assert(!p.token, 'Token already launched');
    sym = String(sym ?? '').toUpperCase();
    assert(/^[A-Z]{3,5}$/.test(sym), 'Ticker must be 3–5 letters');
    assert(!g.market.has(sym), 'Ticker taken');
    const price = round2(0.05 + p.users / 1e6) || 0.05;
    const supply = 100_000_000;
    g.market.register(sym, p.name, 1.6, p.category.toLowerCase(), supply, price, u.username);
    g.db.market.extraTokens.push({ sym, name: p.name, price, vol: 1.6, sector: p.category.toLowerCase(), supply, launchedBy: u.username });
    p.token = sym;
    p.status = 'launched';
    const alloc = 250_000;
    u.holdings[sym] = (u.holdings[sym] ?? 0) + alloc;
    u.costBasis[sym] = u.costBasis[sym] ?? 0;
    const sale = Math.round(p.users * 1);
    p.treasury = round2(p.treasury + sale);
    p.ledger.unshift({ ts: Date.now(), text: `Token launch ${sym}: public sale`, amount: sale });
    g.addXp(u, 'founder', 300);
    g.addRep(u, 'projects', 12);
    g.log(u, 'launch', `Launched the ${sym} token for ${p.name} at $${price}.`);
    g.market.news(`${sym} launches on Satoshi Square Exchange`, `${p.name} (by @${u.username}) is now tradable — simulated listing at $${price}.`, [sym.toLowerCase(), 'launch', p.category.toLowerCase()], 'project');
    g.io.broadcast({ t: 'tokens', list: g.market.list() });
    return p;
  };

  // ---------- airdrops ----------
  A['airdrop.list'] = (u) => QUESTS.map((q) => ({ ...q, progress: u.airdrops.find((a) => a.questId === q.id) ?? null }));
  A['airdrop.accept'] = (u, { id }) => {
    g.requireZone(u, 'airdrop');
    const q = QUESTS.find((x) => x.id === id);
    assert(q, 'Unknown campaign');
    const ex = u.airdrops.find((a) => a.questId === id);
    assert(!ex || (ex.status !== 'active' && Date.now() - ex.accepted > 60 * 60_000), 'Already joined this campaign (campaigns repeat hourly).');
    u.airdrops = u.airdrops.filter((a) => a.questId !== id);
    u.airdrops.push({ questId: id, accepted: Date.now(), done: {}, baseline: {}, status: 'active' });
    questHook(g, u, 'visit', { zone: g.zoneOf(u) });
  };
  A['airdrop.research'] = (u, { id }) => {
    const a = u.airdrops.find((x) => x.questId === id && x.status === 'active');
    assert(a, 'Join the campaign first');
    return issueChallenge(g, u, 'research', 'quest', id);
  };
  A['airdrop.submit'] = (u, { id, answer }) => {
    const { pc, correct } = takeChallenge(g, u, id, answer);
    assert(pc.purpose === 'quest', 'Wrong task');
    if (correct) questHook(g, u, 'research', { questId: pc.ref });
    g.addXp(u, 'research', correct ? 25 : 5);
    return { correct, answer: pc.answer };
  };
}

export { issueChallenge, takeChallenge };
