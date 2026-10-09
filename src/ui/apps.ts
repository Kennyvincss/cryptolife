// Phone apps. Every action here calls the authoritative server; nothing is decorative.

import {
  ACHIEVEMENTS, CAREERS, CHAINS, NPC_HIRES, POOLS, PROJECT_CATEGORIES, PROPERTY_BY_ID, QUESTS, SKILLS, VEHICLE_BY_ID, levelFromXp, xpForLevel,
} from '../../shared/catalog.js';
import { FEATURES, featureGeom } from '../../shared/city.js';
import type { CityEvent, DaoRecord, JobListing, Post, ProjectRecord, PublicProfile, RideCategory } from '../../shared/types.js';
import { api } from '../api.js';
import { audio } from '../audio/audio.js';
import { ORIGINALS, STATIONS, music } from '../audio/music.js';
import { act, tokenKey } from '../net/client.js';
import { clockString, fmt, portfolioValue, store } from '../state.js';
import { challengeView, profileCard, run, toast, tradingView } from './components.js';
import { SIM, add, badge, btn, field, h, input, invalidate, select, useData } from './dom.js';
import { ICONS } from './map.js';

export interface AppCtx { data: any; open: (app: string, data?: any) => void; close: () => void; panel: boolean }
export interface App { id: string; name: string; icon: string; color: string; deps?: string[]; render: (el: HTMLElement, rerender: () => void, ctx: AppCtx) => void }

const sub = (t: string) => h('h4.sub', t);

// ---------------------------------------------------------------- wallet
let sendTo = '', sendAmt = '', sendMemo = '';
let resolved: any = null;
const wallet: App = {
  id: 'wallet', name: 'Wallet', icon: '👛', color: '#38f2a5',
  render(el, rr, ctx) {
    const me = store.me!;
    if (ctx.data?.to && !sendTo) { sendTo = ctx.data.to; }
    add(el, 
      h('div.card.balance', h('small', 'Game wallet ', SIM()), h('div.big', fmt.usd(me.cash)), h('small.muted', `Portfolio ${fmt.usd(portfolioValue())} · Net worth ${fmt.usd(me.netWorth)}`)),
      h('div.card.warn', h('b', 'Real-asset wallet: not connected'), h('div.muted', 'This prototype uses simulated currency only. No real crypto can be deposited, withdrawn or sent. A reputable embedded-wallet provider can be plugged in later (see README → Real integrations).'), h('div', btn('Deposit', () => toast('Real deposits are disabled in this demo build.', 'warn'), 'ghost', false), btn('Withdraw', () => toast('Withdrawals are disabled — simulated funds are not withdrawable.', 'warn'), 'ghost'))),
      sub('Send by username'),
      h('div.form',
        input({ placeholder: '@username', value: sendTo, oninput: (e: Event) => { sendTo = (e.target as HTMLInputElement).value; resolved = null; } }),
        input({ type: 'number', placeholder: 'Amount ($)', value: sendAmt, oninput: (e: Event) => { sendAmt = (e.target as HTMLInputElement).value; } }),
        input({ placeholder: 'Memo (optional)', value: sendMemo, oninput: (e: Event) => { sendMemo = (e.target as HTMLInputElement).value; } }),
        resolved
          ? h('div.confirm', h('div', 'Send ', h('b', fmt.usd(Number(sendAmt) || 0)), ' to ', h('b', '@' + resolved.username), ` — ${resolved.career}, level ${resolved.level}${resolved.friend ? ', friend' : ''}, resident since ${new Date(resolved.since).toLocaleDateString()}`), h('small.muted', 'Simulated currency · no fee · internal ledger transfer'),
            h('div', btn('Confirm send', async () => { const r = await run(act('wallet.send', { to: resolved.username, amount: Number(sendAmt), memo: sendMemo }), `Sent ${fmt.usd(Number(sendAmt))} to @${resolved.username}`); if (r) { sendAmt = ''; sendMemo = ''; resolved = null; rr(); } }, 'primary'), btn('Cancel', () => { resolved = null; rr(); }, 'ghost')))
          : h('div', btn('Review', async () => { const r = await run(act('wallet.resolve', { to: sendTo })); if (r) { resolved = r; rr(); } }, 'primary'), btn('Request money', () => run(act('wallet.request', { to: sendTo, amount: Number(sendAmt), memo: sendMemo }), 'Request sent'), 'ghost')),
      ),
      me.paymentRequests.length ? sub('Payment requests') : null,
      me.paymentRequests.map((r) => h('div.item', h('div', h('b', '@' + r.from), ` requests ${fmt.usd(r.amount)}`, r.memo ? h('div.muted', r.memo) : null), h('div', btn('Pay', () => run(act('wallet.payRequest', { id: r.id }), 'Paid')), btn('Decline', () => run(act('wallet.declineRequest', { id: r.id })), 'ghost')))),
      sub('Transactions'),
      h('div.list.scroll', me.txs.map((t) => h('div.tx', h('div', h('b', t.memo), h('small.muted', ` ${t.kind} · ${fmt.ago(t.ts)} ago · ${t.status}`)), h('span.' + (t.amount >= 0 ? 'up' : 'dn'), (t.amount >= 0 ? '+' : '') + fmt.usd(t.amount))))),
    );
  },
};

// ---------------------------------------------------------------- market
const market: App = { id: 'market', name: 'Market', icon: '📈', color: '#3fa7ff', deps: ['me', 'prices'], render: (el, rr, ctx) => tradingView(el, rr, !ctx.panel) };

// ---------------------------------------------------------------- music
const musicApp: App = {
  id: 'music', name: 'Music', icon: '🎵', color: '#ff4fa3', deps: ['me', 'music'],
  render(el, rr) {
    const cur = music.current();
    add(el, 
      h('div.card.np', h('small.muted', music.playing ? 'NOW PLAYING' : 'PAUSED'), h('h3', cur.title), h('div', cur.artist, ' · ', h('small', cur.genre)),
        h('div.controls', btn('⏮', () => { music.prev(); rr(); }), btn(music.playing ? '⏸' : '▶', () => { music.toggle(); rr(); }, 'primary'), btn('⏭', () => { music.next(); rr(); })),
        h('label.field', h('span', 'Volume'), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: music.volume, oninput: (e: Event) => music.setVolume(Number((e.target as HTMLInputElement).value)) })),
        h('div.seg.small', btn('🎧 Headphones', () => { music.setOutput('headphones'); api.setSpeakerMusic(null); rr(); }, music.output === 'headphones' ? 'on' : ''), music.output === 'speaker' ? btn('🔊 Speakers (others in the room hear it)', () => {}, 'on') : null, music.output === 'car' ? btn('🚗 Car audio', () => {}, 'on') : null),
        h('small.muted', 'Catalog: Crypto City FM Originals — procedurally composed, royalty-free. Licensed-service integration slot available (see README).'),
      ),
      sub('Radio stations'),
      h('div.chips', Object.entries(STATIONS).map(([k, s]) => btn(s.name, () => { music.play(s.tracks[0], s.tracks); rr(); }, 'ghost'))),
      sub('Playlists'),
      music.playlists.map((p, i) => h('div.item', h('div', h('b', p.name), h('small.muted', ` ${p.tracks.length} tracks`)), h('div', btn('Play', () => { music.play(p.tracks[0], p.tracks); rr(); }), btn('+ Current', () => { if (!p.tracks.includes(cur.id)) p.tracks.push(cur.id); music.savePlaylists(); rr(); }, 'ghost'), btn('✕', () => { music.playlists.splice(i, 1); music.savePlaylists(); rr(); }, 'ghost')))),
      btn('New playlist', () => { const n = prompt('Playlist name?'); if (n) { music.playlists.push({ name: n.slice(0, 24), tracks: [] }); music.savePlaylists(); rr(); } }, 'ghost'),
      sub('Library'),
      h('div.list', ORIGINALS.map((t) => h('div.item' + (t.id === cur.id ? '.sel' : ''), { onclick: () => { music.play(t.id, ORIGINALS.map((x) => x.id)); rr(); } }, h('div', h('b', t.title), h('small.muted', ` ${t.artist} · ${t.genre} · ${t.bpm} bpm`)), h('span', t.id === cur.id && music.playing ? '♪' : '▶')))),
    );
  },
};

// ---------------------------------------------------------------- messages
let chatInput = '';
const messages: App = {
  id: 'messages', name: 'Messages', icon: '💬', color: '#4fb3ff', deps: ['me', 'chat'],
  render(el, rr, ctx) {
    const ch: string | undefined = ctx.data?.ch;
    if (ch) {
      const { data } = useData<any[]>('chat:' + ch, () => act('chat.history', { ch }), 4000, rr);
      const live = store.chat.filter((m) => m.ch === ch || (ch.startsWith('dm:') && m.ch.startsWith('dm:') && m.ch.split(':').includes(ch.slice(3))));
      const msgs = [...(data ?? []), ...live.filter((m) => !(data ?? []).some((d: any) => d.id === m.id))].sort((a, b) => a.ts - b.ts);
      const box = h('div.msgs.scroll', msgs.map((m) => h('div.msg' + (m.from === store.me!.username ? '.mine' : ''), h('small', '@' + m.from + ' · ' + fmt.ago(m.ts)), h('div', m.text))));
      const inp = input({ placeholder: 'Message…', value: chatInput, oninput: (e: Event) => (chatInput = (e.target as HTMLInputElement).value), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') send(); } });
      const send = async () => { if (!chatInput.trim()) return; const r = await run(act('chat.send', { ch, text: chatInput })); if (r !== undefined || true) { chatInput = ''; invalidate('chat:' + ch); rr(); } };
      add(el, h('div.chathead', btn('‹', () => ctx.open('messages'), 'ghost'), h('b', ch.startsWith('dm:') ? '@' + ch.slice(3) : ch)), box, h('div.row', inp, btn('Send', send, 'primary')));
      setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
      return;
    }
    const { data } = useData<any[]>('convos', () => act('chat.conversations'), 5000, rr);
    let to = '';
    add(el, 
      h('div.row', input({ placeholder: '@username', oninput: (e: Event) => (to = (e.target as HTMLInputElement).value) }), btn('New chat', () => { if (to) ctx.open('messages', { ch: 'dm:' + to.replace('@', '') }); }, 'primary')),
      btn('New group', async () => { const name = prompt('Group name?'); if (!name) return; const m = prompt('Members (comma separated usernames)?') ?? ''; const g = await run(act('groups.create', { name, members: m.split(',').map((s) => s.trim().replace('@', '')).filter(Boolean) })); if (g) { invalidate('convos'); ctx.open('messages', { ch: 'group:' + (g as any).id }); } }, 'ghost'),
      sub('Conversations'),
      (data ?? []).length ? (data ?? []).map((c) => h('div.item', { onclick: () => ctx.open('messages', { ch: c.ch }) }, h('div', h('b', c.title), h('div.muted', c.last.text?.slice(0, 60))), h('small.muted', c.last.ts ? fmt.ago(c.last.ts) : ''))) : h('p.muted', 'No conversations yet. Meet people at events, clubs and cafés — or message someone by username.'),
      sub('Friends'),
      store.me!.friends.map((f) => h('div.item', { onclick: () => ctx.open('messages', { ch: 'dm:' + f }) }, h('b', '@' + f), h('span', '💬'))),
      store.me!.friendRequests.length ? sub('Friend requests') : null,
      store.me!.friendRequests.map((f) => h('div.item', h('b', '@' + f), h('div', btn('Accept', () => run(act('friends.accept', { username: f }), 'Friend added')), btn('Decline', () => run(act('friends.decline', { username: f })), 'ghost')))),
    );
  },
};

// ---------------------------------------------------------------- social
let postText = '';
let feedMode: 'all' | 'following' = 'all';
let search = '';
const social: App = {
  id: 'social', name: 'Social', icon: '🌐', color: '#b46bff', deps: ['me', 'post'],
  render(el, rr, ctx) {
    if (ctx.data?.user) {
      const { data } = useData<PublicProfile>('prof:' + ctx.data.user, () => act('profile.get', { username: ctx.data.user }), 5000, rr);
      const posts = useData<Post[]>('feed:user:' + ctx.data.user, () => act('social.feed', { mode: 'user', username: ctx.data.user }), 8000, rr).data;
      add(el, btn('‹ Feed', () => ctx.open('social'), 'ghost'), data ? profileCard(data, rr) : h('p', 'Loading…'), sub('Posts'), (posts ?? []).map((p) => postView(p, rr, ctx)));
      return;
    }
    const { data } = useData<Post[]>('feed:' + feedMode, () => act('social.feed', { mode: feedMode }), 6000, rr);
    const trending = useData<{ tag: string; n: number }[]>('trending', () => act('social.trending'), 15000, rr).data;
    const found = search.length > 1 ? useData<any[]>('search:' + search, () => act('social.search', { q: search }), 5000, rr).data : null;
    const merged = [...store.posts.filter((p) => !(data ?? []).some((d) => d.id === p.id) && (feedMode === 'all')), ...(data ?? [])].sort((a, b) => b.ts - a.ts).slice(0, 50);
    add(el, 
      h('div.row', input({ placeholder: 'Search residents…', value: search, oninput: (e: Event) => { search = (e.target as HTMLInputElement).value; } , onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') rr(); } }), btn('Search', rr, 'ghost')),
      found ? h('div.list', found.map((u) => h('div.item', { onclick: () => ctx.open('social', { user: u.username }) }, h('b', '@' + u.username), h('small.muted', ` ${u.career}${u.online ? ' · online' : ''}`)))) : null,
      h('div.compose', h('textarea', { placeholder: 'What’s happening in Crypto City? Use #tags', maxlength: 280, value: postText, oninput: (e: Event) => (postText = (e.target as HTMLTextAreaElement).value) }),
        btn('Post', async () => { const r = await run(act('social.post', { text: postText })); if (r) { postText = ''; invalidate('feed:'); rr(); } }, 'primary')),
      trending?.length ? h('div.chips', trending.map((t) => badge('#' + t.tag))) : null,
      h('div.seg.small', btn('Everyone', () => { feedMode = 'all'; rr(); }, feedMode === 'all' ? 'on' : ''), btn('Following', () => { feedMode = 'following'; rr(); }, feedMode === 'following' ? 'on' : '')),
      merged.map((p) => postView(p, rr, ctx)),
    );
  },
};
function postView(p: Post, rr: () => void, ctx: AppCtx) {
  let c = '';
  const npc = p.authorId === 'npc';
  return h('div.post',
    h('div.ph', h('b', { onclick: () => !npc && ctx.open('social', { user: p.author }) , class: npc ? '' : 'link' }, npc ? p.author : '@' + p.author), npc ? badge('NPC') : null, h('small.muted', ' ' + fmt.ago(p.ts))),
    h('div', p.text),
    h('div.pa', btn(`♥ ${p.likes.length}`, () => run(act('social.like', { id: p.id })).then(() => { invalidate('feed:'); rr(); }), p.likes.includes(store.me!.username) ? 'ghost on' : 'ghost'), h('small.muted', `${p.comments.length} comments`)),
    p.comments.slice(-3).map((cm) => h('div.cm', h('b', '@' + cm.author), ' ', cm.text)),
    h('div.row', input({ placeholder: 'Comment…', oninput: (e: Event) => (c = (e.target as HTMLInputElement).value) }), btn('↩', () => run(act('social.comment', { id: p.id, text: c })).then(() => { invalidate('feed:'); rr(); }), 'ghost')));
}

// ---------------------------------------------------------------- rides
let rideDest = 'exchange';
let rideCat: RideCategory = 'economy';
const rides: App = {
  id: 'rides', name: 'CityRide', icon: '🚕', color: '#ffd23f',
  render(el, rr) {
    const me = store.me!;
    const r = me.ride;
    if (r && r.role === 'rider' && !['cancelled'].includes(r.status)) {
      add(el, h('div.card',
        h('h3', { completed: 'Ride complete', searching: 'Finding a driver…', assigned: 'Driver on the way', arrived: 'Your driver has arrived', onboard: 'On the way', cancelled: '' }[r.status]),
        r.driverName ? h('div', 'Driver: ', h('b', r.driverIsNpc ? r.driverName : '@' + r.driverName), r.driverIsNpc ? ' ' : '', r.driverIsNpc ? badge('NPC') : badge('PLAYER', 'ok'), ` ★ ${r.driverRating.toFixed(1)}`) : null,
        r.vehicleModel ? h('div', 'Vehicle: ', VEHICLE_BY_ID[r.vehicleModel]?.name ?? r.vehicleModel) : null,
        h('div', 'To: ', h('b', r.destName)), h('div', 'Fare: ', fmt.usd(r.fare), ' ', SIM(), h('small.muted', ` (${r.category})`)),
        r.status === 'assigned' && r.etaSec ? h('div.muted', 'Look for the car — it will pull up at the nearest curb. Walk to it and press F.') : null,
        r.status === 'arrived' ? h('div.ok', 'Walk to the car and press F to get in.') : null,
        r.status === 'onboard' ? h('div.muted', 'Sit back. You’ll be dropped at the entrance.') : null,
        r.status === 'completed' && !r.rated ? h('div', 'Rate your ride: ', [1, 2, 3, 4, 5].map((s) => btn('★'.repeat(s), () => run(act('ride.rate', { stars: s }), 'Thanks for rating!'), 'ghost small'))) : null,
        r.status === 'completed' ? btn('Done', () => run(act('ride.dismiss')), 'ghost') : null,
        ['searching', 'assigned', 'arrived'].includes(r.status) ? btn('Cancel ride', () => run(act('ride.cancel'), 'Ride cancelled'), 'ghost danger') : null,
      ));
      return;
    }
    const q = useData<{ fare: number; etaSec: number; playerDrivers: number }>('quote:' + rideDest + rideCat, () => act('ride.quote', { dest: rideDest, category: rideCat }), 5000, rr).data;
    add(el, 
      h('div.banner', 'Request a ride from your current location (outdoors). Fares are simulated currency.'),
      field('Destination', select(FEATURES.map((f) => [f.zone, `${ICONS[f.kind] ?? ''} ${f.name}`]), rideDest, (v) => { rideDest = v; rr(); })),
      h('div.seg', (['economy', 'premium', 'luxury', 'player'] as RideCategory[]).map((c) => btn(c === 'player' ? 'Player driver' : c[0].toUpperCase() + c.slice(1), () => { rideCat = c; rr(); }, rideCat === c ? 'on' : ''))),
      q ? h('div.card', h('div', 'Estimated fare: ', h('b', fmt.usd(q.fare)), ' ', SIM()), h('div.muted', `ETA ~${q.etaSec}s · ${q.playerDrivers} player driver(s) on duty${rideCat === 'player' && !q.playerDrivers ? ' — an NPC driver will be assigned instead' : ''}`)) : h('p.muted', 'Getting quote…'),
      btn('Request ride', () => run(act('ride.request', { dest: rideDest, category: rideCat }), 'Ride requested'), 'primary'),
      btn('Set GPS waypoint instead', () => { const f = FEATURES.find((x) => x.zone === rideDest)!; const d = featureGeom(f).door; api.waypoint(d[0], d[2], f.name); }, 'ghost'),
    );
  },
};

// ---------------------------------------------------------------- map
const mapApp: App = {
  id: 'map', name: 'Map', icon: '🗺', color: '#3fffb0',
  render(el) {
    add(el, btn('Open full map (M)', () => api.panel('bigmap'), 'primary'), sub('Places'),
      ...(['Trading', 'Builder', 'DeFi', 'Social', 'Creator', 'Residential', 'Automotive', 'Convention'] as const).map((d) => {
        const fs = FEATURES.filter((f) => d === 'Social' ? ['cafe', 'burger', 'grill', 'finedining', 'club', 'boutique', 'furniture'].includes(f.kind) : d === 'Trading' ? ['exchange', 'tradingfirm', 'research', 'whaleclub'].includes(f.kind) : d === 'Builder' ? ['builderhub', 'jobs', 'vctower', 'hackhouse'].includes(f.kind) : d === 'DeFi' ? ['defihub', 'airdrop', 'governance'].includes(f.kind) : d === 'Creator' ? ['nftgallery', 'studio', 'media'].includes(f.kind) : d === 'Residential' ? ['residence', 'realestate'].includes(f.kind) : d === 'Automotive' ? ['dealership', 'usedcars', 'customs', 'transport'].includes(f.kind) : f.kind === 'convention');
        return h('div', h('small.muted', d.toUpperCase()), fs.map((f) => h('div.item', { onclick: () => { const g = featureGeom(f).door; api.waypoint(g[0], g[2], f.name); } }, h('div', `${ICONS[f.kind] ?? ''} `, h('b', f.name), h('div.muted', f.blurb)), h('span', '📍'))));
      }));
  },
};

// ---------------------------------------------------------------- jobs
const jobsApp: App = {
  id: 'jobs', name: 'Jobs', icon: '💼', color: '#ffb03f',
  render(el, rr) {
    const me = store.me!;
    const { data } = useData<(JobListing & { ineligible: string | null; application: string | null })[]>('jobs', () => act('jobs.list'), 6000, rr);
    if (me.job) {
      const j = me.job;
      const next = Math.max(0, j.lastShift + 90_000 - Date.now());
      add(el, h('div.card', h('small.muted', 'CURRENT JOB'), h('h3', j.title), h('div', j.company, ' · ', fmt.usd(j.pay), '/shift ', SIM()), h('div.muted', `${j.shifts} shifts worked · work at ${FEATURES.find((f) => f.zone === j.zone)?.name}`),
        h('div', next > 0 ? `Next shift in ${Math.ceil(next / 1000)}s` : 'Ready for a shift — go to your workstation.'),
        h('div', btn('Navigate to work', () => { const f = FEATURES.find((x) => x.zone === j.zone)!; const d = featureGeom(f).door; api.waypoint(d[0], d[2], f.name); }), btn('Quit job', () => confirm('Quit your job?') && run(act('jobs.quit'), 'You quit.'), 'ghost danger'))));
    }
    const offers = me.applications.filter((a) => a.status === 'offered');
    if (offers.length) add(el, sub('Offers'), offers.map((o) => { const j = data?.find((x) => x.id === o.listingId); return h('div.item', h('div', h('b', j?.title ?? 'Job'), h('div.muted', j?.company)), h('div', btn('Accept', () => run(act('jobs.accept', { id: o.listingId }), 'Hired! Head to your workplace.').then(() => invalidate('jobs'))), btn('Decline', () => run(act('jobs.decline', { id: o.listingId })), 'ghost'))); }));
    add(el, sub('Open positions'), (data ?? []).map((j) => h('div.item.col',
      h('div', h('b', j.title), ' · ', j.company, j.projectId ? badge('player startup', 'ok') : null),
      h('div.muted', j.description),
      h('div', `${fmt.usd(j.pay)}/shift `, SIM(), ` · ${j.skill}${j.minSkill ? ' ≥ ' + j.minSkill + ' XP' : ''} · level ${j.minLevel}+`),
      j.ineligible ? h('small.dn', j.ineligible) : j.application === 'pending' ? badge('Application pending') : j.application === 'offered' ? badge('Offer received', 'ok') : j.application === 'rejected' ? h('div', badge('Rejected'), btn('Re-apply', () => run(act('jobs.apply', { id: j.id })).then(() => invalidate('jobs')), 'ghost small')) : me.job?.listingId === j.id ? badge('Your job', 'ok') : btn('Apply', async () => { const r = await run(act('jobs.apply', { id: j.id })); if (r) { toast(r.status === 'rejected' ? 'Rejected: ' + r.reason : 'Application sent — hear back in a few seconds.', r.status === 'rejected' ? 'warn' : 'ok'); invalidate('jobs'); rr(); } }, 'primary small'),
    )));
  },
};

// ---------------------------------------------------------------- projects
let newProj = { name: '', description: '', narrative: '', category: PROJECT_CATEGORIES[0], chain: CHAINS[0], seed: '' };
const projects: App = {
  id: 'projects', name: 'Projects', icon: '🚀', color: '#ff6b4f', deps: ['me'],
  render(el, rr, ctx) {
    const me = store.me!;
    if (ctx.data?.id) { projectDetail(el, rr, ctx, ctx.data.id); return; }
    const { data } = useData<ProjectRecord[]>('projects', () => act('project.list'), 8000, rr);
    add(el, sub('Your projects'), me.projects.length ? me.projects.map((id) => h('div.item', { onclick: () => ctx.open('projects', { id }) }, h('b', (data ?? []).find((p) => p.id === id)?.name ?? 'Project'), h('span', '›'))) : h('p.muted', 'None yet.'));
    const atHub = api.zone() === 'builderhub';
    add(el, sub('Start a project'), atHub ? h('div.form',
      input({ placeholder: 'Project name', value: newProj.name, oninput: (e: Event) => (newProj.name = (e.target as HTMLInputElement).value) }),
      h('textarea', { placeholder: 'Description', value: newProj.description, oninput: (e: Event) => (newProj.description = (e.target as HTMLTextAreaElement).value) }),
      input({ placeholder: 'Narrative (e.g. "AI agents for DeFi")', value: newProj.narrative, oninput: (e: Event) => (newProj.narrative = (e.target as HTMLInputElement).value) }),
      h('div.row', select(PROJECT_CATEGORIES.map((c) => [c, c]), newProj.category, (v) => (newProj.category = v)), select(CHAINS.map((c) => [c, c]), newProj.chain, (v) => (newProj.chain = v))),
      input({ type: 'number', placeholder: 'Seed treasury from your wallet ($)', value: newProj.seed, oninput: (e: Event) => (newProj.seed = (e.target as HTMLInputElement).value) }),
      h('small.muted', 'Registration fee $50 (simulated). Narratives matching what the city is talking about grow faster. Projects can fail.'),
      btn('Create project', async () => { const p = await run(act('project.create', newProj), 'Project created!'); if (p) { newProj = { name: '', description: '', narrative: '', category: PROJECT_CATEGORIES[0], chain: CHAINS[0], seed: '' }; invalidate('projects'); ctx.open('projects', { id: (p as ProjectRecord).id }); } }, 'primary'),
    ) : h('div.card', 'Visit ', h('b', 'Genesis Hub Coworking'), ' (Builder District) to register a project.', btn('Navigate', () => { const f = FEATURES.find((x) => x.zone === 'builderhub')!; const d = featureGeom(f).door; api.waypoint(d[0], d[2], f.name); }, 'ghost')));
    add(el, sub('City projects'), (data ?? []).map((p) => h('div.item', { onclick: () => ctx.open('projects', { id: p.id }) }, h('div', h('b', p.name), ' ', badge(p.status, p.status === 'launched' ? 'ok' : ''), h('div.muted', `${p.category} · ${p.chain} · @${p.founder} · ${p.users.toLocaleString()} users`)), h('span', '›'))));
  },
};
function projectDetail(el: HTMLElement, rr: () => void, ctx: AppCtx, id: string) {
  const { data: p, err } = useData<ProjectRecord>('proj:' + id, () => act('project.get', { id }), 4000, rr);
  if (!p) { add(el, btn('‹ Projects', () => ctx.open('projects'), 'ghost'), h('p', err ?? 'Loading…')); return; }
  const me = store.me!;
  const mine = p.founderId === me.id;
  const reload = () => { invalidate('proj:' + id); invalidate('projects'); rr(); };
  const b = { ...p.budget };
  add(el, btn('‹ Projects', () => ctx.open('projects'), 'ghost'),
    h('div.card', h('h3', p.name, ' ', badge(p.status, p.status === 'failed' ? 'bad' : p.status === 'launched' ? 'ok' : '')), h('div.muted', `${p.category} · ${p.chain} · founded by @${p.founder}`), h('p', p.description), p.narrative ? h('div', 'Narrative: ', h('i', p.narrative)) : null,
      h('div.stats', h('span', h('b', p.users.toLocaleString()), ' users'), h('span', h('b', p.community.toLocaleString()), ' community'), h('span', h('b', p.progress), ' dev progress'), h('span', 'Treasury ', h('b', fmt.usd(p.treasury)), ' ', SIM())),
      h('div', 'Milestones: ', p.milestones.length ? p.milestones.map((m) => badge(m, 'ok')) : h('span.muted', 'none yet (MVP at 100, Testnet 300, Mainnet 600)')),
      p.token ? h('div', 'Token: ', h('b', p.token), ' (tradable on the exchange)') : null,
      p.equitySold ? h('div.muted', `${p.equitySold}% equity sold to VCs`) : null),
    sub('Team'), p.members.map((m) => h('div.item', h('div', h('b', m.name), ` · ${m.role}`, m.npc ? badge('NPC') : badge('PLAYER', 'ok'), m.salary ? h('small.muted', ` $${m.salary}/${m.npc ? 'cycle' : 'shift'}`) : null), mine && m.role !== 'Founder' ? btn('Let go', () => run(act('project.fire', { id, memberId: m.id })).then(reload), 'ghost small') : null)),
    p.members.some((m) => m.id === me.id) ? btn('Team chat', () => ctx.open('messages', { ch: 'project:' + id }), 'ghost') : null,
  );
  if (mine && p.status !== 'failed') {
    let dep = '', wd = '', jobTitle = '', jobKind = 'dev', jobPay = '25', tick = '';
    add(el, 
      sub('Treasury'),
      h('div.row', input({ type: 'number', placeholder: 'Deposit $', oninput: (e: Event) => (dep = (e.target as HTMLInputElement).value) }), btn('Deposit', () => run(act('project.deposit', { id, amount: Number(dep) }), 'Deposited').then(reload))),
      p.equitySold === 0 ? h('div.row', input({ type: 'number', placeholder: 'Withdraw $', oninput: (e: Event) => (wd = (e.target as HTMLInputElement).value) }), btn('Withdraw', () => run(act('project.withdraw', { id, amount: Number(wd) }), 'Withdrawn').then(reload), 'ghost')) : h('small.muted', 'Investor funds are locked in the treasury.'),
      sub('Budget per cycle (every 3 min while you are active)'),
      ...(['dev', 'marketing', 'community'] as const).map((k) => h('label.field', h('span', `${k} $${b[k]}`), h('input', { type: 'range', min: 0, max: 500, step: 10, value: b[k], onchange: (e: Event) => { b[k] = Number((e.target as HTMLInputElement).value); run(act('project.budget', { id, ...b })).then(reload); } }))),
      h('small.muted', `Spend per cycle: ${fmt.usd(p.budget.dev + p.budget.marketing + p.budget.community + p.members.filter((m) => m.npc).reduce((s, m) => s + m.salary, 0))} · runs out → struggling → failed`),
      sub('Hire NPC staff'),
      h('div.chips', NPC_HIRES.map((r) => btn(`${r.role} $${r.salary}`, () => run(act('project.hire', { id, role: r.role }), `Hired a ${r.role}`).then(reload), 'ghost small'))),
      sub('Post a job for players'),
      h('div.row', input({ placeholder: 'Title', oninput: (e: Event) => (jobTitle = (e.target as HTMLInputElement).value) }), select([['dev', 'Developer'], ['community', 'Community'], ['research', 'Research'], ['creator', 'Creator']], 'dev', (v) => (jobKind = v)), input({ type: 'number', value: '25', style: { width: '70px' }, oninput: (e: Event) => (jobPay = (e.target as HTMLInputElement).value) })),
      btn('Post job (paid from treasury per shift)', () => run(act('project.postJob', { id, title: jobTitle, kind: jobKind, pay: Number(jobPay) }), 'Job posted on the Jobs board').then(() => invalidate('jobs')), 'ghost'),
      sub('Growth'),
      h('div', btn('Pitch VCs (Seed Round Tower)', async () => {
        if (api.zone() !== 'vctower') { toast('Go to Seed Round Tower to pitch.', 'warn'); const f = FEATURES.find((x) => x.zone === 'vctower')!; const d = featureGeom(f).door; api.waypoint(d[0], d[2], f.name); return; }
        const r = await run(act('project.pitch', { id }));
        if (r) toast(r.ok ? `Raised ${fmt.usd(r.raise)} at ${fmt.usd(r.valuation)} valuation!` : `Declined (${Math.round(r.chance * 100)}% chance): ${r.feedback}`, r.ok ? 'money' : 'warn');
        reload();
      }, 'primary'),
      p.milestones.includes('Mainnet') && !p.token ? h('div.row', input({ placeholder: 'Ticker (3–5 letters)', oninput: (e: Event) => (tick = (e.target as HTMLInputElement).value) }), btn('Launch token', () => run(act('project.launchToken', { id, sym: tick }), 'Token launched on the exchange!').then(reload))) : null),
    );
  } else if (p.status !== 'failed' && !p.members.some((m) => m.id === me.id)) {
    let amt = '';
    add(el, h('small.muted', 'Want in? Apply to this project’s jobs in the Jobs app, or contact the founder.'), h('div', btn('Message founder', () => ctx.open('messages', { ch: 'dm:' + p.founder }), 'ghost')));
    void amt;
  }
  add(el, sub('Financial records'), h('div.list.scroll', p.ledger.slice(0, 30).map((l) => h('div.tx', h('div', l.text, h('small.muted', ' ' + fmt.ago(l.ts))), h('span.' + (l.amount >= 0 ? 'up' : 'dn'), l.amount ? fmt.usd(l.amount) : '')))));
}

// ---------------------------------------------------------------- events
let evForm = { name: '', kind: 'meetup', description: '', venue: 'cafe', startInMin: '3', durationMin: '10', capacity: '50', fee: '0', prize: '0', rules: '' };
const events: App = {
  id: 'events', name: 'Events', icon: '🎤', color: '#ffe14f',
  render(el, rr, ctx) {
    const { data } = useData<any[]>('events', () => act('events.list'), 5000, rr);
    if (data) store.events = data;
    const me = store.me!;
    const venueName = (z: string) => FEATURES.find((f) => f.zone === z)?.name ?? z;
    const hackLive = (data ?? []).find((e) => e.kind === 'hackathon' && e.status === 'live' && e.venue === api.zone());
    if (hackLive && ctx.data?.venue) {
      add(el, h('div.card', h('h3', '💻 ', hackLive.name, ' — LIVE'), h('div.muted', hackLive.rules), hackLive.registered.includes(me.username) ? btn('Get a challenge', async () => {
        const c = await run(act('events.hack', { id: hackLive.id }));
        if (!c) return;
        const box = h('div');
        el.prepend(box);
        challengeView(box, c, (answer) => act('events.hackSubmit', { cid: c.id, answer }), () => { box.remove(); });
      }, 'primary') : btn('Register', () => run(act('events.register', { id: hackLive.id }), 'Registered').then(() => invalidate('events')), 'primary')));
    }
    add(el, sub('Upcoming & live'), (data ?? []).map((e: CityEvent & { attended: number }) => h('div.item.col',
      h('div', h('b', e.name), ' ', badge(e.status === 'live' ? '● LIVE' : e.status, e.status === 'live' ? 'ok' : ''), ' ', badge(e.kind.replace('_', ' '))),
      h('div.muted', `${venueName(e.venue)} · ${e.status === 'scheduled' ? 'starts in ' + Math.max(0, Math.round((e.start - Date.now()) / 60000)) + ' min' : e.status === 'live' ? 'ends in ' + Math.max(0, Math.round((e.end - Date.now()) / 60000)) + ' min' : 'ended'} · by ${e.organizerId ? '@' + e.organizer : 'Crypto City'}`),
      e.description ? h('div', e.description) : null,
      h('div.muted', `${e.registered.length}/${e.capacity} registered · ${e.attended} attended${e.fee ? ` · entry ${fmt.usd(e.fee)}` : ' · free'}${e.prize ? ` · prize pool ${fmt.usd(e.prize)}` : ''} (simulated)`),
      e.results?.length ? h('div', 'Results: ', e.results.map((r, i) => `#${i + 1} @${r.name} (${r.score}) ${r.prize ? fmt.usd(r.prize) : ''}`).join(' · ')) : null,
      h('div', e.status !== 'ended' && !e.registered.includes(me.username) ? btn('Register', () => run(act('events.register', { id: e.id }), 'Registered').then(() => { invalidate('events'); rr(); }), 'primary small') : e.registered.includes(me.username) ? badge('Registered', 'ok') : null,
        btn('Navigate', () => { const f = FEATURES.find((x) => x.zone === e.venue)!; const d = featureGeom(f).door; api.waypoint(d[0], d[2], f.name); }, 'ghost small')),
    )));
    add(el, sub('Host an event'), h('div.form',
      input({ placeholder: 'Event name', value: evForm.name, oninput: (e: Event) => (evForm.name = (e.target as HTMLInputElement).value) }),
      h('div.row', select([['meetup', 'Meetup'], ['party', 'Party'], ['conference', 'Conference'], ['hackathon', 'Hackathon'], ['trading_competition', 'Trading competition'], ['token_launch', 'Token launch'], ['vc_summit', 'VC summit'], ['meme_convention', 'Meme convention'], ['dao_assembly', 'DAO assembly']], evForm.kind, (v) => (evForm.kind = v)),
        select(['convention', 'hackhouse', 'club', 'governance', 'nftgallery', 'whaleclub', 'cafe', 'grill'].map((z) => [z, venueName(z)]), evForm.venue, (v) => (evForm.venue = v))),
      h('textarea', { placeholder: 'Description', value: evForm.description, oninput: (e: Event) => (evForm.description = (e.target as HTMLTextAreaElement).value) }),
      h('div.grid2', ...(['startInMin', 'durationMin', 'capacity', 'fee', 'prize'] as const).map((k) => field({ startInMin: 'Starts in (min)', durationMin: 'Duration (min)', capacity: 'Capacity', fee: 'Entry fee $', prize: 'Prize pool $ (escrowed)' }[k], input({ type: 'number', value: evForm[k], oninput: (e: Event) => (evForm[k] = (e.target as HTMLInputElement).value) })))),
      input({ placeholder: 'Rules', value: evForm.rules, oninput: (e: Event) => (evForm.rules = (e.target as HTMLInputElement).value) }),
      h('small.muted', 'Fees and prizes use simulated currency. Real-money competitions are disabled until legal, security and payment controls exist.'),
      btn('Create event', () => run(act('events.create', evForm), 'Event created and announced!').then((r) => { if (r) { invalidate('events'); rr(); } }), 'primary')));
  },
};

// ---------------------------------------------------------------- news
const news: App = {
  id: 'news', name: 'News', icon: '📰', color: '#ff5a6e', deps: ['news'],
  render(el) {
    add(el, h('div.banner.sim', 'All headlines are SIMULATED in-game events.'), h('div.chips', store.trending.map((t) => badge('#' + t))),
      store.news.map((n) => h('div.news', h('small.muted', `${n.kind.toUpperCase()} · ${fmt.ago(n.ts)} ago`), h('b', n.title), h('div', n.body), h('div', n.tags.map((t) => badge('#' + t))))));
  },
};

// ---------------------------------------------------------------- profile
const profile: App = {
  id: 'profile', name: 'Profile', icon: '🪪', color: '#9fd36b',
  render(el, rr, ctx) {
    const me = store.me!;
    const lvl = levelFromXp(me.xp);
    const next = xpForLevel(lvl + 1), cur = xpForLevel(lvl);
    const summary = ctx.data?.summary ? useData<any>('summary', () => act('summary'), 10000, rr).data : null;
    add(el, 
      h('div.card', h('h3', '@' + me.username), h('div', select(CAREERS.map((c) => [c.id, c.id]), me.career, (v) => run(act('profile.setCareer', { career: v }), 'Career focus updated'))), h('small.muted', CAREERS.find((c) => c.id === me.career)?.desc ?? ''),
        h('div', `Level ${lvl} · ${me.xp} XP`), h('div.bar', h('i', { style: { width: Math.min(100, ((me.xp - cur) / (next - cur)) * 100) + '%' } })),
        h('div', `Reputation ${me.reputation} · ${me.followers} followers · ${me.friends.length} friends`),
        h('div', `Wallet ${fmt.usd(me.cash)} · Net worth ${fmt.usd(me.netWorth)} `, SIM())),
      sub('Skills'), h('div.skills', SKILLS.map((s) => h('div.skill', h('span', s), h('div.bar', h('i', { style: { width: Math.min(100, (me.skills[s] ?? 0) / 30) + '%' } })), h('small', String(me.skills[s] ?? 0))))),
      sub('Reputation sources'), h('div.chips', Object.entries(me.repBreakdown).map(([k, v]) => badge(`${k} ${v}`))),
      sub('Achievements'), h('div.chips', me.achievements.length ? me.achievements.map((a) => badge('🏆 ' + (ACHIEVEMENTS[a] ?? a), 'ok')) : h('span.muted', 'None yet')),
      sub('Privacy — what others can see'),
      ...(['showBalance', 'showPortfolio', 'showVehicles', 'showHome'] as const).map((k) => h('label.check', h('input', { type: 'checkbox', checked: me.privacy[k], onchange: (e: Event) => run(act('profile.setPrivacy', { privacy: { ...me.privacy, [k]: (e.target as HTMLInputElement).checked } })) }), { showBalance: 'Wallet balance', showPortfolio: 'Net worth (also shown on the wealth leaderboard)', showVehicles: 'Vehicles', showHome: 'Home' }[k])),
      h('label.check', h('input', { type: 'checkbox', checked: me.privacy.allowDMs === 'friends', onchange: (e: Event) => run(act('profile.setPrivacy', { privacy: { ...me.privacy, allowDMs: (e.target as HTMLInputElement).checked ? 'friends' : 'everyone' } })) }), 'Only friends can message me'),
      sub('Your story so far'),
      summary ? h('div.card.story', h('small.muted', `SEASON ${summary.season} SUMMARY — built from your recorded activity`), summary.lines.map((l: string) => h('p', l)), h('div.muted', `Net worth ${fmt.usd(summary.stats.netWorth)} · level ${summary.stats.level} · reputation ${summary.stats.reputation} · ${summary.stats.trades} trades (realized ${fmt.usd(summary.stats.realizedPnl)}) · ${summary.stats.rides} rides driven · top skill: ${summary.stats.topSkill}`))
        : btn('Generate season summary', () => ctx.open('profile', { summary: true }), 'primary'),
      sub('Journey log'), h('div.list.scroll', me.journey.slice().reverse().map((j) => h('div.tx', h('div', j.text), h('small.muted', fmt.ago(j.ts))))),
      h('div', btn('Leaderboards', () => ctx.open('leaders'), 'ghost'), btn('Settings', () => ctx.open('settings'), 'ghost'), btn('Sign out', () => { localStorage.removeItem(tokenKey()); location.reload(); }, 'ghost danger')),
    );
  },
};

// ---------------------------------------------------------------- airdrops
const airdrops: App = {
  id: 'airdrops', name: 'Airdrops', icon: '🪂', color: '#ff4fa3',
  render(el, rr) {
    const me = store.me!;
    const atCenter = api.zone() === 'airdrop';
    add(el, h('div.banner.sim', 'Simulated protocols. Outcomes vary and some campaigns pay nothing. Never promised real-world airdrops.'),
      !atCenter ? h('div.card', 'Join campaigns at the ', h('b', 'Airdrop Center'), ' (DeFi District). Progress is tracked anywhere.', btn('Navigate', () => { const f = FEATURES.find((x) => x.zone === 'airdrop')!; const d = featureGeom(f).door; api.waypoint(d[0], d[2], f.name); }, 'ghost')) : null);
    for (const q of QUESTS) {
      const pr = me.airdrops.find((a) => a.questId === q.id);
      const left = pr && pr.status === 'active' ? Math.max(0, pr.accepted + q.durationMin * 60000 - Date.now()) : 0;
      add(el, h('div.item.col',
        h('div', h('b', q.protocol), ' ', pr ? badge(pr.status, pr.status === 'paid' ? 'ok' : pr.status === 'active' ? '' : 'bad') : null),
        h('div.muted', q.desc),
        h('ul.tasks', q.tasks.map((t) => h('li' + (pr?.done[t.id] ? '.done' : ''), (pr?.done[t.id] ? '✔ ' : '○ ') + t.label + (t.kind === 'trade_volume' && pr ? ` ($${Math.round(pr.baseline[t.id] ?? 0)}/${t.amount})` : ''),
          t.kind === 'research' && pr?.status === 'active' && !pr.done[t.id] ? btn('Take quiz', async () => {
            const c = await run(act('airdrop.research', { id: q.id }));
            if (!c) return;
            const box = h('div'); el.prepend(box);
            challengeView(box, c, (answer) => act('airdrop.submit', { id: c.id, answer }), () => { box.remove(); rr(); });
          }, 'ghost small') : null))),
        h('small.muted', `Snapshot ${q.durationMin} min after joining. Possible outcomes: ${q.outcomes.map((o) => `${o.label} (${o.reward ? fmt.usd(o.reward) : 'nothing'})`).join(' / ')}`),
        pr?.status === 'active' ? h('div', `Snapshot in ${Math.ceil(left / 60000)} min`) : pr?.status === 'paid' ? h('div.up', `Received ${fmt.usd(pr.reward ?? 0)}`) : null,
        (!pr || pr.status !== 'active') && atCenter ? btn(pr ? 'Join again' : 'Join campaign', () => run(act('airdrop.accept', { id: q.id }), 'Joined campaign'), 'primary small') : null,
      ));
    }
  },
};

// ---------------------------------------------------------------- dao
const daoApp: App = {
  id: 'dao', name: 'DAOs', icon: '🏛', color: '#e8e4da',
  render(el, rr, ctx) {
    const me = store.me!;
    const { data } = useData<(DaoRecord & { memberNames: string[] })[]>('daos', () => act('dao.list'), 5000, rr);
    const reload = () => { invalidate('daos'); rr(); };
    if (ctx.data?.id) {
      const d = data?.find((x) => x.id === ctx.data.id);
      if (!d) { add(el, h('p', 'Loading…')); return; }
      const member = d.members.includes(me.id);
      let dep = '', pt = '', pb = '', pa = '', prc = '';
      add(el, btn('‹ DAOs', () => ctx.open('dao'), 'ghost'), h('div.card', h('h3', d.name), h('div', d.purpose), h('div', `Treasury ${fmt.usd(d.treasury)} `, SIM(), ` · ${d.members.length} members`), h('small.muted', 'Governance runs in the game database in this prototype (not on-chain).'),
        member ? h('div', btn('Leave', () => run(act('dao.leave', { id: d.id })).then(reload), 'ghost'), btn('DAO chat', () => ctx.open('messages', { ch: 'dao:' + d.id }), 'ghost')) : btn('Join', () => run(act('dao.join', { id: d.id }), 'Joined').then(reload), 'primary')),
        member ? h('div.row', input({ type: 'number', placeholder: 'Deposit $', oninput: (e: Event) => (dep = (e.target as HTMLInputElement).value) }), btn('Deposit', () => run(act('dao.deposit', { id: d.id, amount: Number(dep) }), 'Deposited').then(reload))) : null,
        sub('Proposals'),
        d.proposals.map((p) => h('div.item.col', h('div', h('b', p.title), ' ', badge(p.status, p.status === 'executed' || p.status === 'passed' ? 'ok' : p.status === 'rejected' ? 'bad' : '')), h('div', p.body), p.amount ? h('div.muted', `Requests ${fmt.usd(p.amount)} → @${p.recipient}`) : null, h('div', `Yes ${p.yes.length} · No ${p.no.length} · by @${p.by}${p.status === 'open' ? ' · closes in ' + Math.max(0, Math.ceil((p.ends - Date.now()) / 60000)) + ' min' : ''}`),
          member && p.status === 'open' ? h('div', btn('Vote yes', () => run(act('dao.vote', { id: d.id, pid: p.id, yes: true }), 'Voted').then(reload), 'small'), btn('Vote no', () => run(act('dao.vote', { id: d.id, pid: p.id, yes: false }), 'Voted').then(reload), 'ghost small')) : null)),
        member ? h('div.form', sub('New proposal'), input({ placeholder: 'Title', oninput: (e: Event) => (pt = (e.target as HTMLInputElement).value) }), h('textarea', { placeholder: 'Details', oninput: (e: Event) => (pb = (e.target as HTMLTextAreaElement).value) }), h('div.row', input({ type: 'number', placeholder: 'Grant $ (optional)', oninput: (e: Event) => (pa = (e.target as HTMLInputElement).value) }), input({ placeholder: '@recipient', oninput: (e: Event) => (prc = (e.target as HTMLInputElement).value) })), btn('Submit proposal', () => run(act('dao.propose', { id: d.id, title: pt, body: pb, amount: Number(pa) || 0, recipient: prc.replace('@', '') }), 'Proposal submitted').then(reload), 'primary')) : null,
        sub('History'), h('div.list', d.history.slice(0, 15).map((x) => h('div.tx', x.text, h('small.muted', fmt.ago(x.ts))))));
      return;
    }
    let n = '', pu = '';
    add(el, sub('DAOs'), (data ?? []).length ? (data ?? []).map((d) => h('div.item', { onclick: () => ctx.open('dao', { id: d.id }) }, h('div', h('b', d.name), h('div.muted', `${d.members.length} members · treasury ${fmt.usd(d.treasury)}`)), d.members.includes(me.id) ? badge('member', 'ok') : h('span', '›'))) : h('p.muted', 'No DAOs yet — found the first one.'),
      api.zone() === 'governance' ? h('div.form', sub('Found a DAO ($25)'), input({ placeholder: 'Name', oninput: (e: Event) => (n = (e.target as HTMLInputElement).value) }), input({ placeholder: 'Purpose', oninput: (e: Event) => (pu = (e.target as HTMLInputElement).value) }), btn('Create DAO', () => run(act('dao.create', { name: n, purpose: pu }), 'DAO created').then(reload), 'primary'))
        : h('small.muted', 'Create DAOs at the Governance Hall (DeFi District). You can join and vote from anywhere.'));
  },
};

// ---------------------------------------------------------------- leaderboards
let lbCat = 'reputation';
const leaders: App = {
  id: 'leaders', name: 'Leaders', icon: '🏆', color: '#d4af37',
  render(el, rr) {
    const cats: [string, string][] = [['reputation', 'Reputation'], ['wealth', 'Wealth'], ['trading', 'Trading'], ['founders', 'Founders'], ['investors', 'Investors'], ['kols', 'KOLs'], ['airdrop', 'Airdrop'], ['developers', 'Developers'], ['drivers', 'Drivers'], ['social', 'Social']];
    const { data } = useData<any[]>('lb:' + lbCat, () => act('leaderboard', { cat: lbCat }), 10000, rr);
    add(el, h('div.chips', cats.map(([k, l]) => btn(l, () => { lbCat = k; rr(); }, lbCat === k ? 'on small' : 'ghost small'))),
      h('small.muted', { trading: 'Score = realized P&L × consistency (win rate). Needs 3+ closed trades.', wealth: 'Net worth (simulated). Hidden for players who keep their portfolio private.', kols: 'Unique likers and followers who are level 2+ (anti-spam).', social: 'Followers at level 2+ only.', reputation: 'Reputation from work, events, projects, trading consistency, community — capped hourly per source.' }[lbCat] ?? ''),
      h('ol.lb', (data ?? []).map((r) => h('li', h('b', '@' + r.name), h('small.muted', ` ${r.career} · L${r.level}`), h('span.r', r.score < 0 ? 'private' : lbCat === 'wealth' || lbCat === 'trading' ? fmt.usd(r.score, 0) : Math.round(r.score).toLocaleString())))),
      !(data ?? []).length ? h('p.muted', 'No entries yet.') : null);
  },
};

// ---------------------------------------------------------------- drive
const drive: App = {
  id: 'drive', name: 'Drive', icon: '🚗', color: '#38f2a5',
  render(el, rr) {
    const me = store.me!;
    const d = me.driver;
    const r = me.ride && me.ride.role === 'driver' ? me.ride : null;
    add(el, h('div.card', h('h3', 'CityRide Driver'), d.registered ? h('div', `${d.rides} rides · rating ${d.ratingCount ? (d.ratingSum / d.ratingCount).toFixed(2) : '—'} · earned ${fmt.usd(d.earnings)} `, SIM()) : h('div', 'Register at ', h('b', 'CityRide HQ'), ' (Automotive District) with a car that has passenger seats.'),
      d.registered ? btn(d.onDuty ? 'Go off duty' : 'Go on duty (must be in your car)', () => run(act('driver.duty', { on: !d.onDuty }), d.onDuty ? 'Off duty' : 'On duty — requests will arrive here.'), d.onDuty ? 'ghost' : 'primary') : null));
    if (r) {
      add(el, h('div.card', h('h3', r.status === 'searching' ? 'New request' : r.status === 'assigned' ? 'Pick up passenger' : r.status === 'onboard' ? 'Drive to destination' : r.status),
        h('div', 'Passenger: ', h('b', r.riderName), r.riderIsNpc ? badge('NPC') : badge('PLAYER', 'ok')), h('div', 'To: ', h('b', r.destName)), h('div', 'Fare: ', fmt.usd(r.fare), ' (you keep 85%) ', SIM()),
        r.status === 'searching' ? h('div', btn('Accept', () => run(act('driver.accept'), 'Accepted — pickup marked on your map'), 'primary'), btn('Decline', () => run(act('driver.decline')), 'ghost')) : null,
        r.status === 'assigned' ? h('div.muted', 'Drive to the yellow pickup marker; the passenger gets in automatically when you stop next to them.') : null,
        r.status === 'onboard' ? h('div.muted', 'Follow the purple route. Stop at the entrance to complete. Avoid damage for a better rating.') : null,
        ['assigned', 'searching'].includes(r.status) ? btn('Cancel', () => run(act('ride.cancel')), 'ghost danger') : null));
    }
    if (me.fleet) add(el, h('div.card', h('h3', '🏢 ', me.fleet.name), h('div', `${me.fleet.drivers.length} NPC drivers · lifetime earnings ${fmt.usd(me.fleet.earnings)}`), h('small.muted', 'Earnings arrive every few minutes while you are active. Drivers add wear to your cars.'),
      me.fleet.drivers.map((fd) => h('div.item', h('div', fd.name, ' → ', VEHICLE_BY_ID[me.vehicles.find((v) => v.uid === fd.vehicle)?.model ?? '']?.name ?? 'car'), btn('Release', () => run(act('fleet.fire', { vehicle: fd.vehicle })), 'ghost small'))),
      me.vehicles.filter((v) => v.uid !== me.activeVehicle && !me.fleet!.drivers.some((x) => x.vehicle === v.uid) && VEHICLE_BY_ID[v.model].seats > 1).map((v) => btn(`Hire driver for ${VEHICLE_BY_ID[v.model].name}`, () => run(act('fleet.hire', { vehicle: v.uid }), 'Driver hired'), 'ghost small'))));
    void rr;
  },
};

// ---------------------------------------------------------------- garage
const garage: App = {
  id: 'garage', name: 'Garage', icon: '🔑', color: '#ff6b4f',
  render(el) {
    const me = store.me!;
    add(el, sub('Your vehicles'), me.vehicles.length ? me.vehicles.map((v) => {
      const d = VEHICLE_BY_ID[v.model];
      return h('div.item.col', h('div', h('span.swatch', { style: { background: v.color } }), ' ', h('b', d.name), v.uid === me.activeVehicle ? badge('active', 'ok') : null),
        h('div.muted', `${d.cat} · rims ${v.rims} · engine L${v.engine} · handling L${v.handling} · condition ${100 - Math.round(v.damage)}%`),
        h('div', v.uid !== me.activeVehicle ? btn('Set active', () => run(act('vehicle.setActive', { id: v.uid }))) : null, btn('Bring it to me', () => { api.panel('callcar', { uid: v.uid }); }, 'ghost')));
    }) : h('p.muted', 'No vehicles yet. Visit Moonshot Motors or Second Block Used Cars (Automotive District).'),
      sub('Homes'),
      me.properties.map((p) => h('div.item', h('div', h('b', PROPERTY_BY_ID[p.id].name), ' ', badge(p.mode), p.id === me.homeId ? badge('home', 'ok') : null), p.id !== me.homeId ? btn('Make home', () => run(act('property.setHome', { id: p.id }), 'Home updated')) : null)));
  },
};

// ---------------------------------------------------------------- settings
const settings: App = {
  id: 'settings', name: 'Settings', icon: '⚙', color: '#9aa3ad',
  render(el, rr) {
    const q = (localStorage.getItem('cc_quality_v2') ?? (matchMedia('(pointer: coarse)').matches ? 'low' : 'high'));
    add(el, sub('Graphics'), h('div.seg', (['low', 'medium', 'high'] as const).map((k) => btn(k, () => { api.panel('quality', { q: k }); rr(); }, q === k ? 'on' : ''))),
      sub('Audio'), ...(['master', 'music', 'sfx', 'amb'] as const).map((k) => h('label.field', h('span', { master: 'Master', music: 'Music', sfx: 'Effects', amb: 'City ambience' }[k]), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: audio.volumes[k], oninput: (e: Event) => { audio.volumes[k] = Number((e.target as HTMLInputElement).value); audio.applyVolumes(); } }))),
      sub('Controls'), h('pre.keys', 'WASD move · Shift run · Space jump/handbrake\nMouse look (click to lock) · Wheel zoom\nE / R interact · F enter/exit vehicle\nP phone · M map · T chat · H help · Esc close\nC camera reset · 1-4 emotes (wave, dance, phone, talk)'),
      sub('About'), h('small.muted', `Crypto City prototype · in-game time ${clockString()} · day ${store.clock.day}. All currency, prices and news are simulated.`));
  },
};

export const APPS: App[] = [wallet, market, musicApp, messages, social, rides, mapApp, jobsApp, projects, events, news, profile, airdrops, daoApp, leaders, drive, garage, settings];
export const APP_BY_ID: Record<string, App> = Object.fromEntries(APPS.map((a) => [a.id, a]));

void POOLS;
