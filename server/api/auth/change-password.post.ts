import { currentUser, hashPassword, verifyPassword, setSessionCookie } from '../../utils/auth'
import { updateUserPassword, deleteUserSessions } from '../../utils/db'

export default defineEventHandler(async (event) => {
  // The auth middleware guarantees a session, so this is a type narrowing
  // rather than a second auth check.
  const user = currentUser(event)!

  const body = await readBody<{ current_password?: string; new_password?: string }>(event)
  const current = String(body?.current_password || '')
  const next = String(body?.new_password || '')

  if (!verifyPassword(current, user.password_hash)) {
    throw createError({ statusCode: 400, statusMessage: 'Current password is wrong.' })
  }
  if (next.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'New password must be at least 8 characters.' })
  }

  updateUserPassword(user.id, hashPassword(next))
  // Sign every device out, then re-issue a session for this one.
  deleteUserSessions(user.id)
  setSessionCookie(event, user.id)
  return { ok: true }
})
