import type { ScrobbleEvent } from '../../shared/types'

export interface EventRecipient {
  id: number
  username: string | null
  ok: boolean
  /** Declined by configuration. Neither a success nor a failure — see ScrobbleEvent. */
  skipped: boolean
  seenr_status: number | null
  plex_status: number | null
  error: string | null
  payload: string | null
}

export interface EventGroup {
  key: string
  ts: number
  action: string | null
  event: string | null
  media_type: string | null
  title: string | null
  rating_key: string | null
  ids: string[]
  image: string | null
  series_key: string | null
  recipients: EventRecipient[]
  okCount: number
  skippedCount: number
}

export function groupEvents(events: ScrobbleEvent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>()

  for (const e of events) {
    // Exact, not a time window: pipeline.ts computes `Date.now()` once per watch and
    // gives every recipient row the same ts.
    const key = `${e.ts}|${e.rating_key ?? ''}|${e.event ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        ts: e.ts,
        action: e.action,
        event: e.event,
        media_type: e.media_type,
        title: e.title,
        rating_key: e.rating_key,
        ids: e.ids,
        image: e.image,
        series_key: e.series_key,
        recipients: [],
        okCount: 0,
        skippedCount: 0,
      }
      groups.set(key, g)
    }
    g.recipients.push({
      id: e.id,
      username: e.username,
      ok: e.ok,
      skipped: e.skipped,
      seenr_status: e.seenr_status,
      plex_status: e.plex_status,
      error: e.error,
      payload: e.payload,
    })
    if (e.ok) g.okCount += 1
    else if (e.skipped) g.skippedCount += 1
  }

  return [...groups.values()]
}
