import { currentUser } from '../../utils/auth'
import { addPushSubscription } from '../../utils/db'

interface Body {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
  label?: unknown
}

export default defineEventHandler(async (event) => {
  const user = currentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })

  const b = await readBody<Body>(event)
  const endpoint = typeof b?.endpoint === 'string' ? b.endpoint.trim() : ''
  const p256dh = typeof b?.keys?.p256dh === 'string' ? b.keys.p256dh : ''
  const auth = typeof b?.keys?.auth === 'string' ? b.keys.auth : ''

  if (!endpoint || !p256dh || !auth) {
    throw createError({ statusCode: 400, statusMessage: 'Incomplete push subscription' })
  }
  if (!/^https:\/\//.test(endpoint)) {
    throw createError({ statusCode: 400, statusMessage: 'Push endpoint must be https' })
  }

  const label = typeof b?.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 60) : 'This device'
  addPushSubscription({ user_id: user.id, endpoint, p256dh, auth, label })
  return { ok: true }
})
