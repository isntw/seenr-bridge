import { currentUser, requiresAuth } from '../utils/auth'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  // Nitro middleware sees every request, not just /api. requiresAuth()
  // is what decides pages/assets and public /api paths pass through.
  if (!requiresAuth(path)) return

  if (!currentUser(event)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }
})
