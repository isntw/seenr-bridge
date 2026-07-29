// Minimal Tautulli API client. Used to look up an item's REAL external IDs by
// rating_key — the piece the Tautulli webhook template cannot provide for episodes.

import { WEBHOOK_SECRET_HEADER } from './auth'
import type { ActivitySession, TautulliMetadata, LibraryItem, LibraryChild } from '../../shared/types'

// Tautulli wraps every response in the same envelope; only the `data` shape
// varies by command, so callers supply that as the type parameter.
interface TautulliResponse<T> {
  response?: {
    result?: string
    message?: string
    data?: T
  }
}

interface TautulliNotifier {
  id: number
  friendly_name: string
  agent_name: string
}

interface TautulliUser {
  username?: string
}

interface TautulliAddNotifierResult {
  notifier_id?: number
}

interface TautulliLibraryRaw {
  section_id: string | number
  section_name: string
  section_type: string
  count: string | number
}

export interface TautulliLibrary {
  section_id: string
  section_name: string
  section_type: string
  count: number
}

// Tautulli's DataTables-style endpoints (get_library_media_info, get_history)
// nest their rows one level under `data` inside the usual response envelope.
interface TautulliLibraryMediaRow {
  rating_key: string | number
  title: string
  year?: string | number | null
  media_type?: string
  thumb?: string
}

interface TautulliLibraryMediaInfo {
  data?: TautulliLibraryMediaRow[]
  /** Rows in the section, BEFORE `search` narrows them — so it stays comparable to
   *  the library row's `count` even on a filtered request. */
  recordsTotal?: string | number
}

interface TautulliHistoryRow {
  media_type?: string
  watched_status?: number | string
  rating_key: string | number
}

interface TautulliHistoryData {
  data?: TautulliHistoryRow[]
}

// get_children_metadata returns a show's seasons or a season's episodes through
// the same command — the level is decided purely by the rating_key passed in.
interface TautulliChildRow {
  rating_key: string | number
  title?: string
  media_index?: string | number | null
  media_type?: string
  thumb?: string
}

interface TautulliChildrenData {
  children_count?: string | number
  children_list?: TautulliChildRow[]
}

interface TautulliSession {
  session_key?: string | number
  rating_key?: string | number
  media_type?: string
  title?: string
  grandparent_title?: string
  parent_media_index?: string | number
  media_index?: string | number
  year?: string | number
  username?: string
  state?: string
  progress_percent?: string | number
  thumb?: string
  grandparent_thumb?: string
  library_name?: string
  section_id?: string | number
  guid?: string
  grandparent_rating_key?: string | number
  grandparent_guid?: string
}

interface TautulliActivityData {
  stream_count?: string | number
  sessions?: TautulliSession[]
}

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

export async function getMetadata(url: string, apiKey: string, ratingKey: string): Promise<TautulliMetadata> {
  const u = `${base(url)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_metadata&rating_key=${encodeURIComponent(ratingKey)}`
  const res = await fetch(u)
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`)
  const json = (await res.json()) as TautulliResponse<TautulliMetadata>
  const data = json?.response?.data
  if (!data || !data.rating_key) throw new Error('Tautulli returned no metadata for rating_key ' + ratingKey)
  return data
}

const WEBHOOK_AGENT_ID = 25
const BRIDGE_FRIENDLY_NAME = 'Seenr Bridge'

// Generic Tautulli API call (POST form-encoded so long JSON bodies are safe).
async function tautulliApi<T>(url: string, apiKey: string, cmd: string, params: Record<string, string> = {}): Promise<T> {
  const form = new URLSearchParams({ apikey: apiKey, cmd, ...params })
  const res = await fetch(`${base(url)}/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`)
  const json = (await res.json()) as TautulliResponse<T>
  if (json?.response?.result !== 'success') throw new Error(json?.response?.message || 'Tautulli API error')
  return json.response.data as T
}

// Create (or update) a single Webhook notifier in Tautulli pointed at the bridge.
// No username condition → it fires for every user; the bridge routes by username.
export async function syncSeenrWebhook(
  url: string,
  apiKey: string,
  webhookUrl: string,
  opts: { triggers?: string[]; secret?: string } = {}
): Promise<{ notifier_id: number; created: boolean }> {
  const triggers = opts.triggers && opts.triggers.length ? opts.triggers : ['watched']
  const notifiers = await tautulliApi<TautulliNotifier[]>(url, apiKey, 'get_notifiers')
  const existing = Array.isArray(notifiers)
    ? notifiers.find((n) => n.friendly_name === BRIDGE_FRIENDLY_NAME && n.agent_name === 'webhook')
    : undefined

  let notifier_id: number
  let created = false
  if (existing) {
    notifier_id = Number(existing.id)
  } else {
    const added = await tautulliApi<TautulliAddNotifierResult | number>(url, apiKey, 'add_notifier_config', { agent_id: String(WEBHOOK_AGENT_ID) })
    notifier_id = Number(typeof added === 'number' ? added : added?.notifier_id)
    if (!notifier_id) throw new Error('Failed to create notifier in Tautulli')
    created = true
  }

  const jsonData = JSON.stringify({ action: '{action}', rating_key: '{rating_key}', username: '{username}' })
  const jsonHeaders = JSON.stringify({
    'Content-Type': 'application/json',
    ...(opts.secret ? { [WEBHOOK_SECRET_HEADER]: opts.secret } : {}),
  })

  const params: Record<string, string> = {
    notifier_id: String(notifier_id),
    agent_id: String(WEBHOOK_AGENT_ID),
    friendly_name: BRIDGE_FRIENDLY_NAME,
    webhook_hook: webhookUrl,
    webhook_method: 'POST',
  }
  // Enable exactly the chosen triggers (0 disables, so re-syncing is authoritative);
  // populate body + headers for every action so any trigger works if enabled later.
  for (const a of ['play', 'stop', 'pause', 'resume', 'watched']) {
    params[`on_${a}`] = triggers.includes(a) ? '1' : '0'
    params[`on_${a}_body`] = jsonData
    params[`on_${a}_subject`] = jsonHeaders
  }

  await tautulliApi(url, apiKey, 'set_notifier_config', params)
  return { notifier_id, created }
}

// Proxy a Plex image (poster/thumb) through Tautulli so the API key stays server-side.
export async function fetchImage(
  url: string,
  apiKey: string,
  imgPath: string,
  width = 92,
  height = 138
): Promise<{ contentType: string; buffer: Buffer } | null> {
  const u = `${base(url)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=pms_image_proxy&img=${encodeURIComponent(imgPath)}&width=${width}&height=${height}&fallback=poster`
  const res = await fetch(u)
  if (!res.ok) return null
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  if (!contentType.startsWith('image/')) return null
  const buffer = Buffer.from(await res.arrayBuffer())
  return { contentType, buffer }
}

// Whether a "Seenr Bridge" webhook notifier already exists in Tautulli.
export async function bridgeWebhookExists(url: string, apiKey: string): Promise<boolean> {
  const notifiers = await tautulliApi<TautulliNotifier[]>(url, apiKey, 'get_notifiers')
  return Array.isArray(notifiers) && notifiers.some((n) => n.friendly_name === BRIDGE_FRIENDLY_NAME && n.agent_name === 'webhook')
}

// The Plex libraries Tautulli monitors (used to find the show/movie sections).
export async function getLibraries(url: string, apiKey: string): Promise<TautulliLibrary[]> {
  const data = await tautulliApi<TautulliLibraryRaw[]>(url, apiKey, 'get_libraries')
  if (!Array.isArray(data)) return []
  return data.map((d) => ({
    section_id: String(d.section_id),
    section_name: d.section_name,
    section_type: d.section_type,
    count: Number(d.count) || 0,
  }))
}

// Tautulli's media-info table is a CACHE it only rebuilds when asked. Left alone
// it keeps serving the snapshot from whenever it was last built: a section that
// gained titles hides them, and one that lost them still offers rating_keys Plex
// no longer resolves — which then render as Plex's generic placeholder poster and
// scrobble nothing. Observed live: section "Movies" served 99 of its 308 films and
// listed an "Avatar" whose key was long gone.
// The library row's own `count` tracks Plex correctly, so a disagreement with
// `recordsTotal` is a reliable staleness signal. One refresh (~0.2-0.7s) fixes the
// section for good; the cooldown means a burst of debounced searches triggers at
// most one rebuild, so a library whose two counts never converge costs one extra
// call a minute rather than one per keystroke.
const REFRESH_COOLDOWN_MS = 60_000
const lastRefreshAt = new Map<string, number>()

/** Test seam only — module state would otherwise leak between specs. */
export function resetLibraryRefreshCooldown(): void {
  lastRefreshAt.clear()
}

function mayRefresh(sectionId: string, now: number): boolean {
  const last = lastRefreshAt.get(sectionId) ?? 0
  if (now - last < REFRESH_COOLDOWN_MS) return false
  lastRefreshAt.set(sectionId, now)
  return true
}

// Browse the show/movie library for the "shared titles" picker. Merges every
// section of the requested type, searches server-side, and paginates in memory.
export async function getLibraryItems(
  url: string,
  apiKey: string,
  opts: {
    type: 'show' | 'movie'
    search?: string
    start?: number
    length?: number
    /** Tautulli section_ids the operator selected in Settings. EMPTY MEANS ALL —
     *  the same convention the settings column uses, so an unconfigured install
     *  keeps browsing everything. Without this, every section of a type is merged,
     *  which lists a title once per library that contains it. */
    sections?: string[]
  },
): Promise<{ items: LibraryItem[]; total: number }> {
  const allowed = opts.sections ?? []
  const sections = (await getLibraries(url, apiKey))
    .filter((l) => l.section_type === opts.type)
    .filter((l) => !allowed.length || allowed.includes(l.section_id))
  const search = (opts.search || '').trim()
  const all: LibraryItem[] = []
  const now = Date.now()
  for (const sec of sections) {
    const query = (refresh: boolean) => ({
      section_id: sec.section_id,
      order_column: 'title',
      order_dir: 'asc',
      start: '0',
      length: '5000', // personal-scale libraries; search narrows large ones
      ...(search ? { search } : {}),
      ...(refresh ? { refresh: 'true' } : {}),
    })

    let data = await tautulliApi<TautulliLibraryMediaInfo>(url, apiKey, 'get_library_media_info', query(false))
    if (Number(data?.recordsTotal) !== sec.count && mayRefresh(sec.section_id, now)) {
      data = await tautulliApi<TautulliLibraryMediaInfo>(url, apiKey, 'get_library_media_info', query(true))
    }

    const rows = Array.isArray(data?.data) ? data.data : []
    for (const r of rows) {
      all.push({
        rating_key: String(r.rating_key),
        title: r.title,
        year: r.year != null ? String(r.year) : '',
        media_type: r.media_type || opts.type,
        image: r.thumb || '',
        section_id: sec.section_id,
        library_name: sec.section_name,
      })
    }
  }
  all.sort((a, b) => a.title.localeCompare(b.title))
  const start = opts.start || 0
  const length = opts.length || 50
  return { items: all.slice(start, start + length), total: all.length }
}

// Distinct episode rating_keys that reached "watched" for a given show, across all
// users — used to retroactively scrobble a newly-shared show to its co-watchers.
export async function getWatchedEpisodeKeys(url: string, apiKey: string, grandparentRatingKey: string): Promise<string[]> {
  const data = await tautulliApi<TautulliHistoryData>(url, apiKey, 'get_history', {
    grandparent_rating_key: grandparentRatingKey,
    length: '1000',
  })
  const rows = Array.isArray(data?.data) ? data.data : []
  const keys = rows
    .filter((r) => r.media_type === 'episode' && Number(r.watched_status) === 1)
    .map((r) => String(r.rating_key))
  return Array.from(new Set(keys))
}

// Pull the list of Plex users Tautulli knows about, so the UI can offer them as
// a dropdown instead of a free-text field. Skips the synthetic "Local" account.
export async function getUsers(url: string, apiKey: string): Promise<string[]> {
  const data = await tautulliApi<TautulliUser[]>(url, apiKey, 'get_users')
  if (!Array.isArray(data)) return []
  const names = data
    .map((u) => String(u?.username || '').trim())
    .filter((name: string) => name && name.toLowerCase() !== 'local')
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
}

export async function testConnection(url: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const u = `${base(url)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_server_info`
    const res = await fetch(u)
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    const json = (await res.json()) as TautulliResponse<{ pms_name?: string }>
    const name = json?.response?.data?.pms_name
    if (json?.response?.result === 'success') return { ok: true, message: `Connected to "${name || 'Plex'}"` }
    return { ok: false, message: json?.response?.message || 'Unexpected response' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: msg }
  }
}

// One level below a title. Called twice by the test-scrobble picker: show →
// seasons, then season → episodes. The episode's own rating_key is what the
// caller needs — a show's key is exactly the wrong thing to scrobble, which is
// the Tautulli defect this whole bridge exists to work around.
export async function getChildren(url: string, apiKey: string, ratingKey: string): Promise<LibraryChild[]> {
  const data = await tautulliApi<TautulliChildrenData>(url, apiKey, 'get_children_metadata', {
    rating_key: ratingKey,
  })
  const rows = Array.isArray(data?.children_list) ? data.children_list : []
  return rows
    .filter((r) => r.rating_key != null && String(r.rating_key) !== '')
    .map((r) => ({
      rating_key: String(r.rating_key),
      title: r.title || '',
      index: r.media_index != null ? String(r.media_index) : '',
      media_type: r.media_type || '',
      image: r.thumb || '',
    }))
}

const str = (v: unknown): string => (v == null ? '' : String(v))

export async function getActivity(url: string, apiKey: string): Promise<ActivitySession[]> {
  const data = await tautulliApi<TautulliActivityData>(url, apiKey, 'get_activity')
  const rows = Array.isArray(data?.sessions) ? data.sessions : []
  return rows
    .filter((s) => s.rating_key != null && String(s.rating_key) !== '')
    .map((s) => ({
      session_key: str(s.session_key),
      rating_key: str(s.rating_key),
      media_type: str(s.media_type),
      title: str(s.title),
      show_title: str(s.grandparent_title),
      season: str(s.parent_media_index),
      episode: str(s.media_index),
      year: str(s.year),
      username: str(s.username),
      state: str(s.state),
      progress_percent: Number(s.progress_percent) || 0,
      image: s.grandparent_thumb || s.thumb || null,
      library_name: str(s.library_name),
      section_id: str(s.section_id),
      guid: str(s.guid),
      show_rating_key: str(s.grandparent_rating_key),
      show_guid: str(s.grandparent_guid),
    }))
}
