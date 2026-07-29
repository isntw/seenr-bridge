import { describe, it, expect, vi } from 'vitest'

const processEvent = vi.fn(async () => ({ ok: true }))
const handlePlaybackStart = vi.fn(async () => ({ notified: true }))

vi.mock('../server/utils/pipeline', () => ({
  processEvent: (...a: unknown[]) => processEvent(...(a as [])),
  libraryGateReason: () => null,
}))
vi.mock('../server/utils/notify', () => ({
  handlePlaybackStart: (...a: unknown[]) => handlePlaybackStart(...(a as [])),
}))

const { handleIncoming, isNotifyAction } = await import('../server/utils/dispatch')

const ev = (action: string) => ({ action, rating_key: '1', username: 'alice' })

describe('isNotifyAction', () => {
  it('accepts every spelling Tautulli can send', () => {
    for (const a of ['play', 'Play', 'PLAY', 'on_play', 'ON_PLAY']) {
      expect(isNotifyAction(a)).toBe(true)
    }
  })

  it('rejects the scrobbling actions', () => {
    for (const a of ['watched', 'scrobble', 'stop', 'pause', 'resume', 'on_watched']) {
      expect(isNotifyAction(a)).toBe(false)
    }
  })
})

describe('handleIncoming', () => {
  it('routes play to the notifier and never to the pipeline', async () => {
    processEvent.mockClear()
    handlePlaybackStart.mockClear()

    await handleIncoming(ev('play'))

    expect(handlePlaybackStart).toHaveBeenCalledTimes(1)
    expect(processEvent).not.toHaveBeenCalled()
  })

  it('routes watched to the pipeline and never to the notifier', async () => {
    processEvent.mockClear()
    handlePlaybackStart.mockClear()

    await handleIncoming(ev('watched'))

    expect(processEvent).toHaveBeenCalledTimes(1)
    expect(handlePlaybackStart).not.toHaveBeenCalled()
  })

  it('leaves stop, pause and resume on the pipeline', async () => {
    for (const a of ['stop', 'pause', 'resume']) {
      processEvent.mockClear()
      handlePlaybackStart.mockClear()

      await handleIncoming(ev(a))

      expect(processEvent).toHaveBeenCalledTimes(1)
      expect(handlePlaybackStart).not.toHaveBeenCalled()
    }
  })

  it('does not notify on a dry run', async () => {
    handlePlaybackStart.mockClear()

    const r = await handleIncoming(ev('play'), { dryRun: true })

    expect(handlePlaybackStart).not.toHaveBeenCalled()
    expect(r.reason).toContain('Would notify')
  })

  it('passes dryRun and record through to the pipeline', async () => {
    processEvent.mockClear()

    await handleIncoming(ev('watched'), { dryRun: true, record: false })

    expect(processEvent).toHaveBeenCalledWith(ev('watched'), { dryRun: true, record: false })
  })

  it('reports a suppressed notification as skipped, not as success', async () => {
    handlePlaybackStart.mockImplementation(async () => ({
      notified: false,
      reason: 'Not notifying for "alice"',
    }))

    const r = await handleIncoming(ev('play'))

    expect(r.ok).toBe(false)
    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('Not notifying for "alice"')

    handlePlaybackStart.mockImplementation(async () => ({ notified: true }))
  })
})
