import { currentUser, PUBLIC_API_PATHS } from '../utils/auth'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  // Nitro middleware sees every request, not just /api. Let pages and
  // assets through untouched.
  if (!path.startsWith('/api/')) return

  if (PUBLIC_API_PATHS.has(path)) return

  if (!currentUser(event)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }
})
