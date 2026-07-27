import {
  getSettings, getMappingByUsername, getSharedRecipients, listSharedTitles, insertEvent,
  parseLibraries,
  type MappingRow, type SettingsRow,
} from './db'
import { getMetadata, getWatchedEpisodeKeys } from './tautulli'
import { buildPayload } from './scrobble'
import { forwardToSeenr } from './seenr'
import type { IncomingEvent, ProcessResult, BackfillResult, TautulliMetadata } from '../../shared/types'

function imageFor(meta: TautulliMetadata): string | null {
  return meta.media_type === 'episode' ? meta.grandparent_thumb || meta.thumb || null : meta.thumb || null
}
function seriesKeyFor(meta: TautulliMetadata): string | null {
  return meta.media_type === 'episode' ? meta.grandparent_rating_key || null : null
}
// The title key a share is keyed on: the show's own key for episodes, else the item's.
function titleKeyFor(meta: TautulliMetadata, ratingKey: string): string {
  return meta.media_type === 'episode' ? meta.grandparent_rating_key || ratingKey : ratingKey
}

// Deliver one item, as watched/whatever, to one profile. Honors the profile's
// enabled + per-type sync switches. Records a real event unless record === false.
// Returns null when skipped (nothing forwarded), else the delivery result.
async function deliverToMapping(
  meta: TautulliMetadata,
  ratingKey: string,
  action: string,
  mapping: MappingRow,
  settings: SettingsRow,
  now: number,
  record: boolean,
): Promise<{ ok: boolean; seenr_status?: number } | null> {
  if (!mapping.enabled) return null
  if (meta.media_type === 'movie' && !mapping.sync_movies) return null
  if (meta.media_type === 'episode' && !mapping.sync_episodes) return null

  const built = buildPayload(meta, action, mapping.username)
  const image = imageFor(meta)
  const series_key = seriesKeyFor(meta)

  let status: number, respBody: string
  try {
    const r = await forwardToSeenr(settings.seenr_base_url, mapping.seenr_token, built.payload)
    status = r.status
    respBody = r.body
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (record)
      insertEvent({
        ts: now, action, event: built.event, username: mapping.username, media_type: meta.media_type,
        title: built.title, rating_key: ratingKey, ids: JSON.stringify(built.ids), image, series_key,
        seenr_status: null, plex_status: null, ok: 0, error: `Forward to seenr failed: ${msg}`, payload: JSON.stringify(built.payload),
      })
    return { ok: false }
  }

  const ok = status >= 200 && status < 300
  if (record)
    insertEvent({
      ts: now, action, event: built.event, username: mapping.username, media_type: meta.media_type,
      title: built.title, rating_key: ratingKey, ids: JSON.stringify(built.ids), image, series_key,
      seenr_status: status, plex_status: null, ok: ok ? 1 : 0,
      error: ok ? null : `seenr HTTP ${status} ${respBody?.slice(0, 200)}`.trim(), payload: JSON.stringify(built.payload),
    })
  return { ok, seenr_status: status }
}

// Full pipeline: enrich a Tautulli event with the item's real IDs and forward to seenr.
// For a title marked "shared" (and watched by one of its profiles), fans the scrobble
// out to every co-watching profile. When dryRun is true the payload is built but not sent.
export async function processEvent(
  input: IncomingEvent,
  opts: { dryRun?: boolean; record?: boolean } = {},
): Promise<ProcessResult> {
  const record = opts.record !== false
  const settings = getSettings()
  const now = Date.now()

  const fail = (reason: string, extra: Partial<ProcessResult> = {}): ProcessResult => {
    if (record)
      insertEvent({
        ts: now, action: input.action, event: extra.event ?? null, username: input.username,
        media_type: extra.media_type ?? null, title: extra.title ?? null, rating_key: input.rating_key,
        ids: extra.ids ? JSON.stringify(extra.ids) : null, image: extra.image ?? null, series_key: null,
        seenr_status: extra.seenr_status ?? null, plex_status: null,
        ok: 0, error: reason, payload: extra.payload ? JSON.stringify(extra.payload) : null,
      })
    return { ok: false, reason, ...extra }
  }

  if (!settings.tautulli_url || !settings.tautulli_apikey)
    return fail('Tautulli connection not configured')

  const trigger = getMappingByUsername(input.username)
  if (!trigger)
    return { ok: false, skipped: true, reason: `No seenr mapping for user "${input.username}"` }
  if (!trigger.enabled)
    return { ok: false, skipped: true, reason: `Mapping for "${input.username}" is disabled` }

  let meta: TautulliMetadata
  try {
    meta = await getMetadata(settings.tautulli_url, settings.tautulli_apikey, input.rating_key)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return fail(`Metadata lookup failed: ${msg}`)
  }

  const built = buildPayload(meta, input.action, input.username)
  const image = imageFor(meta)
  const common = { event: built.event, ids: built.ids, title: built.title, media_type: meta.media_type, image, payload: built.payload }

  if (opts.dryRun) return { ok: true, ...common }

  // Library gate. An empty selection means every library, so an upgrade cannot
  // silently stop forwarding for anyone who has not opened Settings.
  //
  // This one is RECORDED rather than returned silently, unlike the unmapped-user
  // case above: that is Tautulli telling us about somebody the operator never
  // configured, whereas this is a rule the operator did configure — so a
  // mis-ticked library has to be visible on the Dashboard, or it is undiagnosable.
  const allowed = parseLibraries(settings.libraries)
  if (allowed.length && !allowed.includes(String(meta.section_id ?? ''))) {
    const where = meta.library_name || `section ${meta.section_id ?? '?'}`
    return fail(`Library "${where}" is not selected in Settings`, common)
  }

  if (!settings.forward_enabled)
    return fail('Forwarding is disabled in settings', common)

  // Fan-out: if this title is shared AND the watcher is one of its profiles,
  // deliver to every assigned profile; otherwise just the watcher.
  const key = titleKeyFor(meta, input.rating_key)
  const shared = getSharedRecipients(key)
  let recipients: MappingRow[] = [trigger]
  if (shared.length && shared.some((r) => r.id === trigger.id)) recipients = shared

  let triggerResult: { ok: boolean; seenr_status?: number } | null = null
  let delivered = 0
  for (const rcpt of recipients) {
    const res = await deliverToMapping(meta, input.rating_key, input.action, rcpt, settings, now, record)
    if (res) delivered++
    if (rcpt.id === trigger.id) triggerResult = res
  }

  // Per-type sync could skip the trigger while still delivering to co-watchers.
  if (!triggerResult) {
    const why = meta.media_type === 'movie' ? 'Movie sync is off' : meta.media_type === 'episode' ? 'Episode sync is off' : 'Skipped'
    return { ok: delivered > 0, skipped: delivered === 0, reason: `${why} for ${trigger.username}`, fanout: delivered, ...common }
  }
  return { ok: triggerResult.ok, seenr_status: triggerResult.seenr_status, fanout: delivered, ...common }
}

// Retroactively scrobble an already-shared title to its co-watching profiles.
// Movie → the movie itself. Show → every episode Tautulli has recorded as watched.
export async function backfillSharedTitle(ratingKey: string): Promise<BackfillResult> {
  const settings = getSettings()
  const now = Date.now()
  const empty = { items: 0, profiles: 0, delivered: 0, ok_count: 0, fail_count: 0 }

  if (!settings.tautulli_url || !settings.tautulli_apikey) return { ok: false, reason: 'Tautulli not configured', ...empty }
  if (!settings.forward_enabled) return { ok: false, reason: 'Forwarding is disabled in settings', ...empty }

  const share = listSharedTitles().find((s) => s.rating_key === ratingKey)
  if (!share) return { ok: false, reason: 'Title is not shared', ...empty }
  const profiles = getSharedRecipients(ratingKey)
  if (!profiles.length) return { ok: false, reason: 'No profiles assigned to this title', ...empty }

  // Collect the item rating_keys to scrobble.
  let itemKeys: string[]
  if (share.media_type === 'movie') {
    itemKeys = [ratingKey]
  } else {
    try {
      itemKeys = await getWatchedEpisodeKeys(settings.tautulli_url, settings.tautulli_apikey, ratingKey)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, reason: `History lookup failed: ${msg}`, ...empty }
    }
    if (!itemKeys.length)
      return { ok: false, reason: 'No watched episodes found in Tautulli history', items: 0, profiles: profiles.length, delivered: 0, ok_count: 0, fail_count: 0 }
  }

  let ok_count = 0, fail_count = 0, delivered = 0
  for (const itemKey of itemKeys) {
    let meta: TautulliMetadata
    try {
      meta = await getMetadata(settings.tautulli_url, settings.tautulli_apikey, itemKey)
    } catch {
      continue // skip an item we can't resolve
    }
    for (const p of profiles) {
      const res = await deliverToMapping(meta, itemKey, 'watched', p, settings, now, true)
      if (!res) continue
      delivered++
      if (res.ok) ok_count++
      else fail_count++
    }
  }

  return {
    ok: fail_count === 0 && delivered > 0,
    media_type: share.media_type,
    title: share.title || undefined,
    items: itemKeys.length,
    profiles: profiles.length,
    delivered,
    ok_count,
    fail_count,
  }
}
