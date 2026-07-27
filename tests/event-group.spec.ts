import { describe, it, expect } from 'vitest'
import { groupEvents } from '../app/utils/event-group'
import type { ScrobbleEvent } from '../shared/types'

// A minimal row factory — every test only cares about the handful of fields that
// take part in grouping.
function ev(over: Partial<ScrobbleEvent> = {}): ScrobbleEvent {
  return {
    id: 1,
    ts: 1_000,
    action: 'watched',
    event: 'media.scrobble',
    username: 'alice',
    media_type: 'episode',
    title: 'Ozymandias',
    rating_key: '12345',
    ids: ['tmdb://62161'],
    image: null,
    series_key: null,
    seenr_status: 200,
    ok: true,
    error: null,
    payload: null,
    ...over,
  }
}

describe('groupEvents', () => {
  it('returns nothing for no events', () => {
    expect(groupEvents([])).toEqual([])
  })

  it('leaves a single event as a group of one', () => {
    const out = groupEvents([ev()])
    expect(out).toHaveLength(1)
    expect(out[0]!.recipients.map((r) => r.username)).toEqual(['alice'])
    expect(out[0]!.okCount).toBe(1)
  })

  it('collapses a fan-out — same ts, rating_key and event — into one group', () => {
    const out = groupEvents([
      ev({ id: 3, username: 'carol' }),
      ev({ id: 2, username: 'bob' }),
      ev({ id: 1, username: 'alice' }),
    ])

    expect(out).toHaveLength(1)
    expect(out[0]!.recipients.map((r) => r.username)).toEqual(['carol', 'bob', 'alice'])
    expect(out[0]!.okCount).toBe(3)
  })

  it('keeps per-recipient status, because each forward succeeds or fails on its own', () => {
    const out = groupEvents([
      ev({ id: 1, username: 'alice', ok: true, seenr_status: 200 }),
      ev({ id: 2, username: 'bob', ok: false, seenr_status: 401, error: 'seenr HTTP 401' }),
    ])

    expect(out).toHaveLength(1)
    expect(out[0]!.okCount).toBe(1)
    expect(out[0]!.recipients).toHaveLength(2)
    expect(out[0]!.recipients[1]).toMatchObject({
      username: 'bob',
      ok: false,
      seenr_status: 401,
      error: 'seenr HTTP 401',
    })
  })

  it('does NOT merge different titles that happen to share a timestamp', () => {
    const out = groupEvents([
      ev({ id: 1, rating_key: '111', title: 'A' }),
      ev({ id: 2, rating_key: '222', title: 'B' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('does NOT merge different episodes of one backfill run', () => {
    // backfillSharedTitle stamps one `now` across every episode it replays, so
    // rating_key is the only thing separating them.
    const out = groupEvents([
      ev({ id: 1, rating_key: 'e1', username: 'alice' }),
      ev({ id: 2, rating_key: 'e1', username: 'bob' }),
      ev({ id: 3, rating_key: 'e2', username: 'alice' }),
      ev({ id: 4, rating_key: 'e2', username: 'bob' }),
    ])

    expect(out).toHaveLength(2)
    expect(out.map((g) => g.recipients.length)).toEqual([2, 2])
  })

  it('does NOT merge the same title at different timestamps', () => {
    const out = groupEvents([ev({ id: 2, ts: 2_000 }), ev({ id: 1, ts: 1_000 })])
    expect(out).toHaveLength(2)
  })

  it('does NOT merge different event types', () => {
    const out = groupEvents([
      ev({ id: 1, event: 'media.scrobble', action: 'watched' }),
      ev({ id: 2, event: 'media.play', action: 'play' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('preserves newest-first order from the API', () => {
    const out = groupEvents([
      ev({ id: 3, ts: 3_000, rating_key: 'c' }),
      ev({ id: 2, ts: 2_000, rating_key: 'b' }),
      ev({ id: 1, ts: 1_000, rating_key: 'a' }),
    ])
    expect(out.map((g) => g.ts)).toEqual([3_000, 2_000, 1_000])
  })

  it('carries the shared metadata onto the group', () => {
    const out = groupEvents([ev({ image: '/library/metadata/1/thumb', series_key: 'tvdb://99' })])
    expect(out[0]).toMatchObject({
      title: 'Ozymandias',
      media_type: 'episode',
      rating_key: '12345',
      ids: ['tmdb://62161'],
      image: '/library/metadata/1/thumb',
      series_key: 'tvdb://99',
      action: 'watched',
      event: 'media.scrobble',
    })
  })

  it('treats a null rating_key or event as its own bucket without throwing', () => {
    const out = groupEvents([
      ev({ id: 1, rating_key: null, event: null, username: 'alice' }),
      ev({ id: 2, rating_key: null, event: null, username: 'bob' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.recipients).toHaveLength(2)
  })
})
