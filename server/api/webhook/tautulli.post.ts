import { processEvent } from '../../utils/pipeline'

export default defineEventHandler(async (event) => {
  const b = (await readBody<Record<string, unknown>>(event).catch(() => ({}) as Record<string, unknown>)) ?? {}

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

  // Respond fast; enrich and forward in the background so Tautulli never
  // waits on the seenr round-trip. Failures are recorded to the events
  // table — that table is this endpoint's error log.
  const work = processEvent({
    action: String(action),
    rating_key: String(rating_key),
    username: String(username),
  }).catch((err) => {
    // processEvent already records its own failures to the events table;
    // reaching this catch means that recording itself threw, so this is
    // the only place left to leave a trace.
    console.error('[webhook/tautulli] processEvent failed', {
      rating_key: String(rating_key),
      username: String(username),
      error: err instanceof Error ? err.message : String(err),
    })
  })

  event.waitUntil(work)

  setResponseStatus(event, 202)
  return { accepted: true }
})
