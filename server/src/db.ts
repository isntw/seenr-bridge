import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'seenr-bridge.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tautulli_url TEXT NOT NULL DEFAULT '',
  tautulli_apikey TEXT NOT NULL DEFAULT '',
  seenr_base_url TEXT NOT NULL DEFAULT 'https://seenr.app/api/v1/scrobble/plex',
  forward_enabled INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  seenr_token TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  action TEXT,
  event TEXT,
  username TEXT,
  media_type TEXT,
  title TEXT,
  rating_key TEXT,
  ids TEXT,
  seenr_status INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL
);
`);

// --- migrations ---
const settingsCols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[];
if (!settingsCols.some((c) => c.name === 'bridge_url')) {
  db.exec("ALTER TABLE settings ADD COLUMN bridge_url TEXT NOT NULL DEFAULT ''");
}
if (!settingsCols.some((c) => c.name === 'sync_movies')) {
  db.exec('ALTER TABLE settings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1');
}
if (!settingsCols.some((c) => c.name === 'sync_episodes')) {
  db.exec('ALTER TABLE settings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1');
}
const eventCols = db.prepare('PRAGMA table_info(events)').all() as { name: string }[];
if (!eventCols.some((c) => c.name === 'image')) {
  db.exec('ALTER TABLE events ADD COLUMN image TEXT');
}
if (!eventCols.some((c) => c.name === 'series_key')) {
  db.exec('ALTER TABLE events ADD COLUMN series_key TEXT');
}
const mappingCols = db.prepare('PRAGMA table_info(mappings)').all() as { name: string }[];
if (!mappingCols.some((c) => c.name === 'sync_movies')) {
  db.exec('ALTER TABLE mappings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1');
}
if (!mappingCols.some((c) => c.name === 'sync_episodes')) {
  db.exec('ALTER TABLE mappings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1');
}

export interface Settings {
  tautulli_url: string;
  tautulli_apikey: string;
  seenr_base_url: string;
  forward_enabled: number;
  bridge_url: string;
  sync_movies: number;
  sync_episodes: number;
}

export interface Mapping {
  id: number;
  username: string;
  seenr_token: string;
  enabled: number;
  sync_movies: number;
  sync_episodes: number;
}

export interface EventRow {
  id: number;
  ts: number;
  action: string | null;
  event: string | null;
  username: string | null;
  media_type: string | null;
  title: string | null;
  rating_key: string | null;
  ids: string | null;
  image: string | null;
  series_key: string | null;
  seenr_status: number | null;
  ok: number;
  error: string | null;
  payload: string | null;
}

export function getSettings(): Settings {
  return db
    .prepare('SELECT tautulli_url, tautulli_apikey, seenr_base_url, forward_enabled, bridge_url, sync_movies, sync_episodes FROM settings WHERE id = 1')
    .get() as Settings;
}

export function saveSettings(s: Partial<Settings>): Settings {
  const cur = getSettings();
  const next: Settings = {
    tautulli_url: s.tautulli_url ?? cur.tautulli_url,
    tautulli_apikey: s.tautulli_apikey ?? cur.tautulli_apikey,
    seenr_base_url: s.seenr_base_url ?? cur.seenr_base_url,
    forward_enabled: s.forward_enabled ?? cur.forward_enabled,
    bridge_url: s.bridge_url ?? cur.bridge_url,
    sync_movies: s.sync_movies ?? cur.sync_movies,
    sync_episodes: s.sync_episodes ?? cur.sync_episodes,
  };
  db.prepare(
    'UPDATE settings SET tautulli_url=?, tautulli_apikey=?, seenr_base_url=?, forward_enabled=?, bridge_url=?, sync_movies=?, sync_episodes=? WHERE id=1'
  ).run(
    next.tautulli_url, next.tautulli_apikey, next.seenr_base_url, next.forward_enabled, next.bridge_url, next.sync_movies, next.sync_episodes
  );
  return next;
}

export function listMappings(): Mapping[] {
  return db.prepare('SELECT * FROM mappings ORDER BY username').all() as Mapping[];
}

export function getMappingByUsername(username: string): Mapping | undefined {
  return db.prepare('SELECT * FROM mappings WHERE username = ? COLLATE NOCASE').get(username) as Mapping | undefined;
}

export function upsertMapping(
  username: string,
  seenr_token: string,
  enabled: number,
  sync_movies = 1,
  sync_episodes = 1
): Mapping {
  db.prepare(
    `INSERT INTO mappings (username, seenr_token, enabled, sync_movies, sync_episodes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET seenr_token=excluded.seenr_token, enabled=excluded.enabled,
       sync_movies=excluded.sync_movies, sync_episodes=excluded.sync_episodes`
  ).run(username, seenr_token, enabled, sync_movies, sync_episodes);
  return getMappingByUsername(username)!;
}

export function deleteMapping(id: number): void {
  db.prepare('DELETE FROM mappings WHERE id = ?').run(id);
}

const MAX_EVENTS = 1000;

export function insertEvent(e: Omit<EventRow, 'id'>): number {
  const info = db
    .prepare(
      `INSERT INTO events (ts, action, event, username, media_type, title, rating_key, ids, image, series_key, seenr_status, ok, error, payload)
       VALUES (@ts, @action, @event, @username, @media_type, @title, @rating_key, @ids, @image, @series_key, @seenr_status, @ok, @error, @payload)`
    )
    .run(e);
  // keep only the newest MAX_EVENTS rows (no-op until the table exceeds the cap)
  db.prepare('DELETE FROM events WHERE id <= (SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MAX_EVENTS);
  return info.lastInsertRowid as number;
}

export function listEvents(limit = 100): EventRow[] {
  return db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit) as EventRow[];
}

export function getStats() {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const total = one('SELECT COUNT(*) c FROM events');
  const ok = one('SELECT COUNT(*) c FROM events WHERE ok = 1');
  const failed = total - ok;
  const last = (db.prepare('SELECT ts FROM events ORDER BY ts DESC LIMIT 1').get() as { ts: number } | undefined)?.ts ?? null;
  const episodes = one("SELECT COUNT(*) c FROM events WHERE media_type = 'episode'");
  const movies = one("SELECT COUNT(*) c FROM events WHERE media_type = 'movie'");
  const users = one('SELECT COUNT(*) c FROM mappings');
  return { total, ok, failed, last, episodes, movies, users };
}

// ---- auth ----
export interface User {
  id: number;
  username: string;
  password_hash: string;
  created: number;
}

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
}

export function createUser(username: string, password_hash: string): User {
  const info = db.prepare('INSERT INTO users (username, password_hash, created) VALUES (?, ?, ?)').run(username, password_hash, Date.now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as User;
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function createSession(user_id: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)').run(token, user_id, Date.now());
  return token;
}

export function getSession(token: string): { user_id: number } | undefined {
  return db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as { user_id: number } | undefined;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function updateUserPassword(id: number, password_hash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, id);
}

export function deleteUserSessions(user_id: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
}
