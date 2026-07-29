import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}
interface Manifest {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
}

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (p: string) => readFileSync(root + p, 'utf8')
const manifest = JSON.parse(read('public/manifest.webmanifest')) as Manifest

describe('web app manifest', () => {
  it('declares what a browser needs to offer installation', () => {
    expect(manifest.name).toBe('Seenr Bridge')
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBeTruthy()
  })

  it('matches the app background so the splash does not flash', () => {
    expect(manifest.background_color).toBe('#0a0e16')
    expect(manifest.theme_color).toBe('#0a0e16')
  })

  it('points every icon at a file that exists', () => {
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      expect(existsSync(root + 'public' + icon.src)).toBe(true)
    }
  })

  it('ships a maskable icon, or Android crops the corners', () => {
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })

  it('starts on a route nitro prerenders', () => {
    const routes = read('nuxt.config.ts').match(/prerender:\s*\{\s*routes:\s*\[([^\]]*)\]/)?.[1]
    expect(routes).toBeDefined()
    expect(routes).toContain(`'${manifest.start_url}'`)
  })
})
