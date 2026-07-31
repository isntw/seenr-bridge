import type { ActivitySession } from '../../shared/types'

export interface FocusRequest {
  rating_key: string
  username: string
}

/**
 * Which session a `?watch=&user=` deep link should open, or null for none.
 *
 * `ready` is the load-bearing argument. The dialog seeds its selection from the
 * shares and pending watches at open time, so opening before those have arrived
 * shows an already-shared title as unselected — and saving from there strips the
 * share. Only the notification path can reach that; a Dashboard click happens
 * seconds after load.
 */
export function focusTarget(
  focus: FocusRequest | null | undefined,
  sessions: ActivitySession[],
  ready: boolean,
  open: boolean,
): ActivitySession | null {
  if (!focus || !ready || open) return null

  return (
    sessions.find(
      (s) =>
        s.rating_key === focus.rating_key &&
        s.username.toLowerCase() === focus.username.toLowerCase(),
    ) ?? null
  )
}
