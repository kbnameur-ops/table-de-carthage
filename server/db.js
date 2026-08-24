import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'data', 'restaurant.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

export function nettoyerSessionsExpirees() {
  db.prepare(`DELETE FROM sessions WHERE expire_le < datetime('now')`).run();
}

export function nettoyerTentativesAnciennes() {
  db.prepare(`DELETE FROM tentatives WHERE le < datetime('now', '-1 day')`).run();
}
