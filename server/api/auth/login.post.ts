import { verifyPassword, setSession } from '../../utils/auth'
import { getUserByUsername } from '../../utils/db'
import type { AuthStatus } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<AuthStatus> => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')

  const user = getUserByUsername(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw createError({ statusCode: 401, statusMessage: 'Wrong username or password.' })
  }

  setSession(event, user.id)
  return { authenticated: true, username: user.username, needsSetup: false }
})
