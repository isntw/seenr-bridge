import { getWebhookSecret } from '../../utils/db'
import { WEBHOOK_SECRET_HEADER } from '../../utils/auth'

export default defineEventHandler(() => ({
  header: WEBHOOK_SECRET_HEADER,
  secret: getWebhookSecret(),
}))
