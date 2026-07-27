import type { ScrobbleEvent } from '../../shared/types'

// A shared title fans out: `processEvent` delivers to every assigned profile and
// records one `events` row per recipient, so a single watch of a co-watched title
// shows up as N rows on the Dashboard. These group those rows back into the one
// watch they came from.

export interface EventRecipient {
  /** The underlying events-table row id. */
  id: number
  username: string | null
  ok: boolean
  seenr_status: number | null
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
  /** One per profile the watch was forwarded to, in the order the rows arrived. */
  recipients: EventRecipient[]
  /** How many recipients seenr accepted. Can be fewer than `recipients.length`:
   *  each forward is a separate HTTP call and they fail independently. */
  okCount: number
}

/**
 * Collapse fan-out rows into one entry per watch.
 *
 * The key is exact, not a time-window heuristic: `processEvent` computes
 * `const now = Date.now()` **once** and hands the same value to every
 * `deliverToMapping`, so all rows from one watch carry an identical `ts`
 * (see `server/utils/pipeline.ts`). Two different watches landing in the same
 * millisecond would have to also share a `rating_key` and `event` to collide,
 * which one `processEvent` call is the only way to produce.
 *
 * Input is expected newest-first, as `/api/events` returns it; group order
 * follows first appearance, so the output stays newest-first too.
 */
export function groupEvents(events: ScrobbleEvent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>()

  for (const e of events) {
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
      }
      groups.set(key, g)
    }
    g.recipients.push({
      id: e.id,
      username: e.username,
      ok: e.ok,
      seenr_status: e.seenr_status,
      error: e.error,
      payload: e.payload,
    })
    if (e.ok) g.okCount += 1
  }

  return [...groups.values()]
}
