import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import type { Settings, Mapping, ScrobbleEvent, Stats, SharedTitle } from '../../shared/types'

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
  enabled INTEGER NOT NULL DEFAULT 1,
  plex_token TEXT NOT NULL DEFAULT ''
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
  plex_status INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  -- Declined by configuration rather than attempted and failed. A zero ok alone could
  -- not tell the two apart, so every decline rendered red and counted as a failure.
  skipped INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  -- A linked Plex account may sign in as this user. Matched on plex.tv's numeric
  -- account id, never on username or email: the account holder can change both, and
  -- a rename must not hand someone else's Plex account the keys to this panel. The
  -- bridge username and the Plex username routinely differ anyway.
  plex_id TEXT,
  plex_username TEXT,
  plex_thumb TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL
);

-- Shows/movies flagged as co-watched. rating_key is the show's own key (matches an
-- episode's grandparent_rating_key) or the movie's key. A watch on such a title
-- fans out to every assigned profile — see shared_title_profiles.
CREATE TABLE IF NOT EXISTS shared_titles (
  rating_key TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  title TEXT,
  year TEXT,
  image TEXT,
  -- Plex's own id for the title (plex://show/... or plex://movie/...). This, not
  -- rating_key, is what identifies the title: the same show in two libraries has two
  -- rating_keys but ONE guid. Nullable because a row shared before this column
  -- existed genuinely has no known guid until /api/shared backfills it.
  guid TEXT,
  -- Which library the title was picked from. Recorded because two active libraries
  -- can hold the same title under different rating_keys, and the pipeline gates on
  -- section: a share pointing at the copy you don't play from forwards nothing, and
  -- without this the row gives no clue why.
  section_id TEXT,
  library_name TEXT,
  created INTEGER NOT NULL,
  plex_sync INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS shared_title_profiles (
  rating_key TEXT NOT NULL,
  mapping_id INTEGER NOT NULL,
  PRIMARY KEY (rating_key, mapping_id)
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
  // Which Tautulli library sections to use, as a JSON array of section_ids.
  // Defaults to '' — and empty deliberately means ALL, so an upgrade never
  // silently stops forwarding for someone who has not visited Settings yet.
  if (!settingsCols.includes('libraries'))
    db.exec("ALTER TABLE settings ADD COLUMN libraries TEXT NOT NULL DEFAULT ''")
  if (!settingsCols.includes('sync_movies'))
    db.exec('ALTER TABLE settings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1')
  if (!settingsCols.includes('sync_episodes'))
    db.exec('ALTER TABLE settings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1')

  const eventCols = cols('events')
  if (!eventCols.includes('image'))
    db.exec('ALTER TABLE events ADD COLUMN image TEXT')
  if (!eventCols.includes('series_key'))
    db.exec('ALTER TABLE events ADD COLUMN series_key TEXT')

  const userCols = cols('users')
  if (!userCols.includes('plex_id'))
    db.exec('ALTER TABLE users ADD COLUMN plex_id TEXT')
  if (!userCols.includes('plex_username'))
    db.exec('ALTER TABLE users ADD COLUMN plex_username TEXT')
  if (!userCols.includes('plex_thumb'))
    db.exec('ALTER TABLE users ADD COLUMN plex_thumb TEXT')

  const mappingCols = cols('mappings')
  if (!mappingCols.includes('sync_movies'))
    db.exec('ALTER TABLE mappings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1')
  if (!mappingCols.includes('sync_episodes'))
    db.exec('ALTER TABLE mappings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1')

  // Nullable, not defaulted: a title shared before this column existed genuinely
  // has no known library, and NULL is what lets /api/shared tell "not looked up
  // yet" apart from "looked up and Tautulli had nothing".
  const sharedCols = cols('shared_titles')
  if (!sharedCols.includes('section_id'))
    db.exec('ALTER TABLE shared_titles ADD COLUMN section_id TEXT')
  if (!sharedCols.includes('library_name'))
    db.exec('ALTER TABLE shared_titles ADD COLUMN library_name TEXT')

  if (!settingsCols.includes('plex_token'))
    db.exec("ALTER TABLE settings ADD COLUMN plex_token TEXT NOT NULL DEFAULT ''")
  // The X-Plex-Client-Identifier for the OAuth PIN flow. Deliberately NOT part of
  // SettingsRow: creating a PIN and polling it must present the same value, which
  // makes this infrastructure state rather than something an operator sets. Kept
  // off the wire so it is never shipped to a browser.
  if (!settingsCols.includes('plex_client_id'))
    db.exec("ALTER TABLE settings ADD COLUMN plex_client_id TEXT NOT NULL DEFAULT ''")

  if (!mappingCols.includes('plex_token'))
    db.exec("ALTER TABLE mappings ADD COLUMN plex_token TEXT NOT NULL DEFAULT ''")

  if (!eventCols.includes('plex_status'))
    db.exec('ALTER TABLE events ADD COLUMN plex_status INTEGER')

  // Nullable for the same reason as library_name above: a title shared before this
  // column existed has no known guid until /api/shared looks it up, and NULL is what
  // tells "not resolved yet" apart from "resolved to nothing".
  if (!sharedCols.includes('guid'))
    db.exec('ALTER TABLE shared_titles ADD COLUMN guid TEXT')

  // plex_sync defaults to 0, deliberately inverting the "empty means all" convention
  // that settings.libraries uses. That convention is safe because it only ever widens
  // forwarding; this one writes into OTHER PEOPLE'S Plex libraries, so an upgrade
  // must not start doing that to titles shared months ago.
  if (!sharedCols.includes('plex_sync'))
    db.exec('ALTER TABLE shared_titles ADD COLUMN plex_sync INTEGER NOT NULL DEFAULT 0')

  // Defaults to 0 — an unrecognised old row stays a failure rather than being quietly
  // cleared. But the two declines the bridge records were written with strings the
  // bridge itself produced, so those rows CAN be identified exactly and are reclassified
  // once, when the column appears. Without this an upgrade leaves every historical
  // "syncing is off" watch red on the Dashboard, which is the very complaint this
  // column exists to fix. Both wordings are matched: the message was renamed from
  // "Forwarding" to "Syncing" in 2.3.0, and rows predating that are still in the table.
  if (!eventCols.includes('skipped')) {
    db.exec('ALTER TABLE events ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0')
    db.prepare(
      `UPDATE events SET skipped = 1
        WHERE error IN ('Syncing is disabled in settings', 'Forwarding is disabled in settings')
           OR error LIKE 'Library "%" is not selected in Settings'`,
    ).run()
  }
}

export interface SettingsRow {
  tautulli_url: string
  tautulli_apikey: string
  seenr_base_url: string
  forward_enabled: number
  bridge_url: string
  sync_movies: number
  sync_episodes: number
  /** JSON array of Tautulli section_ids. Empty string means every library. */
  libraries: string
  plex_token: string
}

export interface MappingRow {
  id: number
  username: string
  seenr_token: string
  enabled: number
  sync_movies: number
  sync_episodes: number
  plex_token: string
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
  plex_status: number | null
  ok: number
  skipped: number
  error: string | null
  payload: string | null
}

export interface User {
  id: number
  username: string
  password_hash: string
  created: number
  plex_id: string | null
  plex_username: string | null
  plex_thumb: string | null
}

export function settingsToWire(r: SettingsRow): Settings {
  return {
    ...r,
    forward_enabled: !!r.forward_enabled,
    sync_movies: !!r.sync_movies,
    sync_episodes: !!r.sync_episodes,
    // The JSON <-> array conversion belongs here for the same reason the 0/1 <->
    // boolean one does: `shared/types` is the wire shape, and the storage
    // representation must not leak past this boundary. A malformed or legacy
    // value degrades to [] — which means "all libraries", the safe default.
    libraries: parseLibraries(r.libraries),
  }
}

/** Tolerant parse: '' (the column default), null, malformed JSON and a non-array
 *  payload all collapse to [], i.e. every library. */
export function parseLibraries(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
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
  return { ...r, ok: !!r.ok, skipped: !!r.skipped, ids }
}

export function getSettings(): SettingsRow {
  return useDb()
    .prepare(
      'SELECT tautulli_url, tautulli_apikey, seenr_base_url, forward_enabled, bridge_url, sync_movies, sync_episodes, libraries, plex_token FROM settings WHERE id = 1',
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
    libraries: s.libraries ?? cur.libraries,
    plex_token: s.plex_token ?? cur.plex_token,
  }
  useDb()
    .prepare(
      'UPDATE settings SET tautulli_url=?, tautulli_apikey=?, seenr_base_url=?, forward_enabled=?, bridge_url=?, sync_movies=?, sync_episodes=?, libraries=?, plex_token=? WHERE id=1',
    )
    .run(
      next.tautulli_url,
      next.tautulli_apikey,
      next.seenr_base_url,
      next.forward_enabled,
      next.bridge_url,
      next.sync_movies,
      next.sync_episodes,
      next.libraries,
      next.plex_token,
    )
  return next
}

/** The stable X-Plex-Client-Identifier for the OAuth PIN flow, generated on first
 *  use. Separate from getSettings because the PIN create and PIN poll calls must
 *  present the SAME identifier or plex.tv never hands back a token. */
export function getPlexClientId(): string {
  const db = useDb()
  const row = db.prepare('SELECT plex_client_id FROM settings WHERE id = 1').get() as {
    plex_client_id: string
  }
  if (row.plex_client_id) return row.plex_client_id

  const id = crypto.randomUUID()
  db.prepare('UPDATE settings SET plex_client_id = ? WHERE id = 1').run(id)
  return id
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
  // A caller that omits this RESETS the stored override, exactly as omitting
  // sync_movies resets that flag. The UI always sends the whole mapping back, and
  // the Add form omitting it is correct — a new mapping has no override.
  plex_token = '',
): MappingRow {
  useDb()
    .prepare(
      `INSERT INTO mappings (username, seenr_token, enabled, sync_movies, sync_episodes, plex_token)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET seenr_token=excluded.seenr_token, enabled=excluded.enabled,
       sync_movies=excluded.sync_movies, sync_episodes=excluded.sync_episodes,
       plex_token=excluded.plex_token`,
    )
    .run(username, seenr_token, enabled, sync_movies, sync_episodes, plex_token)
  return getMappingByUsername(username)!
}

export function deleteMapping(id: number): void {
  const db = useDb()
  db.prepare('DELETE FROM shared_title_profiles WHERE mapping_id = ?').run(id)
  // drop any shared titles left with no profiles
  db.prepare(
    'DELETE FROM shared_titles WHERE rating_key NOT IN (SELECT rating_key FROM shared_title_profiles)',
  ).run()
  db.prepare('DELETE FROM mappings WHERE id = ?').run(id)
}

// ---- shared (co-watched) titles ----

export interface SharedTitleRow {
  rating_key: string
  media_type: string
  title: string | null
  year: string | null
  image: string | null
  section_id: string | null
  library_name: string | null
  guid: string | null
  created: number
  plex_sync: number
}

export function sharedTitleToWire(r: SharedTitleRow, profiles: number[]): SharedTitle {
  return {
    rating_key: r.rating_key,
    media_type: r.media_type,
    title: r.title,
    year: r.year,
    image: r.image,
    section_id: r.section_id,
    library_name: r.library_name,
    guid: r.guid,
    plex_sync: !!r.plex_sync,
    profiles,
  }
}

export function listSharedTitles(): SharedTitle[] {
  const rows = useDb().prepare('SELECT * FROM shared_titles ORDER BY title').all() as SharedTitleRow[]
  const links = useDb()
    .prepare('SELECT rating_key, mapping_id FROM shared_title_profiles')
    .all() as { rating_key: string; mapping_id: number }[]
  const byKey = new Map<string, number[]>()
  for (const l of links) {
    const arr = byKey.get(l.rating_key) ?? []
    arr.push(l.mapping_id)
    byKey.set(l.rating_key, arr)
  }
  return rows.map((r) => sharedTitleToWire(r, byKey.get(r.rating_key) ?? []))
}

// Set (or clear) the profiles co-watching a title. Empty list removes the share.
export function setSharedTitle(
  t: {
    rating_key: string
    media_type: string
    title?: string
    year?: string
    image?: string
    section_id?: string
    library_name?: string
    guid?: string
    plex_sync?: number
  },
  profiles: number[],
): void {
  const clean = Array.from(new Set(profiles.filter((n) => Number.isInteger(n))))
  const db = useDb()
  const tx = db.transaction(() => {
    if (clean.length === 0) {
      db.prepare('DELETE FROM shared_title_profiles WHERE rating_key = ?').run(t.rating_key)
      db.prepare('DELETE FROM shared_titles WHERE rating_key = ?').run(t.rating_key)
      return
    }
    // COALESCE on the library columns, not plain assignment: the edit modal saves a
    // profile change without a library (a SharedRow carries none), and overwriting
    // with NULL there would erase what the add flow recorded. plex_sync is a plain
    // assignment instead — both the add flow and the edit modal always carry the
    // checkbox state, so an absent value means "off", not "unknown".
    db.prepare(
      `INSERT INTO shared_titles (rating_key, media_type, title, year, image, section_id, library_name, guid, created, plex_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rating_key) DO UPDATE SET media_type=excluded.media_type, title=excluded.title, year=excluded.year, image=excluded.image,
         plex_sync=excluded.plex_sync,
         section_id=COALESCE(excluded.section_id, shared_titles.section_id),
         library_name=COALESCE(excluded.library_name, shared_titles.library_name),
         guid=COALESCE(excluded.guid, shared_titles.guid)`,
    ).run(
      t.rating_key,
      t.media_type,
      t.title ?? null,
      t.year ?? null,
      t.image ?? null,
      t.section_id ?? null,
      t.library_name ?? null,
      t.guid ?? null,
      Date.now(),
      t.plex_sync ?? 0,
    )
    db.prepare('DELETE FROM shared_title_profiles WHERE rating_key = ?').run(t.rating_key)
    const ins = db.prepare('INSERT INTO shared_title_profiles (rating_key, mapping_id) VALUES (?, ?)')
    for (const id of clean) ins.run(t.rating_key, id)
  })
  tx()
}

/** Fill in the library for a title shared before those columns existed. Separate
 *  from setSharedTitle because this must not touch profiles or re-stamp anything —
 *  it only backfills, and only where the value is still unknown. */
export function setSharedTitleLibrary(rating_key: string, section_id: string, library_name: string): void {
  useDb()
    .prepare(
      'UPDATE shared_titles SET section_id = ?, library_name = ? WHERE rating_key = ? AND library_name IS NULL',
    )
    .run(section_id, library_name, rating_key)
}

/** Fill in the Plex guid for a title shared before that column existed. Same shape and
 *  reason as setSharedTitleLibrary: backfill only, never touching profiles. */
export function setSharedTitleGuid(rating_key: string, guid: string): void {
  useDb()
    .prepare('UPDATE shared_titles SET guid = ? WHERE rating_key = ? AND guid IS NULL')
    .run(guid, rating_key)
}

// Matching a share by rating_key ALONE is not enough, and the failure is silent.
// Two libraries can hold the same title under different rating_keys — a real setup
// here has both `TV Shows`/`Seriale` and `Movies`/`Filme` — so a share created from
// the copy you don't play from never matches, and the watch looks unshared: no
// fan-out, no Plex, no error. Observed live on House (9815 in Seriale vs 9809 in TV
// Shows).
//
// Plex gives both copies the SAME guid (`plex://show/5d9c…` for either House), and
// every episode carries it as grandparent_guid, so the guid is what actually
// identifies the title. rating_key stays in the match as a fallback for rows shared
// before the column existed and not yet backfilled.
const SHARE_MATCH = `(t.rating_key = @rating_key OR (@guid <> '' AND t.guid = @guid))`

/** Mappings that co-watch a given title — the fan-out recipients. DISTINCT because a
 *  title deliberately shared from both libraries yields two rows whose profiles
 *  overlap; the watcher should be delivered to once, not twice. */
export function getSharedRecipients(rating_key: string, guid = ''): MappingRow[] {
  return useDb()
    .prepare(
      `SELECT DISTINCT m.* FROM mappings m
         JOIN shared_title_profiles s ON s.mapping_id = m.id
         JOIN shared_titles t ON t.rating_key = s.rating_key
        WHERE ${SHARE_MATCH}`,
    )
    .all({ rating_key, guid }) as MappingRow[]
}

/** The share row itself. getSharedRecipients answers "who co-watches this"; this
 *  answers "how is the share configured" — which the pipeline needs for plex_sync.
 *  An exact rating_key hit wins over a guid hit, so the row the operator actually
 *  configured is the one whose settings apply. */
export function getSharedTitle(rating_key: string, guid = ''): SharedTitleRow | undefined {
  return useDb()
    .prepare(
      `SELECT t.* FROM shared_titles t
        WHERE ${SHARE_MATCH}
        ORDER BY (t.rating_key = @rating_key) DESC
        LIMIT 1`,
    )
    .get({ rating_key, guid }) as SharedTitleRow | undefined
}

const MAX_EVENTS = 1000

export function insertEvent(e: Omit<EventRowDb, 'id'>): number {
  const info = useDb()
    .prepare(
      `INSERT INTO events (ts, action, event, username, media_type, title, rating_key, ids, image, series_key, seenr_status, plex_status, ok, skipped, error, payload)
       VALUES (@ts, @action, @event, @username, @media_type, @title, @rating_key, @ids, @image, @series_key, @seenr_status, @plex_status, @ok, @skipped, @error, @payload)`,
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
  const skipped = one('SELECT COUNT(*) c FROM events WHERE skipped = 1')
  // Counted, not subtracted: `total - ok - skipped` would go wrong the moment a row
  // carried both flags, and this asks the question the number actually answers —
  // how many attempts failed.
  const failed = one('SELECT COUNT(*) c FROM events WHERE ok = 0 AND skipped = 0')
  const last =
    (db.prepare('SELECT ts FROM events ORDER BY ts DESC LIMIT 1').get() as { ts: number } | undefined)
      ?.ts ?? null
  const episodes = one("SELECT COUNT(*) c FROM events WHERE media_type = 'episode'")
  const movies = one("SELECT COUNT(*) c FROM events WHERE media_type = 'movie'")
  const users = one('SELECT COUNT(*) c FROM mappings')
  return { total, ok, failed, skipped, last, episodes, movies, users }
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

/** Create the first account from a Plex identity, with NO password. Only ever called
 *  when countUsers() === 0, mirroring register.post.ts: whoever reaches an
 *  unconfigured bridge first claims it, which is the posture the password setup flow
 *  already has — this route is if anything stronger, since it proves control of a real
 *  Plex account and records which one.
 *
 *  The empty password_hash is load-bearing, not a placeholder: verifyPassword() splits
 *  on ':' and returns false without a salt, so password sign-in stays closed until the
 *  operator sets one from Settings. */
/** Whether Plex sign-in can succeed right now. True on a fresh install, where it would
 *  create the account, and true afterwards as long as Tautulli is configured — that is
 *  what tells the bridge which server's owner to accept.
 *
 *  Surfaced on the PUBLIC /api/auth/status so the login page can hide a button that
 *  could only fail. It discloses "this bridge accepts Plex sign-in" and nothing else —
 *  no account, no username — which is what any site showing an SSO button reveals. */
export function plexLoginAvailable(): boolean {
  if (countUsers() === 0) return true
  const s = getSettings()
  return !!s.tautulli_url && !!s.tautulli_apikey
}

export function createUserFromPlex(
  username: string,
  plex: { id: string; username: string; thumb: string },
): User {
  const info = useDb()
    .prepare(
      `INSERT INTO users (username, password_hash, created, plex_id, plex_username, plex_thumb)
       VALUES (?, '', ?, ?, ?, ?)`,
    )
    .run(username, Date.now(), plex.id, plex.username, plex.thumb)
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

// Sessions are valid for this long after creation. server/utils/auth.ts's
// session cookie Max-Age is derived from this same constant so the two
// cannot drift apart.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

function sessionCutoff(): number {
  return Date.now() - SESSION_TTL_SECONDS * 1000
}

export function createSession(user_id: number): string {
  const token = crypto.randomBytes(32).toString('hex')
  // Opportunistic cleanup, same shape as insertEvent's MAX_EVENTS trim: every
  // new session prunes rows that aged out, rather than running a scheduler.
  useDb().prepare('DELETE FROM sessions WHERE created <= ?').run(sessionCutoff())
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
  return useDb()
    .prepare('SELECT user_id FROM sessions WHERE token = ? AND created > ?')
    .get(token, sessionCutoff()) as { user_id: number } | undefined
}

export function deleteSession(token: string): void {
  useDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/** Remember which Plex account signed in. This is a RECORD, not a credential: Plex
 *  sign-in is authorised by owning the Plex server, so nothing here grants access and
 *  clearing it would lock nobody out. It exists so Settings can name the identity. */
export function recordPlexAccount(
  id: number,
  plex: { id: string; username: string; thumb: string },
): void {
  useDb()
    .prepare('UPDATE users SET plex_id = ?, plex_username = ?, plex_thumb = ? WHERE id = ?')
    .run(plex.id, plex.username, plex.thumb, id)
}

/** The single admin account. This panel has exactly one — register.post.ts refuses
 *  once one exists — so "the user" is unambiguous. */
export function firstUser(): User | undefined {
  return useDb().prepare('SELECT * FROM users ORDER BY id LIMIT 1').get() as User | undefined
}

export function updateUserPassword(id: number, password_hash: string): void {
  useDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, id)
}

export function deleteUserSessions(user_id: number): void {
  useDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id)
}
