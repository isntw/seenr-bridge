import { getSettings, listEvents } from '../../utils/db'
import { notificationFor } from '../../utils/notify'
import { sendToAll, type PushPayload } from '../../utils/push'
import { getMetadata } from '../../utils/tautulli'

const PLAIN: PushPayload = {
  title: 'Seenr Bridge',
  body: 'Notifications are working. This is a test.',
  url: '/dashboard',
  tag: 'seenr-bridge-test',
}

// A test that proved only delivery was actively misleading: it arrived with no
// poster and no Mute button, which is exactly what a broken build looks like. So
// send a real notification for the last thing watched, built by the same function
// the webhook uses, and fall back to the plain payload only when there is nothing
// to build one from.
async function payload(): Promise<PushPayload> {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return PLAIN

  const last = listEvents(25).find((e) => e.rating_key)
  if (!last?.rating_key) return PLAIN

  try {
    const meta = await getMetadata(s.tautulli_url, s.tautulli_apikey, last.rating_key)
    return notificationFor(meta, last.username || 'someone')
  } catch {
    // The item may be gone from Plex, which is no reason to fail the test.
    return PLAIN
  }
}

export default defineEventHandler(async () => {
  const send = await sendToAll(await payload())

  if (!send.sent && !send.failed && !send.pruned) {
    throw createError({ statusCode: 400, statusMessage: 'No devices are subscribed yet' })
  }
  return send
})
