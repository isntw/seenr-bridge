import { firstUser, getSettings, isNotifyMuted, parseNotifyUsers } from './db'
import { libraryGateReason } from './pipeline'
import { getMetadata } from './tautulli'
import { posterUrl, WIDE_BOX } from './poster'
import { sendToAll, type PushPayload, type SendResult } from './push'
import type { IncomingEvent, TautulliMetadata } from '../../shared/types'

const ITEM_WINDOW_MS = 30 * 60 * 1000
const SHOW_WINDOW_MS = 6 * 60 * 60 * 1000

const recent = new Map<string, number>()

export function resetNotifyDedupe(): void {
  recent.clear()
}

function itemKey(username: string, ratingKey: string): string {
  return `${username.toLowerCase()}:${ratingKey}`
}

export function subjectKey(m: TautulliMetadata): string {
  return m.media_type === 'episode' && m.grandparent_rating_key
    ? m.grandparent_rating_key
    : m.rating_key
}

function showKey(username: string, subject: string): string {
  return `${username.toLowerCase()}:show:${subject}`
}

function seen(key: string, windowMs: number, now: number): boolean {
  const last = recent.get(key)
  return last !== undefined && now - last < windowMs
}

// Prune against the longest window: a show stamp is still live long after the
// item stamp sharing this map has expired.
function stamp(now: number, ...keys: string[]): void {
  for (const [k, ts] of recent) {
    if (now - ts >= SHOW_WINDOW_MS) recent.delete(k)
  }
  for (const k of keys) recent.set(k, now)
}

function showOrTitle(m: TautulliMetadata): string {
  return m.media_type === 'episode' && m.grandparent_title ? m.grandparent_title : m.title
}

/**
 * Art for the notification's wide image row, which is where Android shows a large
 * picture and wants roughly 16:9.
 *
 * Nothing goes in the `icon` slot: that one is square, and the platform scales
 * whatever it is given to fill it, so a 2:3 poster arrives squashed however
 * carefully it is fetched — Tautulli cannot crop (its get_image passes only
 * width/height to Plex's transcoder, which scales to fit). The app icon stays
 * there and the artwork goes here, each slot getting the shape it wants.
 *
 * An episode's `thumb` is its still and already 16:9; a movie's `thumb` is the 2:3
 * poster, so a film uses `art` — Plex's backdrop — instead.
 */
function wideArt(m: TautulliMetadata): string | undefined {
  return (m.media_type === 'episode' ? m.thumb || m.art : m.art) || undefined
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

/**
 * The whole notification, from metadata. Exported because /api/push/test sends a
 * real one for the last thing watched — a test that skipped this would prove only
 * that delivery works, and say nothing about the poster or the mute button.
 */
export function notificationFor(
  meta: TautulliMetadata,
  username: string,
  now = Date.now(),
): PushPayload {
  const subject = subjectKey(meta)

  return {
    title: [showOrTitle(meta), detail(meta)].filter(Boolean).join(' — '),
    body: `Started by ${username} · Watch together →`,
    url: `/dashboard?watch=${encodeURIComponent(meta.rating_key)}&user=${encodeURIComponent(username)}`,
    tag: showKey(username, subject),
    image: posterUrl(wideArt(meta), WIDE_BOX, now),
    mute: {
      subject_key: subject,
      title: showOrTitle(meta),
      media_type: meta.media_type === 'episode' ? 'show' : meta.media_type,
    },
  }
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

  const item = itemKey(input.username, input.rating_key)
  if (seen(item, ITEM_WINDOW_MS, now)) {
    stamp(now, item)
    return { notified: false, reason: 'Already notified for this item recently' }
  }

  let meta: TautulliMetadata
  try {
    meta = await getMetadata(settings.tautulli_url, settings.tautulli_apikey, input.rating_key)
  } catch (e) {
    const reason = `Metadata lookup failed: ${e instanceof Error ? e.message : String(e)}`
    console.warn('[notify] skipped', { username: input.username, rating_key: input.rating_key, reason })
    return { notified: false, reason }
  }

  const subject = subjectKey(meta)
  if (isNotifyMuted(subject)) return { notified: false, reason: `Muted: ${showOrTitle(meta)}` }

  const gate = libraryGateReason(settings, meta)
  if (gate) return { notified: false, reason: gate }

  const show = showKey(input.username, subject)
  if (seen(show, SHOW_WINDOW_MS, now)) {
    stamp(now, show, item)
    return { notified: false, reason: `Already notified for ${showOrTitle(meta)} recently` }
  }

  stamp(now, show, item)

  const send = await sendToAll(notificationFor(meta, input.username, now))

  return { notified: send.sent > 0, send }
}
