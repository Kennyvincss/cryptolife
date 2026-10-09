// Offline single-player mode: runs the same authoritative game engine as the
// Node server, inside the browser, with the world saved to localStorage.
// Used automatically when no game server is reachable (e.g. a static Vercel deploy).

import type { DB, UserRec } from '../../server/db-core.js';
import type { Game } from '../../server/game.js';
import type { PasswordHasher } from '../../server/util.js';

const KEY = 'cc_world_v1';

// Local-only hashing: the save lives on this device anyway, this just avoids storing plain text.
function h(s: string) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let r = 0; r < 4000; r++) for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b ^ (c + r), 2246822519) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
const localHasher: PasswordHasher = {
  hash(pw) { const salt = Math.random().toString(36).slice(2); return { salt, hash: h(salt + pw) }; },
  verify(pw, salt, hash) { return h(salt + pw) === hash; },
};

let game: Game | null = null;
let db: DB | null = null;
let user: UserRec | null = null;
let deliver: ((m: unknown) => void) | null = null;

function save() {
  if (!db) return;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('Could not save world', e); }
}

const post = (m: unknown) => { const copy = JSON.parse(JSON.stringify(m)); setTimeout(() => deliver?.(copy), 0); };

export async function boot() {
  if (game) return;
  const [{ Game }, { emptyDb }, life, finance, work, social, transport, { startWorld }] = await Promise.all([
    import('../../server/game.js'), import('../../server/db-core.js'),
    import('../../server/actions/life.js'), import('../../server/actions/finance.js'), import('../../server/actions/work.js'),
    import('../../server/actions/social.js'), import('../../server/actions/transport.js'), import('../../server/world.js'),
  ]);
  try { const raw = localStorage.getItem(KEY); db = raw ? { ...emptyDb(), ...JSON.parse(raw) } : emptyDb(); } catch { db = emptyDb(); }
  game = new Game(db!, {
    send: (id, msg) => { if (user && id === user.id) post(msg); },
    broadcast: (msg) => post(msg),
  }, localHasher);
  for (const m of [life, finance, work, social, transport]) m.register(game);
  startWorld(game, db!, save);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
}

export function auth(kind: 'login' | 'register', username: string, password: string) {
  const r = kind === 'register' ? game!.register(username, password) : game!.login(username, password);
  save();
  return r;
}

export function connect(token: string, onMessage: (m: unknown) => void) {
  const u = game!.auth(token);
  if (!u) throw new Error('auth');
  user = u;
  deliver = onMessage;
  post(game!.onConnect(u));
}

export function send(msg: any) {
  if (!game || !user) return;
  if (msg.t === 'pos') game.onPos(user, msg);
  else if (msg.t === 'act') post(game.onAct(user, msg));
}
