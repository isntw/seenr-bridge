import { describe, it, expect } from 'vitest'
import { safeRedirect } from '../app/utils/safe-redirect'

describe('safeRedirect', () => {
  it('keeps a same-origin path with its query', () => {
    expect(safeRedirect('/dashboard?watch=123&user=alice')).toBe('/dashboard?watch=123&user=alice')
    expect(safeRedirect('/shared')).toBe('/shared')
  })

  it('rejects an absolute url', () => {
    expect(safeRedirect('https://evil.example/x')).toBe('/dashboard')
    expect(safeRedirect('http://evil.example')).toBe('/dashboard')
  })

  it('rejects a protocol-relative url, which browsers resolve as external', () => {
    expect(safeRedirect('//evil.example/x')).toBe('/dashboard')
  })

  it('rejects a redirect back to login, which would loop', () => {
    expect(safeRedirect('/login')).toBe('/dashboard')
    expect(safeRedirect('/login?redirect=%2Flogin')).toBe('/dashboard')
  })

  it('rejects anything that is not a string', () => {
    expect(safeRedirect(undefined)).toBe('/dashboard')
    expect(safeRedirect(null)).toBe('/dashboard')
    expect(safeRedirect(['/a', '/b'])).toBe('/dashboard')
    expect(safeRedirect(42)).toBe('/dashboard')
  })

  it('rejects a scheme-bearing string that does not start with a slash', () => {
    expect(safeRedirect('javascript:alert(1)')).toBe('/dashboard')
    expect(safeRedirect('dashboard')).toBe('/dashboard')
  })
})
