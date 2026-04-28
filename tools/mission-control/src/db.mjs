// SQLite open + migrate. Idempotent — `node src/db.mjs --init` is safe
// to re-run. The schema file appends new tables for migrations rather
// than rewriting existing ones, so re-applying the whole script never
// drops data.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DB_DIR, 'mc.db');
const SCHEMA_PATH = path.join(ROOT, 'schema.sql');

let _db = null;

export function db() {
  if (_db) return _db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');     // concurrent reads while a writer is active
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function migrate() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db().exec(sql);
}

// CLI entry — `node src/db.mjs --init` runs the migration and exits.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  if (process.argv.includes('--init')) {
    migrate();
    console.log(`[db] migrated ${DB_PATH}`);
    db().close();
    process.exit(0);
  }
  console.log(`Usage: node src/db.mjs --init`);
  process.exit(2);
}
