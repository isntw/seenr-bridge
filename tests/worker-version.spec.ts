import { describe, it, expect } from 'vitest'
import { workerNeedsUpdate } from '../app/utils/worker-version'

describe('workerNeedsUpdate', () => {
  it('leaves a matching worker alone, so a normal launch costs no request', () => {
    expect(workerNeedsUpdate('2.6.5', '2.6.5')).toBe(false)
  })

  it('replaces a worker from an older release', () => {
    expect(workerNeedsUpdate('2.6.4', '2.6.5')).toBe(true)
  })

  // The case that caused this: a worker predating the version handler never answers,
  // and treating silence as "probably fine" is what left it running for hours.
  it('replaces a worker that did not answer at all', () => {
    expect(workerNeedsUpdate('', '2.6.5')).toBe(true)
  })

  it('replaces a worker somehow ahead of the app, rather than trusting it', () => {
    expect(workerNeedsUpdate('2.7.0', '2.6.5')).toBe(true)
  })
})
