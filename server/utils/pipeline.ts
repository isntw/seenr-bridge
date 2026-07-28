import {
  getSettings, getMappingByUsername, getSharedRecipients, getSharedTitle, listSharedTitles, insertEvent,
  parseLibraries, getPendingWatches, deletePendingWatchesByIds,
  type MappingRow, type SettingsRow, type PendingWatch,
} from './db'
import { getMetadata, getWatchedEpisodeKeys } from './tautulli'
import { buildPayload } from './scrobble'
import { forwardToSeenr } from './seenr'
import { getPlexServer, markWatched, resolvePlexToken, type PlexServer } from './plex'
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
// Plex's id for that same title, which — unlike the rating_key — is identical across
// libraries holding the same show or film. This is what makes a share match a watch
// from the copy the operator did not happen to pick when creating it.
function titleGuidFor(meta: TautulliMetadata): string {
  return (meta.media_type === 'episode' ? meta.grandparent_guid : meta.guid) || ''
}

interface DeliverOpts {
  /** Record a real event row. False for previews. */
  record: boolean
  /** Where to mark watched, or null to skip Plex for this delivery. */
  plex: PlexServer | null
  /** Why Plex could not be attempted at all, for the event row. */
  plexError: string | null
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
  opts: DeliverOpts,
): Promise<{ ok: boolean; seenr_status?: number } | null> {
  if (!mapping.enabled) return null
  if (meta.media_type === 'movie' && !mapping.sync_movies) return null
  if (meta.media_type === 'episode' && !mapping.sync_episodes) return null

  const built = buildPayload(meta, action, mapping.username)
  const image = imageFor(meta)
  const series_key = seriesKeyFor(meta)

  // Plex first, and independent of seenr: they are separate destinations, so a
  // seenr outage must not leave the co-watcher's Plex untouched (or vice versa).
  let plex_status: number | null = null
  let plexError: string | null = opts.plexError
  if (opts.plex && !plexError) {
    try {
      const token = await resolvePlexToken(
        mapping.username,
        mapping.plex_token,
        opts.plex.machineId,
        settings.plex_token,
      )
      if (!token) {
        plexError = `No Plex token for ${mapping.username}`
      } else {
        plex_status = await markWatched(opts.plex.url, token, ratingKey)
        if (plex_status < 200 || plex_status >= 300) plexError = `Plex HTTP ${plex_status}`
      }
    } catch (e) {
      plexError = `Plex write failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  let status: number | null = null
  let seenrError: string | null = null
  try {
    const r = await forwardToSeenr(settings.seenr_base_url, mapping.seenr_token, built.payload)
    status = r.status
    if (status < 200 || status >= 300)
      seenrError = `seenr HTTP ${status} ${r.body?.slice(0, 200)}`.trim()
  } catch (e) {
    seenrError = `Forward to seenr failed: ${e instanceof Error ? e.message : String(e)}`
  }

  // `ok` means THE SEENR FORWARD SUCCEEDED, deliberately. A failed Plex write must
  // not flip it, or the Dashboard's failure count stops describing the bridge's job.
  const ok = status !== null && status >= 200 && status < 300
  if (opts.record)
    insertEvent({
      ts: now, action, event: built.event, username: mapping.username, media_type: meta.media_type,
      title: built.title, rating_key: ratingKey, ids: JSON.stringify(built.ids), image, series_key,
      // Never a skip: reaching here means the forward was actually attempted. The
      // per-mapping gates that decline one return above, before any row is written.
      seenr_status: status, plex_status, ok: ok ? 1 : 0, skipped: 0,
      error: [seenrError, plexError].filter(Boolean).join(' · ') || null,
      payload: JSON.stringify(built.payload),
    })

  return { ok, seenr_status: status ?? undefined }
}

// Resolve the Plex server ONCE per pipeline run, not once per delivery: a 60-episode
// backfill across two co-watchers would otherwise ask Tautulli for the same address
// 120 times. Never throws — a lookup failure becomes text on the event row.
async function plexTargetFor(
  settings: SettingsRow,
): Promise<{ target: PlexServer | null; error: string | null }> {
  if (!settings.plex_token)
    return { target: null, error: 'No Plex account connected in Settings' }
  try {
    return { target: await getPlexServer(settings.tautulli_url, settings.tautulli_apikey), error: null }
  } catch (e) {
    return { target: null, error: `Plex server lookup failed: ${e instanceof Error ? e.message : String(e)}` }
  }
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

  // Two kinds of non-delivery, recorded the same way but NOT the same thing. `fail` is
  // "we tried and it broke"; `skip` is "the operator's own configuration said don't".
  // They shared one code path before, so a switched-off bridge reported every watch as
  // a red failure and inflated the Dashboard's failure count with nothing to fix.
  const notDelivered = (
    reason: string,
    skipped: boolean,
    extra: Partial<ProcessResult>,
  ): ProcessResult => {
    if (record)
      insertEvent({
        ts: now, action: input.action, event: extra.event ?? null, username: input.username,
        media_type: extra.media_type ?? null, title: extra.title ?? null, rating_key: input.rating_key,
        ids: extra.ids ? JSON.stringify(extra.ids) : null, image: extra.image ?? null, series_key: null,
        seenr_status: extra.seenr_status ?? null, plex_status: null,
        ok: 0, skipped: skipped ? 1 : 0, error: reason,
        payload: extra.payload ? JSON.stringify(extra.payload) : null,
      })
    return { ok: false, ...(skipped ? { skipped: true } : {}), reason, ...extra }
  }
  const fail = (reason: string, extra: Partial<ProcessResult> = {}) =>
    notDelivered(reason, false, extra)
  const skip = (reason: string, extra: Partial<ProcessResult> = {}) =>
    notDelivered(reason, true, extra)

  if (!settings.tautulli_url || !settings.tautulli_apikey)
    return fail('Tautulli connection not configured')

  const trigger = getMappingByUsername(input.username)

  const pendingByKey = getPendingWatches(input.rating_key)

  const triggerUsable = !!trigger && !!trigger.enabled
  if (!triggerUsable && !pendingByKey.length) {
    if (!trigger)
      return { ok: false, skipped: true, reason: `No seenr mapping for user "${input.username}"` }
    return { ok: false, skipped: true, reason: `Mapping for "${input.username}" is disabled` }
  }

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
    return skip(`Library "${where}" is not selected in Settings`, common)
  }

  if (!settings.forward_enabled)
    return skip('Syncing is disabled in settings', common)

  // Fan-out: if this title is shared AND the watcher is one of its profiles,
  // deliver to every assigned profile; otherwise just the watcher.
  const key = titleKeyFor(meta, input.rating_key)
  const guid = titleGuidFor(meta)
  const shared = getSharedRecipients(key, guid)

  const pending: PendingWatch[] = getPendingWatches(input.rating_key, meta.guid || null)

  let recipients: MappingRow[] = triggerUsable ? [trigger!] : []
  if (shared.length && triggerUsable && shared.some((r) => r.id === trigger!.id)) recipients = [...shared]
  for (const p of pending) {
    if (!recipients.some((r) => r.id === p.mapping.id)) recipients.push(p.mapping)
  }

  const share = recipients.length > 1 || pending.length ? getSharedTitle(key, guid) : undefined
  const plexFor = new Set<number>()
  if (share?.plex_sync) for (const r of shared) plexFor.add(r.id)
  for (const p of pending) if (p.plex_sync) plexFor.add(p.mapping.id)
  const plex = plexFor.size ? await plexTargetFor(settings) : { target: null, error: null }

  let triggerResult: { ok: boolean; seenr_status?: number } | null = null
  let delivered = 0
  for (const rcpt of recipients) {
    // The trigger is excluded from Plex: they pressed play, so their copy is already
    // watched. Everything else about their delivery is unchanged.
    const isTrigger = !!trigger && rcpt.id === trigger.id
    const wantsPlex = !isTrigger && plexFor.has(rcpt.id)
    const res = await deliverToMapping(meta, input.rating_key, input.action, rcpt, settings, now, {
      record,
      plex: wantsPlex ? plex.target : null,
      plexError: wantsPlex ? plex.error : null,
    })
    if (res) delivered++
    if (isTrigger) triggerResult = res
  }

  if (record && pending.length) deletePendingWatchesByIds(pending.map((p) => p.id))

  // Per-type sync could skip the trigger while still delivering to co-watchers.
  if (!triggerResult) {
    if (!triggerUsable) {
      if (delivered === 0)
        return skip('No profile could be counted for this watch', common)
      return { ok: true, fanout: delivered, ...common }
    }
    const why = meta.media_type === 'movie' ? 'Movie sync is off' : meta.media_type === 'episode' ? 'Episode sync is off' : 'Skipped'
    return { ok: delivered > 0, skipped: delivered === 0, reason: `${why} for ${trigger!.username}`, fanout: delivered, ...common }
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
  if (!settings.forward_enabled) return { ok: false, reason: 'Syncing is disabled in settings', ...empty }

  const share = listSharedTitles().find((s) => s.rating_key === ratingKey)
  if (!share) return { ok: false, reason: 'Title is not shared', ...empty }
  const profiles = getSharedRecipients(ratingKey)
  if (!profiles.length) return { ok: false, reason: 'No profiles assigned to this title', ...empty }

  // No trigger user exists in a backfill — nobody just watched anything — so every
  // assigned profile is marked, with none excluded.
  const plex = share.plex_sync ? await plexTargetFor(settings) : { target: null, error: null }

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
      const res = await deliverToMapping(meta, itemKey, 'watched', p, settings, now, {
        record: true,
        plex: plex.target,
        plexError: plex.error,
      })
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
