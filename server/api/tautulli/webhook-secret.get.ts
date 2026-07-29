import { getWebhookSecret } from '../../utils/db'
import { WEBHOOK_SECRET_HEADER } from '../../utils/auth'

// Read-only and authenticated. Needed because the manual setup panel must show the
// header Tautulli has to send, or a hand-configured notifier gets a 401.
export default defineEventHandler(() => ({
  header: WEBHOOK_SECRET_HEADER,
  secret: getWebhookSecret(),
}))
