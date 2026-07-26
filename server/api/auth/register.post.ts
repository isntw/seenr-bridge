import { hashPassword, setSession } from '../../utils/auth'
import { countUsers, createUser } from '../../utils/db'
import type { AuthStatus } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<AuthStatus> => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')

  if (countUsers() > 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Registration is closed — an account already exists.',
    })
  }
  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a username and password.' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters.' })
  }

  const user = createUser(username, hashPassword(password))
  setSession(event, user.id)
  return { authenticated: true, username: user.username, needsSetup: false }
})
