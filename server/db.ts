import fs from 'node:fs';
import path from 'node:path';
import { emptyDb, type DB } from './db-core.js';

export { emptyDb };
export type { DB, UserRec } from './db-core.js';

const DATA_DIR = process.env.CC_DATA_DIR ?? path.join(process.cwd(), 'server', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

export function loadDb(memory = false): DB {
  if (memory) return emptyDb();
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return { ...emptyDb(), ...JSON.parse(raw) } as DB;
  } catch {
    return emptyDb();
  }
}

export function saveDb(db: DB) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
