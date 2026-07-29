import webpush from 'web-push'
import {
  deletePushSubscription,
  getVapidKeys,
  listPushSubscriptions,
  markPushFailed,
  markPushOk,
  setVapidKeys,
  type PushSubscriptionRow,
} from './db'

/** The `sub` in VAPID's JWT. plex.tv-style services want a real contact; push
 *  services only require the scheme, and a self-hosted bridge has no address to
 *  give, so this is a stable placeholder rather than a configurable. */
const VAPID_SUBJECT = 'mailto:seenr-bridge@localhost'

export interface PushPayload {
  title: string
  body: string
  /** Where notificationclick should navigate. */
  url: string
  /** Collapses repeats of the same session instead of stacking them. */
  tag: string
}

/** Read-or-create the VAPID pair. Generated on first use rather than at install
 *  so an install that never enables notifications never grows keys. */
export function ensureVapidKeys(): { publicKey: string; privateKey: string } {
  const existing = getVapidKeys()
  if (existing.publicKey && existing.privateKey) return existing

  const fresh = webpush.generateVAPIDKeys()
  setVapidKeys(fresh.publicKey, fresh.privateKey)
  return fresh
}

export function vapidPublicKey(): string {
  return ensureVapidKeys().publicKey
}

export interface SendResult {
  sent: number
  failed: number
  pruned: number
}

/** Deliver to every stored subscription.
 *
 *  A 404 or 410 from the push service means the endpoint is permanently gone —
 *  the browser was uninstalled, or the user revoked permission. That row is
 *  deleted rather than retried, which is the documented Web Push contract and
 *  the only thing stopping dead endpoints accumulating forever. Any other error
 *  is transient and only increments fail_count. */
export async function sendToAll(payload: PushPayload): Promise<SendResult> {
  const subs = listPushSubscriptions()
  if (!subs.length) return { sent: 0, failed: 0, pruned: 0 }

  const { publicKey, privateKey } = ensureVapidKeys()
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey)

  const body = JSON.stringify(payload)
  let sent = 0
  let failed = 0
  let pruned = 0

  await Promise.all(
    subs.map(async (s: PushSubscriptionRow) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
        markPushOk(s.id)
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          deletePushSubscription(s.id)
          pruned++
        } else {
          markPushFailed(s.id)
          failed++
        }
      }
    }),
  )

  return { sent, failed, pruned }
}
