export interface Settings {
  tautulli_url: string
  tautulli_apikey: string
  seenr_base_url: string
  forward_enabled: boolean
  bridge_url: string
  sync_movies: boolean
  sync_episodes: boolean
  /** Tautulli section_ids to use. EMPTY MEANS ALL — never "none". */
  libraries: string[]
  plex_token: string
  notify_enabled: boolean
  /** Usernames whose playback notifies. EMPTY MEANS NOBODY — opposite of `libraries`. */
  notify_users: string[]
}

export interface Mapping {
  id: number
  username: string
  seenr_token: string
  enabled: boolean
  sync_movies: boolean
  sync_episodes: boolean
  plex_token: string
}

export interface ScrobbleEvent {
  id: number
  ts: number
  action: string | null
  event: string | null
  username: string | null
  media_type: string | null
  title: string | null
  rating_key: string | null
  ids: string[]
  image: string | null
  series_key: string | null
  seenr_status: number | null
  plex_status: number | null
  ok: boolean
  /** The bridge declined this watch by the operator's own configuration — syncing off,
   *  or a library that is not selected. Not a failure: nothing was attempted and
   *  nothing is broken, so it must never be counted or coloured as one. */
  skipped: boolean
  error: string | null
  payload: string | null
}

export interface Stats {
  total: number
  ok: number
  /** Attempts that failed. Excludes `skipped`, so this number only ever moves when
   *  something actually needs fixing. */
  failed: number
  skipped: number
  last: number | null
  episodes: number
  movies: number
  users: number
}

export interface Status {
  tautulli: { ok: boolean; message: string }
  webhook: boolean
  /** Whether the endpoint requires the secret header. Never the secret itself. */
  webhook_secured: boolean
  users: number
}

/** One device subscribed to push. Never carries the endpoint or its keys. */
export interface PushDevice {
  id: number
  label: string
  created: number
  last_ok: number | null
  fail_count: number
}

export interface AuthStatus {
  authenticated: boolean
  username: string | null
  needsSetup: boolean
  /** Whether the login page should offer Plex sign-in. Only set by /api/auth/status —
   *  it describes what the login page can do, not anything about a session. */
  plexLogin?: boolean
  /** Whether the signed-in account has a password at all. An account created by
   *  signing in with Plex has none, so the account menu must offer to SET one rather
   *  than asking for a current password it could never have. Only sent to an
   *  authenticated caller — an anonymous one has no business knowing. */
  hasPassword?: boolean
}

export interface TautulliMetadata {
  media_type: string
  /** Set by get_metadata; the library the item belongs to. */
  section_id?: string | number
  library_name?: string
  rating_key: string
  title: string
  grandparent_title: string
  parent_media_index: string
  media_index: string
  year: string | number
  duration: string | number
  guid: string
  grandparent_guid: string
  grandparent_rating_key: string
  guids: string[]
  thumb: string
  grandparent_thumb: string
}

export interface ActivitySession {
  session_key: string
  rating_key: string
  media_type: string
  title: string
  show_title: string
  season: string
  episode: string
  year: string
  username: string
  state: string
  progress_percent: number
  image: string | null
  library_name: string
  section_id: string
  guid: string
  show_rating_key: string
  show_guid: string
}

export interface PendingWatchEntry {
  rating_key: string
  mapping_id: number
  username: string
  plex_sync: boolean
}

export interface IncomingEvent {
  action: string
  rating_key: string
  username: string
}

export interface ProcessResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  event?: string
  ids?: string[]
  title?: string
  media_type?: string
  image?: string | null
  seenr_status?: number
  payload?: Record<string, unknown>
  fanout?: number // how many profiles it was forwarded to (real events only)
}

export type TestResult = ProcessResult

export interface SyncResult {
  ok: boolean
  webhookUrl?: string
  notifier_id?: number
  created?: boolean
  error?: string
}

/** One Tautulli library section, for the Settings library chooser. */
export interface LibrarySection {
  section_id: string
  section_name: string
  section_type: string
  count: number
}

export interface LibraryItem {
  rating_key: string
  title: string
  year: string
  media_type: string // 'show' | 'movie'
  image: string
  // Which Tautulli library the row came from. Not decoration: two active libraries
  // can hold the same title under DIFFERENT rating_keys (e.g. "Movies" and "Filme"),
  // and the pipeline gates on section — so picking the copy from a library you don't
  // actually play from forwards nothing. The picker has to make the two rows
  // distinguishable.
  section_id: string
  library_name: string
}

// One level below a title: a show's seasons, or a season's episodes. `index` is
// the season or episode number. Unlike LibraryItem there is no `year` — it is
// meaningless for an episode, and rating_key here is the child's OWN key, which
// is the whole point of drilling down.
export interface LibraryChild {
  rating_key: string
  title: string
  index: string
  media_type: string // 'season' | 'episode'
  image: string
}

// A title (show or movie) flagged as co-watched, with the mapping ids of its
// assigned profiles. rating_key is the show's own key for a series (matches
// an episode's grandparent_rating_key), or the movie's key.
export interface SharedTitle {
  rating_key: string
  media_type: string
  title: string | null
  year: string | null
  image: string | null
  /** The library this key belongs to. Null for a title shared before the columns
   *  existed and whose lookup hasn't succeeded yet — see /api/shared's backfill. */
  section_id: string | null
  library_name: string | null
  /** Plex's own id for the title. The same show in two libraries has two rating_keys
   *  but ONE guid, so this is what the pipeline matches a watch against. Null until
   *  resolved for a title shared before the column existed. */
  guid: string | null
  plex_sync: boolean
  profiles: number[] // mapping ids
}

/** Whether a Plex account is linked, and which mapped users have a usable token. */
export interface PlexLinkStatus {
  connected: boolean
  /** The signed-in Plex username. Absent when not connected or when plex.tv failed. */
  account?: string
  /** The server the bridge will write to, for confirmation. Fields are '' when
   *  plex.tv's resource list could not be read — the connection still works. */
  server?: {
    name: string
    machineId: string
    url: string
    product: string
    platform: string
    /** Null when unknown. False would mean the token cannot write to this server. */
    owned: boolean | null
  }
  matched: string[]
  unmatched: string[]
  error?: string
}

export interface BackfillResult {
  ok: boolean
  reason?: string
  media_type?: string
  title?: string
  items: number // movies: 1; shows: number of watched episodes found
  profiles: number // profiles delivered to
  delivered: number // total scrobbles sent (items × profiles, minus skips)
  ok_count: number
  fail_count: number
}

/** A Plex account that may sign in to the panel, and the one Settings has connected
 *  and could bind. Matched on `id` — plex.tv's numeric account id — never on username
 *  or email, since the holder can change both. */
export interface PlexAccountRef {
  id: string
  username: string
  thumb: string
}

export interface PlexLoginLink {
  /** The bridge user this link belongs to. */
  username: string
  /** The account already allowed to sign in, or null. */
  linked: PlexAccountRef | null
  /** The account Settings is connected as, offered so binding needs no second sign-in.
   *  Null when Plex is not connected or plex.tv could not be reached. */
  available: PlexAccountRef | null
}
