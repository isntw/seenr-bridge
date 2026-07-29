import { normalizeAction } from './scrobble'
import { processEvent } from './pipeline'
import { handlePlaybackStart } from './notify'
import type { IncomingEvent, ProcessResult } from '../../shared/types'

const NOTIFY_ACTIONS = new Set(['play'])

export function isNotifyAction(action: string): boolean {
  return NOTIFY_ACTIONS.has(normalizeAction(action))
}

export async function handleIncoming(
  input: IncomingEvent,
  opts: { dryRun?: boolean; record?: boolean } = {},
): Promise<ProcessResult> {
  if (!isNotifyAction(input.action)) return processEvent(input, opts)

  if (opts.dryRun) {
    return { ok: true, skipped: true, reason: 'Would notify — no scrobble is sent for a play' }
  }

  const r = await handlePlaybackStart(input)
  return { ok: r.notified, skipped: !r.notified, reason: r.reason }
}
