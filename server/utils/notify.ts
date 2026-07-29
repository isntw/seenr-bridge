import { getSettings, parseLibraries, parseNotifyUsers } from './db'
import { getMetadata } from './tautulli'
import { sendToAll, type SendResult } from './push'
import type { IncomingEvent, TautulliMetadata } from '../../shared/types'

/** Tautulli fires `play` on every play, and some clients fire it more than once for
 *  one press. Suppressing a repeat of the same (user, item) for this long keeps a
 *  paused-and-resumed film from buzzing twice. */
const DEDUPE_WINDOW_MS = 30 * 60 * 1000

/** In memory, not SQLite: this is ephemeral noise-suppression state, and losing it
 *  on restart costs at most one duplicate notification. Module-level is fine for
 *  that, unlike useDb()'s handle which must survive HMR re-evaluation. */
const recent = new Map<string, number>()

/** Exists so module state does not leak between spec files — the same reason
 *  resetLibraryRefreshCooldown() exists in tautulli.ts. */
export function resetNotifyDedupe(): void {
  recent.clear()
}

function dedupeKey(username: string, ratingKey: string): string {
  return `${username.toLowerCase()}:${ratingKey}`
}

function seenRecently(username: string, ratingKey: string, now: number): boolean {
  const key = dedupeKey(username, ratingKey)
  const last = recent.get(key)
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true

  // Opportunistic prune, same shape as insertEvent's row trim: expired entries go
  // on the next write rather than needing a timer.
  for (const [k, ts] of recent) {
    if (now - ts >= DEDUPE_WINDOW_MS) recent.delete(k)
  }
  recent.set(key, now)
  return false
}

function showOrTitle(m: TautulliMetadata): string {
  return m.media_type === 'episode' && m.grandparent_title ? m.grandparent_title : m.title
}

function detail(m: TautulliMetadata): string {
  if (m.media_type === 'episode') {
    const s = m.parent_media_index || '?'
    const e = m.media_index || '?'
    return m.title ? `S${s}·E${e} · ${m.title}` : `S${s}·E${e}`
  }
  return String(m.year || '')
}

export interface NotifyResult {
  notified: boolean
  reason?: string
  send?: SendResult
}

/** Handle a playback-start webhook: notify, never scrobble.
 *
 *  Deliberately NOT part of processEvent(). That function returns before its
 *  metadata lookup when the user has no mapping and nothing is pending —
 *
 *    if (!triggerUsable && !pendingByKey.length) return { skipped: true, ... }
 *
 *  — which is exactly the housemate this feature exists for: someone with no seenr
 *  account of their own, whose watch you still want to count for a co-watcher.
 *
 *  It also writes no `events` row. That table is capped at 1000 and trimmed on every
 *  insert, so a row per play would flush real scrobbles out roughly twice as fast and
 *  fill the Dashboard with non-scrobbles. */
export async function handlePlaybackStart(
  input: IncomingEvent,
  opts: { now?: number } = {},
): Promise<NotifyResult> {
  const now = opts.now ?? Date.now()
  const settings = getSettings()

  if (!settings.notify_enabled) return { notified: false, reason: 'Notifications are off' }
  if (!settings.tautulli_url || !settings.tautulli_apikey)
    return { notified: false, reason: 'Tautulli connection not configured' }

  // Empty means nobody here, unlike settings.libraries where empty means all.
  const watched = parseNotifyUsers(settings.notify_users)
  if (!watched.some((u) => u.toLowerCase() === input.username.toLowerCase()))
    return { notified: false, reason: `Not notifying for "${input.username}"` }

  if (seenRecently(input.username, input.rating_key, now))
    return { notified: false, reason: 'Already notified for this item recently' }

  let meta: TautulliMetadata
  try {
    meta = await getMetadata(settings.tautulli_url, settings.tautulli_apikey, input.rating_key)
  } catch (e) {
    return {
      notified: false,
      reason: `Metadata lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Same library gate the pipeline applies, so a section you deselected does not
  // notify either. Empty means every library, matching parseLibraries' contract.
  const allowed = parseLibraries(settings.libraries)
  if (allowed.length && !allowed.includes(String(meta.section_id ?? ''))) {
    const where = meta.library_name || `section ${meta.section_id ?? '?'}`
    return { notified: false, reason: `Library "${where}" is not selected in Settings` }
  }

  const send = await sendToAll({
    title: `${input.username} started ${showOrTitle(meta)}`,
    body: [detail(meta), 'Tap to count it for someone'].filter(Boolean).join(' — '),
    url: `/dashboard?watch=${encodeURIComponent(input.rating_key)}&user=${encodeURIComponent(input.username)}`,
    tag: dedupeKey(input.username, input.rating_key),
  })

  return { notified: send.sent > 0, send }
}
