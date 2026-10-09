// Social graph, posts, chat channels, moderation, DAOs and events.

import { DAO_FEE } from '../../shared/catalog.js';
import { FEATURE_BY_ZONE } from '../../shared/city.js';
import type { ChatMessage, CityEvent, DaoRecord, Post } from '../../shared/types.js';
import type { UserRec } from '../db-core.js';
import type { Game } from '../game.js';
import { questHook } from '../quests.js';
import { assert, clamp, round2, uid } from '../util.js';
import { issueChallenge, takeChallenge } from './work.js';

export const EVENT_VENUES = ['convention', 'hackhouse', 'club', 'governance', 'nftgallery', 'whaleclub', 'cafe', 'grill'];
const EVENT_KINDS: CityEvent['kind'][] = ['conference', 'hackathon', 'trading_competition', 'token_launch', 'vc_summit', 'meme_convention', 'dao_assembly', 'party', 'meetup'];

function dmChannel(a: string, b: string) { return 'dm:' + [a, b].sort().join(':'); }

export function register(g: Game) {
  const A = g.actions;

  // ---------- follows & friends ----------
  A['social.follow'] = (u, { username, on }) => {
    const t = g.mustUser(username);
    assert(t.id !== u.id, 'That is you');
    if (on) {
      if (!u.following.includes(t.id)) { u.following.push(t.id); t.followerIds.push(u.id); g.notify(t, `@${u.username} followed you.`, 'social'); g.pushMe(t); }
    } else {
      u.following = u.following.filter((x) => x !== t.id);
      t.followerIds = t.followerIds.filter((x) => x !== u.id);
    }
  };
  A['friends.request'] = (u, { username }) => {
    const t = g.mustUser(username);
    assert(t.id !== u.id, 'That is you');
    assert(!t.blocked.includes(u.id), 'Request not allowed');
    if (u.friendRequests.includes(t.id)) return A['friends.accept'](u, { username }, g);
    assert(!u.friends.includes(t.id), 'Already friends');
    if (!t.friendRequests.includes(u.id)) t.friendRequests.push(u.id);
    g.notify(t, `👋 @${u.username} sent you a friend request.`, 'social');
    g.pushMe(t);
  };
  A['friends.accept'] = (u, { username }) => {
    const t = g.mustUser(username);
    assert(u.friendRequests.includes(t.id), 'No request from that player');
    u.friendRequests = u.friendRequests.filter((x) => x !== t.id);
    if (!u.friends.includes(t.id)) u.friends.push(t.id);
    if (!t.friends.includes(u.id)) t.friends.push(u.id);
    // record where they met — this is how emergent stories get into the season summary
    const zu = g.zoneOf(u);
    const where = zu === g.zoneOf(t) && zu !== 'street' ? ` at ${FEATURE_BY_ZONE[zu]?.name ?? 'a private home'}` : '';
    const live = Object.values(g.db.events).find((e) => e.status === 'live' && e.venue === zu);
    const ctx = live ? ` during ${live.name}` : where;
    g.log(u, 'friend', `Became friends with @${t.username}${ctx}.`);
    g.log(t, 'friend', `Became friends with @${u.username}${ctx}.`);
    g.achieve(u, 'friend'); g.achieve(t, 'friend');
    g.addRep(u, 'social', 1); g.addRep(t, 'social', 1);
    g.notify(t, `@${u.username} accepted your friend request.`, 'social');
    g.pushMe(t);
  };
  A['friends.decline'] = (u, { username }) => {
    const t = g.mustUser(username);
    u.friendRequests = u.friendRequests.filter((x) => x !== t.id);
  };
  A['friends.remove'] = (u, { username }) => {
    const t = g.mustUser(username);
    u.friends = u.friends.filter((x) => x !== t.id);
    t.friends = t.friends.filter((x) => x !== u.id);
    g.pushMe(t);
  };
  A['social.block'] = (u, { username, on }) => {
    const t = g.mustUser(username);
    assert(t.id !== u.id, 'That is you');
    if (on) {
      if (!u.blocked.includes(t.id)) u.blocked.push(t.id);
      u.friends = u.friends.filter((x) => x !== t.id);
      t.friends = t.friends.filter((x) => x !== u.id);
      u.following = u.following.filter((x) => x !== t.id);
      t.followerIds = t.followerIds.filter((x) => x !== u.id);
      u.friendRequests = u.friendRequests.filter((x) => x !== t.id);
    } else u.blocked = u.blocked.filter((x) => x !== t.id);
  };
  A['social.report'] = (u, { username, reason }) => {
    const t = g.mustUser(username);
    g.rateLimit(u.id + ':report', 3, 600_000);
    g.db.reports.push({ ts: Date.now(), by: u.id, target: t.id, reason: g.clean(reason, 200) });
    // only count distinct reporters, so one person can't tank someone's reputation
    const distinct = new Set(g.db.reports.filter((r) => r.target === t.id).map((r) => r.by)).size;
    t.reports = distinct;
    return { ok: true };
  };

  // ---------- posts ----------
  A['social.post'] = (u, { text }) => {
    const t = g.clean(text, 280);
    assert(t.length >= 2, 'Write something first');
    const now = Date.now();
    u.postTimes = u.postTimes.filter((x) => now - x < 60_000);
    assert(u.postTimes.length < 3, 'Posting too fast — wait a moment.');
    const recent = g.db.posts.filter((p) => p.authorId === u.id).slice(0, 5);
    assert(!recent.some((p) => p.text === t), "You've already posted that.");
    u.postTimes.push(now);
    const tags = [...new Set((t.match(/#[a-z0-9_-]{2,24}/gi) ?? []).map((x) => x.slice(1).toLowerCase()))];
    const p: Post = { id: uid('post'), author: u.username, authorId: u.id, text: t, tags, ts: now, likes: [], comments: [] };
    g.db.posts.unshift(p);
    if (g.db.posts.length > 600) g.db.posts.length = 600;
    g.addXp(u, 'creator', 6);
    g.achieve(u, 'first_post');
    questHook(g, u, 'post', { tags });
    g.io.broadcast({ t: 'post', post: p });
    return p;
  };
  A['social.like'] = (u, { id }) => {
    const p = g.db.posts.find((x) => x.id === id);
    assert(p, 'Post not found');
    assert(p.authorId !== u.id, "Can't like your own post");
    const a = g.db.users[p.authorId];
    if (p.likes.includes(u.username)) { p.likes = p.likes.filter((x) => x !== u.username); return p; }
    p.likes.push(u.username);
    if (a) {
      a.likesReceived++;
      if (!a.likers.includes(u.id)) { a.likers.push(u.id); g.addRep(a, 'social', 1); g.addXp(a, 'creator', 4); }
      if (a.likesReceived >= 100) g.achieve(a, 'influencer');
      g.pushMe(a);
    }
    return p;
  };
  A['social.comment'] = (u, { id, text }) => {
    const p = g.db.posts.find((x) => x.id === id);
    assert(p, 'Post not found');
    const t = g.clean(text, 200);
    assert(t.length >= 1, 'Empty comment');
    g.rateLimit(u.id + ':comment', 5, 30_000);
    p.comments.push({ author: u.username, text: t, ts: Date.now() });
    const a = g.db.users[p.authorId];
    if (a && a.id !== u.id) g.notify(a, `@${u.username} commented on your post: "${t.slice(0, 60)}"`, 'social');
    return p;
  };
  A['social.feed'] = (u, { mode, username }) => {
    let posts = g.db.posts.filter((p) => !u.blocked.includes(p.authorId));
    if (mode === 'following') posts = posts.filter((p) => u.following.includes(p.authorId) || p.authorId === u.id);
    if (mode === 'user') { const t = g.mustUser(username); posts = posts.filter((p) => p.authorId === t.id); }
    return posts.slice(0, 50);
  };
  A['social.trending'] = () => {
    const counts: Record<string, number> = {};
    const hour = Date.now() - 3_600_000;
    for (const p of g.db.posts) if (p.ts > hour) for (const t of p.tags) counts[t] = (counts[t] ?? 0) + 1 + p.likes.length;
    for (const t of g.market.mods.trending) counts[t] = (counts[t] ?? 0) + 3;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, n]) => ({ tag, n }));
  };
  A['social.search'] = (u, { q }) => {
    const s = String(q ?? '').toLowerCase().replace(/^@/, '');
    if (s.length < 1) return [];
    return Object.values(g.db.users).filter((x) => x.username.toLowerCase().includes(s) && !x.blocked.includes(u.id)).slice(0, 15).map((x) => ({ username: x.username, career: x.career, online: g.isOnline(x.id) }));
  };
  A['social.online'] = (u) => [...g.presence.entries()].filter(([id]) => id !== u.id).map(([id, p]) => {
    const x = g.db.users[id];
    return { username: x.username, career: x.career, zone: p.z, friend: u.friends.includes(id) };
  });

  // ---------- chat ----------
  A['chat.send'] = (u, { ch, text }) => {
    const t = g.clean(text, 300);
    assert(t.length > 0, 'Empty message');
    g.rateLimit(u.id + ':chat', 6, 5000);
    const pres = g.presence.get(u.id);
    const base = { id: uid('m'), from: u.username, fromId: u.id, text: t, ts: Date.now() };
    if (ch === 'nearby') {
      assert(pres, 'Offline');
      const rec = [...g.presence.entries()].filter(([, p]) => p.z === pres.z && Math.hypot(p.p[0] - pres.p[0], p.p[2] - pres.p[2]) < 30).map(([id]) => id);
      g.pushChat({ ...base, ch: 'nearby' }, rec);
      return;
    }
    if (ch === 'zone') {
      assert(pres, 'Offline');
      const rec = [...g.presence.entries()].filter(([, p]) => p.z === pres.z).map(([id]) => id);
      g.pushChat({ ...base, ch: 'zone:' + pres.z }, rec);
      return;
    }
    let m: ChatMessage;
    let rec: string[] = [];
    if (String(ch).startsWith('dm:')) {
      const t2 = g.mustUser(String(ch).slice(3));
      assert(t2.id !== u.id, 'That is you');
      assert(!t2.blocked.includes(u.id), `@${t2.username} isn't accepting your messages.`);
      assert(t2.privacy.allowDMs === 'everyone' || t2.friends.includes(u.id), `@${t2.username} only accepts messages from friends.`);
      m = { ...base, ch: dmChannel(u.username, t2.username) };
      rec = [u.id, t2.id];
    } else if (String(ch).startsWith('group:')) {
      const gr = g.db.groups[String(ch).slice(6)];
      assert(gr && gr.members.includes(u.id), 'Not in that group');
      m = { ...base, ch: 'group:' + gr.id };
      rec = gr.members;
    } else if (String(ch).startsWith('project:')) {
      const p = g.db.projects[String(ch).slice(8)];
      assert(p && p.members.some((x) => x.id === u.id), 'Not on that team');
      m = { ...base, ch: 'project:' + p.id };
      rec = p.members.filter((x) => !x.npc).map((x) => x.id);
    } else if (String(ch).startsWith('dao:')) {
      const d = g.db.daos[String(ch).slice(4)];
      assert(d && d.members.includes(u.id), 'Not a member');
      m = { ...base, ch: 'dao:' + d.id };
      rec = d.members;
    } else return g.fail('Unknown channel');
    g.db.chats.push(m);
    if (g.db.chats.length > 3000) g.db.chats.splice(0, g.db.chats.length - 3000);
    g.pushChat(m, rec);
  };
  A['chat.history'] = (u, { ch }) => {
    let key = String(ch);
    if (key.startsWith('dm:')) key = dmChannel(u.username, g.mustUser(key.slice(3)).username);
    if (key.startsWith('group:')) assert(g.db.groups[key.slice(6)]?.members.includes(u.id), 'Not in that group');
    if (key.startsWith('project:')) assert(g.db.projects[key.slice(8)]?.members.some((m) => m.id === u.id), 'Not on that team');
    if (key.startsWith('dao:')) assert(g.db.daos[key.slice(4)]?.members.includes(u.id), 'Not a member');
    return g.db.chats.filter((m) => m.ch === key && !u.blocked.includes(m.fromId)).slice(-80);
  };
  A['chat.conversations'] = (u) => {
    const keys = new Map<string, { ch: string; title: string; last: ChatMessage }>();
    for (const m of g.db.chats) {
      if (m.ch.startsWith('dm:')) {
        const parts = m.ch.slice(3).split(':');
        if (!parts.includes(u.username)) continue;
        const other = parts.find((x) => x !== u.username) ?? u.username;
        keys.set(m.ch, { ch: 'dm:' + other, title: '@' + other, last: m });
      } else if (m.ch.startsWith('group:')) {
        const gr = g.db.groups[m.ch.slice(6)];
        if (gr?.members.includes(u.id)) keys.set(m.ch, { ch: m.ch, title: '👥 ' + gr.name, last: m });
      } else if (m.ch.startsWith('project:')) {
        const p = g.db.projects[m.ch.slice(8)];
        if (p?.members.some((x) => x.id === u.id)) keys.set(m.ch, { ch: m.ch, title: '🚀 ' + p.name, last: m });
      } else if (m.ch.startsWith('dao:')) {
        const d = g.db.daos[m.ch.slice(4)];
        if (d?.members.includes(u.id)) keys.set(m.ch, { ch: m.ch, title: '🏛 ' + d.name, last: m });
      }
    }
    for (const gr of Object.values(g.db.groups)) if (gr.members.includes(u.id) && !keys.has('group:' + gr.id)) keys.set('group:' + gr.id, { ch: 'group:' + gr.id, title: '👥 ' + gr.name, last: { id: '', ch: '', from: '', fromId: '', text: 'Group created', ts: 0 } });
    return [...keys.values()].sort((a, b) => b.last.ts - a.last.ts);
  };
  A['groups.create'] = (u, { name, members }) => {
    const n = g.clean(name, 30);
    assert(n.length >= 2, 'Name the group');
    const ids = [u.id, ...((members ?? []) as string[]).map((m) => g.mustUser(m).id)];
    const gr = { id: uid('g'), name: n, members: [...new Set(ids)], owner: u.id };
    g.db.groups[gr.id] = gr;
    for (const id of gr.members) if (id !== u.id) g.notify(g.db.users[id], `@${u.username} added you to group "${n}".`, 'social');
    return gr;
  };

  // ---------- DAOs ----------
  A['dao.list'] = () => Object.values(g.db.daos).map((d) => ({ ...d, memberNames: d.members.map((id) => g.db.users[id]?.username) }));
  A['dao.create'] = (u, { name, purpose }) => {
    g.requireZone(u, 'governance');
    const n = g.clean(name, 32);
    assert(n.length >= 3, 'Name the DAO');
    g.debit(u, DAO_FEE, 'dao', `Registered DAO ${n}`);
    const d: DaoRecord = { id: uid('dao'), name: n, purpose: g.clean(purpose, 200), members: [u.id], treasury: 0, proposals: [], history: [{ ts: Date.now(), text: `Founded by @${u.username}` }] };
    g.db.daos[d.id] = d;
    u.daos.push(d.id);
    g.achieve(u, 'dao_founder');
    g.addRep(u, 'governance', 2);
    g.log(u, 'dao', `Founded the DAO "${n}".`);
    return d;
  };
  const dao = (id: string) => { const d = g.db.daos[id]; assert(d, 'DAO not found'); return d; };
  A['dao.join'] = (u, { id }) => {
    const d = dao(id);
    if (!d.members.includes(u.id)) { d.members.push(u.id); u.daos.push(d.id); d.history.unshift({ ts: Date.now(), text: `@${u.username} joined` }); }
    if (!u.journey.some((j) => j.kind === 'dao')) g.log(u, 'dao', `Joined the DAO "${d.name}".`);
  };
  A['dao.leave'] = (u, { id }) => {
    const d = dao(id);
    d.members = d.members.filter((x) => x !== u.id);
    u.daos = u.daos.filter((x) => x !== id);
  };
  A['dao.deposit'] = (u, { id, amount }) => {
    const d = dao(id);
    assert(d.members.includes(u.id), 'Members only');
    amount = round2(Number(amount));
    g.debit(u, amount, 'dao', `Deposit to ${d.name} treasury`);
    d.treasury = round2(d.treasury + amount);
    d.history.unshift({ ts: Date.now(), text: `@${u.username} deposited $${amount}` });
    g.addRep(u, 'governance', 1);
  };
  A['dao.propose'] = (u, { id, title, body, amount, recipient }) => {
    const d = dao(id);
    assert(d.members.includes(u.id), 'Members only');
    const t = g.clean(title, 60);
    assert(t.length >= 3, 'Add a title');
    const amt = Math.max(0, round2(Number(amount) || 0));
    if (amt > 0) g.mustUser(recipient);
    assert(d.proposals.filter((p) => p.status === 'open').length < 10, 'Too many open proposals');
    d.proposals.unshift({ id: uid('prop'), title: t, body: g.clean(body, 400), amount: amt, recipient: amt > 0 ? g.mustUser(recipient).username : '', by: u.username, yes: [], no: [], ends: Date.now() + 5 * 60_000, status: 'open' });
    d.history.unshift({ ts: Date.now(), text: `@${u.username} proposed "${t}"` });
    g.addXp(u, 'community', 15);
  };
  A['dao.vote'] = (u, { id, pid, yes }) => {
    const d = dao(id);
    assert(d.members.includes(u.id), 'Members only');
    const p = d.proposals.find((x) => x.id === pid);
    assert(p && p.status === 'open', 'Voting closed');
    p.yes = p.yes.filter((x) => x !== u.username);
    p.no = p.no.filter((x) => x !== u.username);
    (yes ? p.yes : p.no).push(u.username);
    g.addXp(u, 'community', 5);
    g.addRep(u, 'governance', 1);
    g.achieve(u, 'voter');
    questHook(g, u, 'vote');
  };

  // ---------- events ----------
  A['events.list'] = () => Object.values(g.db.events).filter((e) => e.status !== 'ended' || Date.now() - e.end < 30 * 60_000).sort((a, b) => a.start - b.start)
    .map((e) => ({ ...e, registered: e.registered.map((id) => g.db.users[id]?.username), attended: e.attended.length, baseline: undefined }));
  A['events.create'] = (u, a) => {
    const name = g.clean(a.name, 48);
    assert(name.length >= 3, 'Name your event');
    assert(EVENT_KINDS.includes(a.kind), 'Pick an event type');
    assert(EVENT_VENUES.includes(a.venue), 'Pick a venue');
    const startIn = clamp(Number(a.startInMin) || 2, 1, 120);
    const dur = clamp(Number(a.durationMin) || 10, 3, 60);
    const fee = clamp(round2(Number(a.fee) || 0), 0, 1000);
    const prize = clamp(round2(Number(a.prize) || 0), 0, 100_000);
    const cap = clamp(Math.floor(Number(a.capacity) || 50), 2, 500);
    assert(Object.values(g.db.events).filter((e) => e.organizerId === u.id && e.status !== 'ended').length < 3, 'You already have 3 upcoming events');
    if (prize > 0) g.debit(u, prize, 'event', `Prize pool escrow for ${name}`);
    const start = Date.now() + startIn * 60_000;
    const e: CityEvent = {
      id: uid('ev'), name, kind: a.kind, description: g.clean(a.description, 300), venue: a.venue, start, end: start + dur * 60_000,
      capacity: cap, fee, prize, rules: g.clean(a.rules, 300), organizer: u.username, organizerId: u.id,
      registered: [u.id], attended: [], baseline: {}, status: 'scheduled',
    };
    g.db.events[e.id] = e;
    u.events.push(e.id);
    g.achieve(u, 'event_host');
    g.log(u, 'event', `Organized "${name}" at ${FEATURE_BY_ZONE[a.venue].name}.`);
    g.market.news(`Event announced: ${name}`, `@${u.username} is hosting a ${a.kind.replace('_', ' ')} at ${FEATURE_BY_ZONE[a.venue].name}. ${fee ? `Entry $${fee} (simulated).` : 'Free entry.'}${prize ? ` Prize pool $${prize} (simulated).` : ''}`, ['events', a.kind], 'event');
    return e;
  };
  A['events.register'] = (u, { id }) => {
    const e = g.db.events[id];
    assert(e && e.status !== 'ended', 'Event not available');
    assert(!e.registered.includes(u.id), 'Already registered');
    assert(e.registered.length < e.capacity, 'Event is full');
    if (e.fee > 0) {
      g.debit(u, e.fee, 'event', `Entry: ${e.name}`);
      const org = e.organizerId ? g.db.users[e.organizerId] : null;
      if (org) { g.credit(org, e.fee * 0.95, 'event', `Ticket sale: ${e.name} (@${u.username}, 5% venue fee)`); g.pushMe(org); }
    }
    e.registered.push(u.id);
    if (!u.events.includes(e.id)) u.events.push(e.id);
    if (e.kind === 'trading_competition' && e.status === 'live') e.baseline[u.id] = 0;
  };
  A['events.react'] = (u, { emoji }) => {
    const pres = g.presence.get(u.id);
    assert(pres, 'Offline');
    const em = ['👏', '🔥', '🚀', '😂', '❤️', '🤔'].includes(emoji) ? emoji : '👏';
    g.rateLimit(u.id + ':react', 5, 5000);
    for (const [id, p] of g.presence) if (p.z === pres.z) g.io.send(id, { t: 'react', from: u.username, emoji: em });
  };
  A['events.hack'] = (u, { id }) => {
    const e = g.db.events[id];
    assert(e && e.kind === 'hackathon' && e.status === 'live', 'No live hackathon');
    g.requireZone(u, e.venue);
    assert(e.registered.includes(u.id), 'Register first');
    return issueChallenge(g, u, 'dev', 'hack', e.id);
  };
  A['events.hackSubmit'] = (u, { cid, answer }) => {
    const { pc, correct } = takeChallenge(g, u, cid, answer);
    assert(pc.purpose === 'hack', 'Wrong task');
    const e = g.db.events[pc.ref!];
    if (correct && e && e.status === 'live') e.baseline[u.id] = (e.baseline[u.id] ?? 0) + 1;
    g.addXp(u, 'dev', correct ? 30 : 5);
    return { correct, answer: pc.answer, score: e?.baseline[u.id] ?? 0 };
  };
}
