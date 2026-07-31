import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { VERSION } from '../shared/version'

// public/sw.js is plain JS served as-is, so it cannot import shared/version.ts.
// Its SW_VERSION is what Settings reports as the worker actually running on a
// device, and a wrong value there is worse than none — it would say a stale worker
// is current. This test is the only thing keeping the two in step.
describe('sw.js', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8')

  it('declares the same version as shared/version.ts', () => {
    const match = source.match(/const SW_VERSION = '([^']+)'/)

    expect(match, 'SW_VERSION not found in public/sw.js').not.toBeNull()
    expect(match![1]).toBe(VERSION)
  })

  it('still has no fetch handler', () => {
    // A worker that can intercept requests can serve a stale build, and this repo
    // prerenders one index.html per route — see the PWA design doc.
    expect(source).not.toMatch(/addEventListener\(\s*'fetch'/)
  })

  it('answers a version request, which is how Settings reads it', () => {
    expect(source).toMatch(/addEventListener\(\s*'message'/)
    expect(source).toContain('swVersion')
  })
})
