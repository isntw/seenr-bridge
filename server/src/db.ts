import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
`);

export interface Settings {
  tautulli_url: string;
  tautulli_apikey: string;
  seenr_base_url: string;
  forward_enabled: number;
}

export interface Mapping {
  id: number;
  username: string;
  seenr_token: string;
  enabled: number;
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
  seenr_status: number | null;
  ok: number;
  error: string | null;
  payload: string | null;
}

export function getSettings(): Settings {
  return db.prepare('SELECT tautulli_url, tautulli_apikey, seenr_base_url, forward_enabled FROM settings WHERE id = 1').get() as Settings;
}

export function saveSettings(s: Partial<Settings>): Settings {
  const cur = getSettings();
  const next: Settings = {
    tautulli_url: s.tautulli_url ?? cur.tautulli_url,
    tautulli_apikey: s.tautulli_apikey ?? cur.tautulli_apikey,
    seenr_base_url: s.seenr_base_url ?? cur.seenr_base_url,
    forward_enabled: s.forward_enabled ?? cur.forward_enabled,
  };
  db.prepare(
    'UPDATE settings SET tautulli_url=?, tautulli_apikey=?, seenr_base_url=?, forward_enabled=? WHERE id=1'
  ).run(next.tautulli_url, next.tautulli_apikey, next.seenr_base_url, next.forward_enabled);
  return next;
}

export function listMappings(): Mapping[] {
  return db.prepare('SELECT * FROM mappings ORDER BY username').all() as Mapping[];
}

export function getMappingByUsername(username: string): Mapping | undefined {
  return db.prepare('SELECT * FROM mappings WHERE username = ? COLLATE NOCASE').get(username) as Mapping | undefined;
}

export function upsertMapping(username: string, seenr_token: string, enabled: number): Mapping {
  db.prepare(
    `INSERT INTO mappings (username, seenr_token, enabled) VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET seenr_token=excluded.seenr_token, enabled=excluded.enabled`
  ).run(username, seenr_token, enabled);
  return getMappingByUsername(username)!;
}

export function deleteMapping(id: number): void {
  db.prepare('DELETE FROM mappings WHERE id = ?').run(id);
}

export function insertEvent(e: Omit<EventRow, 'id'>): number {
  const info = db
    .prepare(
      `INSERT INTO events (ts, action, event, username, media_type, title, rating_key, ids, seenr_status, ok, error, payload)
       VALUES (@ts, @action, @event, @username, @media_type, @title, @rating_key, @ids, @seenr_status, @ok, @error, @payload)`
    )
    .run(e);
  return info.lastInsertRowid as number;
}

export function listEvents(limit = 100): EventRow[] {
  return db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit) as EventRow[];
}

export function getStats() {
  const total = (db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c;
  const ok = (db.prepare('SELECT COUNT(*) c FROM events WHERE ok = 1').get() as { c: number }).c;
  const failed = total - ok;
  const last = (db.prepare('SELECT ts FROM events ORDER BY ts DESC LIMIT 1').get() as { ts: number } | undefined)?.ts ?? null;
  return { total, ok, failed, last };
}
