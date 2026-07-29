import type { H3Event } from 'h3'
import { processEvent } from '../../utils/pipeline'
import { handlePlaybackStart } from '../../utils/notify'

// Matches the legacy Express body-parser limit — generous for a payload of
// three short fields (rating_key, username, action). This is the one
// unauthenticated endpoint (most likely to sit behind a public reverse
// proxy, which is exactly what the bridge_url setting exists for), so it
// must not buffer an unbounded body into memory before validating anything.
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

// h3's readBody() has no size cap of its own. A Content-Length over the cap
// is rejected before any bytes are read; a byte-counting listener on the raw
// request also guards the Transfer-Encoding: chunked case, where there is no
// Content-Length to check up front. Runs alongside (not instead of) the
// normal readBody() call below — Node broadcasts request 'data' events to
// every attached listener, so this doesn't interfere with h3's own parsing.
function rejectIfBodyTooLarge(event: H3Event): Promise<void> {
  const declared = Number(getRequestHeader(event, 'content-length'))
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) {
    return Promise.reject(createError({ statusCode: 413, statusMessage: 'Payload too large' }))
  }

  return new Promise((resolve, reject) => {
    const req = event.node.req
    let total = 0

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_WEBHOOK_BODY_BYTES) {
        cleanup()
        req.destroy(new Error('payload too large'))
        reject(createError({ statusCode: 413, statusMessage: 'Payload too large' }))
      }
    }
    const onEnd = () => {
      cleanup()
      resolve()
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

export default defineEventHandler(async (event) => {
  // Start reading the body immediately (readBody caches its result on the
  // event), but don't look at it until the size guard has cleared — the
  // .catch() here means a destroyed connection never surfaces as an
  // unhandled rejection.
  const parsed = readBody<Record<string, unknown>>(event).catch(() => ({}) as Record<string, unknown>)
  await rejectIfBodyTooLarge(event)
  const b = (await parsed) ?? {}

  const rating_key = b.rating_key ?? b.ratingKey
  const username = b.username ?? b.user
  const action = b.action ?? b.notify_action ?? 'watched'

  if (!rating_key || !username) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing rating_key or username in webhook payload',
      data: { received: b },
    })
  }

  const incoming = {
    action: String(action),
    rating_key: String(rating_key),
    username: String(username),
  }

  // `play` notifies and does NOT scrobble. processEvent() does not branch on
  // action, so routing play through it would forward media.play to seenr, consume
  // and delete the pending_watches rows at play time — destroying the
  // watch-together window the notification exists to open — and mark co-watchers'
  // Plex copies watched at 0% progress. stop/pause/resume keep their existing
  // route so no configured notifier changes meaning.
  const isPlaybackStart = incoming.action.toLowerCase().replace(/^on_/, '') === 'play'

  // Respond fast; enrich and forward in the background so Tautulli never
  // waits on the seenr round-trip. Failures are recorded to the events
  // table — that table is this endpoint's error log.
  const work = (
    isPlaybackStart ? handlePlaybackStart(incoming) : processEvent(incoming)
  ).catch((err) => {
    // processEvent already records its own failures to the events table;
    // reaching this catch means that recording itself threw, so this is
    // the only place left to leave a trace. handlePlaybackStart writes no rows
    // at all, so for a play event this log is the only trace there will be.
    console.error('[webhook/tautulli] processing failed', {
      action: incoming.action,
      rating_key: incoming.rating_key,
      username: incoming.username,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  event.waitUntil(work)

  setResponseStatus(event, 202)
  return { accepted: true }
})
