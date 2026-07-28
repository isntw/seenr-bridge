import { currentUser, hashPassword, verifyPassword, setSessionCookie } from '../../utils/auth'
import { updateUserPassword, deleteUserSessions } from '../../utils/db'

export default defineEventHandler(async (event) => {
  // The auth middleware guarantees a session; this guard just avoids
  // depending on that invariant with a non-null assertion.
  const user = currentUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }

  const body = await readBody<{ current_password?: string; new_password?: string }>(event)
  const current = String(body?.current_password || '')
  const next = String(body?.new_password || '')

  // An account created by signing in with Plex has no password at all. Setting the
  // first one must not demand a current one it could never have — but changing an
  // existing password still must, or a stolen session becomes a password reset.
  const hasPassword = !!user.password_hash
  if (hasPassword && !verifyPassword(current, user.password_hash)) {
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
