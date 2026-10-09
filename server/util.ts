import crypto from 'node:crypto';

export const uid = (p = '') => p + crypto.randomBytes(6).toString('hex');
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
export const randn = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
export function shuffle<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export class GameError extends Error {}
export function fail(msg: string): never {
  throw new GameError(msg);
}
export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

export function hashPassword(pw: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex');
  return { hash, salt };
}
export function verifyPassword(pw: string, salt: string, hash: string) {
  const h = crypto.scryptSync(pw, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

// Normalize usernames to defeat look-alike impersonation (case, 0/o, 1/l/i, 5/s ...).
export function normalizeName(n: string) {
  return n
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1il|]/g, 'l')
    .replace(/[5]/g, 's')
    .replace(/[3]/g, 'e')
    .replace(/[_.-]/g, '');
}
export const RESERVED = ['admin', 'moderator', 'mod', 'system', 'support', 'cryptocity', 'official', 'npc', 'cityride', 'staff', 'server'];

const BAD = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'retard'];
export function cleanText(t: string, max: number) {
  let s = String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  for (const w of BAD) s = s.replace(new RegExp(w, 'gi'), '*'.repeat(w.length));
  return s;
}
