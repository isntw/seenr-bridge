import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import type { Settings, Mapping, ScrobbleEvent, Stats } from '../../shared/types'

const CACHE_KEY = '__seenrBridgeDb__'

interface DbCache {
  [CACHE_KEY]?: Database.Database
}

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data')
}

export function useDb(): Database.Database {
  const cache = globalThis as unknown as DbCache
  if (cache[CACHE_KEY]) return cache[CACHE_KEY]!

  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })

  const db = new Database(path.join(dir, 'seenr-bridge.db'))
  db.pragma('journal_mode = WAL')

  migrate(db)

  cache[CACHE_KEY] = db
  return db
}

// Test helper: close the handle and clear the cache so the next useDb()
// re-reads DATA_DIR. Also used to release WAL locks between test files.
export function closeDb(): void {
  const cache = globalThis as unknown as DbCache
  cache[CACHE_KEY]?.close()
  delete cache[CACHE_KEY]
}

function migrate(db: Database.Database): void {
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
`)

  // Append-only column guards. Retained because the app still needs to
  // migrate itself across future schema changes.
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((c) => c.name)

  const settingsCols = cols('settings')
  if (!settingsCols.includes('bridge_url'))
    db.exec("ALTER TABLE settings ADD COLUMN bridge_url TEXT NOT NULL DEFAULT ''")
  if (!settingsCols.includes('sync_movies'))
    db.exec('ALTER TABLE settings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1')
  if (!settingsCols.includes('sync_episodes'))
    db.exec('ALTER TABLE settings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1')

  const eventCols = cols('events')
  if (!eventCols.includes('image'))
    db.exec('ALTER TABLE events ADD COLUMN image TEXT')
  if (!eventCols.includes('series_key'))
    db.exec('ALTER TABLE events ADD COLUMN series_key TEXT')

  const mappingCols = cols('mappings')
  if (!mappingCols.includes('sync_movies'))
    db.exec('ALTER TABLE mappings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1')
  if (!mappingCols.includes('sync_episodes'))
    db.exec('ALTER TABLE mappings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1')
}

export interface SettingsRow {
  tautulli_url: string
  tautulli_apikey: string
  seenr_base_url: string
  forward_enabled: number
  bridge_url: string
  sync_movies: number
  sync_episodes: number
}

export interface MappingRow {
  id: number
  username: string
  seenr_token: string
  enabled: number
  sync_movies: number
  sync_episodes: number
}

export interface EventRowDb {
  id: number
  ts: number
  action: string | null
  event: string | null
  username: string | null
  media_type: string | null
  title: string | null
  rating_key: string | null
  ids: string | null
  image: string | null
  series_key: string | null
  seenr_status: number | null
  ok: number
  error: string | null
  payload: string | null
}

export interface User {
  id: number
  username: string
  password_hash: string
  created: number
}

export function settingsToWire(r: SettingsRow): Settings {
  return {
    ...r,
    forward_enabled: !!r.forward_enabled,
    sync_movies: !!r.sync_movies,
    sync_episodes: !!r.sync_episodes,
  }
}

export function mappingToWire(r: MappingRow): Mapping {
  return {
    ...r,
    enabled: !!r.enabled,
    sync_movies: !!r.sync_movies,
    sync_episodes: !!r.sync_episodes,
  }
}

export function eventToWire(r: EventRowDb): ScrobbleEvent {
  let ids: string[] = []
  try {
    ids = r.ids ? (JSON.parse(r.ids) as string[]) : []
  } catch {
    ids = []
  }
  return { ...r, ok: !!r.ok, ids }
}

export function getSettings(): SettingsRow {
  return useDb()
    .prepare(
      'SELECT tautulli_url, tautulli_apikey, seenr_base_url, forward_enabled, bridge_url, sync_movies, sync_episodes FROM settings WHERE id = 1',
    )
    .get() as SettingsRow
}

export function saveSettings(s: Partial<SettingsRow>): SettingsRow {
  const cur = getSettings()
  const next: SettingsRow = {
    tautulli_url: s.tautulli_url ?? cur.tautulli_url,
    tautulli_apikey: s.tautulli_apikey ?? cur.tautulli_apikey,
    seenr_base_url: s.seenr_base_url ?? cur.seenr_base_url,
    forward_enabled: s.forward_enabled ?? cur.forward_enabled,
    bridge_url: s.bridge_url ?? cur.bridge_url,
    sync_movies: s.sync_movies ?? cur.sync_movies,
    sync_episodes: s.sync_episodes ?? cur.sync_episodes,
  }
  useDb()
    .prepare(
      'UPDATE settings SET tautulli_url=?, tautulli_apikey=?, seenr_base_url=?, forward_enabled=?, bridge_url=?, sync_movies=?, sync_episodes=? WHERE id=1',
    )
    .run(
      next.tautulli_url,
      next.tautulli_apikey,
      next.seenr_base_url,
      next.forward_enabled,
      next.bridge_url,
      next.sync_movies,
      next.sync_episodes,
    )
  return next
}

export function listMappings(): MappingRow[] {
  return useDb().prepare('SELECT * FROM mappings ORDER BY username').all() as MappingRow[]
}

export function getMappingByUsername(username: string): MappingRow | undefined {
  return useDb()
    .prepare('SELECT * FROM mappings WHERE username = ? COLLATE NOCASE')
    .get(username) as MappingRow | undefined
}

export function upsertMapping(
  username: string,
  seenr_token: string,
  enabled: number,
  sync_movies = 1,
  sync_episodes = 1,
): MappingRow {
  useDb()
    .prepare(
      `INSERT INTO mappings (username, seenr_token, enabled, sync_movies, sync_episodes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET seenr_token=excluded.seenr_token, enabled=excluded.enabled,
       sync_movies=excluded.sync_movies, sync_episodes=excluded.sync_episodes`,
    )
    .run(username, seenr_token, enabled, sync_movies, sync_episodes)
  return getMappingByUsername(username)!
}

export function deleteMapping(id: number): void {
  useDb().prepare('DELETE FROM mappings WHERE id = ?').run(id)
}

const MAX_EVENTS = 1000

export function insertEvent(e: Omit<EventRowDb, 'id'>): number {
  const info = useDb()
    .prepare(
      `INSERT INTO events (ts, action, event, username, media_type, title, rating_key, ids, image, series_key, seenr_status, ok, error, payload)
       VALUES (@ts, @action, @event, @username, @media_type, @title, @rating_key, @ids, @image, @series_key, @seenr_status, @ok, @error, @payload)`,
    )
    .run(e)
  // keep only the newest MAX_EVENTS rows (no-op until the table exceeds the cap)
  useDb()
    .prepare(
      'DELETE FROM events WHERE id <= (SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?)',
    )
    .run(MAX_EVENTS)
  return info.lastInsertRowid as number
}

export function listEvents(limit = 100): EventRowDb[] {
  return useDb().prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit) as EventRowDb[]
}

export function getStats(): Stats {
  const db = useDb()
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c
  const total = one('SELECT COUNT(*) c FROM events')
  const ok = one('SELECT COUNT(*) c FROM events WHERE ok = 1')
  const failed = total - ok
  const last =
    (db.prepare('SELECT ts FROM events ORDER BY ts DESC LIMIT 1').get() as { ts: number } | undefined)
      ?.ts ?? null
  const episodes = one("SELECT COUNT(*) c FROM events WHERE media_type = 'episode'")
  const movies = one("SELECT COUNT(*) c FROM events WHERE media_type = 'movie'")
  const users = one('SELECT COUNT(*) c FROM mappings')
  return { total, ok, failed, last, episodes, movies, users }
}

export function countUsers(): number {
  return (useDb().prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c
}

export function createUser(username: string, password_hash: string): User {
  const info = useDb()
    .prepare('INSERT INTO users (username, password_hash, created) VALUES (?, ?, ?)')
    .run(username, password_hash, Date.now())
  return useDb().prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as User
}

export function getUserByUsername(username: string): User | undefined {
  return useDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as User | undefined
}

export function getUserById(id: number): User | undefined {
  return useDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
}

export function createSession(user_id: number): string {
  const token = crypto.randomBytes(32).toString('hex')
  useDb()
    .prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)')
    .run(token, user_id, Date.now())
  return token
}

// Named getSessionByToken, not getSession: h3 auto-imports its own
// getSession(event, config) into every Nitro module, so exporting `getSession`
// here shadows it globally and any handler wanting h3's session helper would
// silently get this one instead. The name is also more accurate — this takes a
// token, not an event.
export function getSessionByToken(token: string): { user_id: number } | undefined {
  return useDb().prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as
    | { user_id: number }
    | undefined
}

export function deleteSession(token: string): void {
  useDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function updateUserPassword(id: number, password_hash: string): void {
  useDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, id)
}

export function deleteUserSessions(user_id: number): void {
  useDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id)
}
