export interface Settings {
  tautulli_url: string
  tautulli_apikey: string
  seenr_base_url: string
  forward_enabled: boolean
  bridge_url: string
  sync_movies: boolean
  sync_episodes: boolean
}

export interface Mapping {
  id: number
  username: string
  seenr_token: string
  enabled: boolean
  sync_movies: boolean
  sync_episodes: boolean
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
  ok: boolean
  error: string | null
  payload: string | null
}

export interface Stats {
  total: number
  ok: number
  failed: number
  last: number | null
  episodes: number
  movies: number
  users: number
}

export interface Status {
  tautulli: { ok: boolean; message: string }
  webhook: boolean
  users: number
}

export interface AuthStatus {
  authenticated: boolean
  username: string | null
  needsSetup: boolean
}

export interface TautulliMetadata {
  media_type: string
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

export interface LibraryItem {
  rating_key: string
  title: string
  year: string
  media_type: string // 'show' | 'movie'
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
  profiles: number[] // mapping ids
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
