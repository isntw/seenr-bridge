import { currentUser } from '../../utils/auth'
import { countUsers } from '../../utils/db'
import type { AuthStatus } from '../../../shared/types'

export default defineEventHandler((event): AuthStatus => {
  const user = currentUser(event)
  return {
    authenticated: !!user,
    username: user?.username ?? null,
    needsSetup: countUsers() === 0,
  }
})
