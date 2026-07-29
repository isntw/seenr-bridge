import {
  currentUser,
  requiresAuth,
  requiresWebhookSecret,
  WEBHOOK_SECRET_HEADER,
  webhookSecretValid,
} from '../utils/auth'
import { getWebhookSecret } from '../utils/db'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  // Nitro middleware sees every request, not just /api. requiresAuth()
  // is what decides pages/assets and public /api paths pass through.
  if (requiresWebhookSecret(path)) {
    if (!webhookSecretValid(getRequestHeader(event, WEBHOOK_SECRET_HEADER), getWebhookSecret())) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid or missing webhook secret' })
    }
    return
  }

  if (!requiresAuth(path)) return

  if (!currentUser(event)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }
})
