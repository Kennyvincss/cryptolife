import crypto from 'node:crypto';
import type { PasswordHasher } from './util.js';

/** scrypt password hashing for the Node server. */
export const nodeHasher: PasswordHasher = {
  hash(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    return { hash: crypto.scryptSync(pw, salt, 32).toString('hex'), salt };
  },
  verify(pw, salt, hash) {
    const h = crypto.scryptSync(pw, salt, 32);
    const b = Buffer.from(hash, 'hex');
    return b.length === h.length && crypto.timingSafeEqual(h, b);
  },
};
