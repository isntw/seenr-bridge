import { firstUser, getSettings, parseNotifyUsers } from './db'
import { libraryGateReason } from './pipeline'
import { getMetadata } from './tautulli'
import { sendToAll, type SendResult } from './push'
import type { IncomingEvent, TautulliMetadata } from '../../shared/types'

const DEDUPE_WINDOW_MS = 30 * 60 * 1000

const recent = new Map<string, number>()

export function resetNotifyDedupe(): void {
  recent.clear()
}

function dedupeKey(username: string, ratingKey: string): string {
  return `${username.toLowerCase()}:${ratingKey}`
}

function seenRecently(username: string, ratingKey: string, now: number): boolean {
  const last = recent.get(dedupeKey(username, ratingKey))
  return last !== undefined && now - last < DEDUPE_WINDOW_MS
}

function remember(username: string, ratingKey: string, now: number): void {
  for (const [k, ts] of recent) {
    if (now - ts >= DEDUPE_WINDOW_MS) recent.delete(k)
  }
  recent.set(dedupeKey(username, ratingKey), now)
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

export function ownerNames(): string[] {
  const u = firstUser()
  return [u?.username, u?.plex_username]
    .filter((n): n is string => !!n)
    .map((n) => n.toLowerCase())
}

export function notifiesFor(username: string, storedUsers: string): boolean {
  const wanted = username.toLowerCase()
  if (ownerNames().includes(wanted)) return true
  return parseNotifyUsers(storedUsers).some((u) => u.toLowerCase() === wanted)
}

export interface NotifyResult {
  notified: boolean
  reason?: string
  send?: SendResult
}

export async function handlePlaybackStart(
  input: IncomingEvent,
  opts: { now?: number } = {},
): Promise<NotifyResult> {
  const now = opts.now ?? Date.now()
  const settings = getSettings()

  if (!settings.notify_enabled) return { notified: false, reason: 'Notifications are off' }
  if (!settings.tautulli_url || !settings.tautulli_apikey)
    return { notified: false, reason: 'Tautulli connection not configured' }

  if (!notifiesFor(input.username, settings.notify_users))
    return { notified: false, reason: `Not notifying for "${input.username}"` }

  if (seenRecently(input.username, input.rating_key, now))
    return { notified: false, reason: 'Already notified for this item recently' }

  let meta: TautulliMetadata
  try {
    meta = await getMetadata(settings.tautulli_url, settings.tautulli_apikey, input.rating_key)
  } catch (e) {
    const reason = `Metadata lookup failed: ${e instanceof Error ? e.message : String(e)}`
    console.warn('[notify] skipped', { username: input.username, rating_key: input.rating_key, reason })
    return { notified: false, reason }
  }

  const gate = libraryGateReason(settings, meta)
  if (gate) return { notified: false, reason: gate }

  remember(input.username, input.rating_key, now)

  const send = await sendToAll({
    title: [showOrTitle(meta), detail(meta)].filter(Boolean).join(' — '),
    body: `Started by ${input.username} · Watch together →`,
    url: `/dashboard?watch=${encodeURIComponent(input.rating_key)}&user=${encodeURIComponent(input.username)}`,
    tag: dedupeKey(input.username, input.rating_key),
  })

  return { notified: send.sent > 0, send }
}
