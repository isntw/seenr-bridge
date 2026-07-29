# PWA Shell and Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bridge installable to a phone home screen, correctly coloured in system chrome, clear of the notch, and unbroken at 390px.

**Architecture:** A static web app manifest plus committed PNG icons, a head-config block in `nuxt.config.ts`, a service worker with no `fetch` handler registered from a client-only plugin, and safe-area padding in the one shared layout. No new runtime dependencies and no build-time image generation.

**Tech Stack:** Nuxt 4 (`ssr: false`, prerendered routes), Nuxt UI v4, Tailwind CSS v4, Vitest 4, macOS `qlmanage` for one-off icon rasterisation.

**Spec:** `docs/superpowers/specs/2026-07-29-pwa-mobile-design.md`

**Branch:** `feat/pwa-mobile` (already created, spec already committed)

## Global Constraints

- **No new runtime or dev dependencies.** `package.json` and `package-lock.json` must be byte-identical at the end of the branch. Icon rasterisation is one-off and local; the PNGs are committed artefacts.
- **No `@vite-pwa/nuxt`**, no Workbox, no offline caching, no precaching.
- **The service worker must never have a `fetch` handler.** A worker that cannot intercept requests cannot serve a stale build — load-bearing in this repo, which prerenders one `index.html` per route.
- **No auth changes.** The bridge stays single-account. No additions to `PUBLIC_API_PATHS`.
- **No in-app install button.** Browser-native "Add to Home Screen" only; install onboarding belongs to the later push-notification work.
- **Theme colours are exactly `#0a0e16`** (matches `html, body` in `app/assets/css/main.css`). Gradient is `#8b5cf6` → `#c026d3`.
- **Tailwind arbitrary values containing `calc()` must use `_` for spaces around `+`.** `calc(0.75rem+env(...))` is invalid CSS and silently yields no padding; it must be written `calc(0.75rem_+_env(...))`.
- **`server/utils/*` uses explicit relative imports, never Nitro auto-imports** (existing repo rule; no `server/utils` file is touched here, but do not break it).
- **One version bump for the whole branch**, at the end: `shared/version.ts` → `2.6.0` plus a matching `## 2.6.0` section in `CHANGELOG.md`. The PR check fails without both.
- **Never commit to `main`.** All work on `feat/pwa-mobile`, merged via PR.
- **Never wait on `nuxt dev` with a bare `sleep`.** Cold start time varies and a short sleep produces false failures. Every task that starts the dev server uses this readiness loop, which is why `/api/health` (public, see `PUBLIC_API_PATHS`) is polled rather than a page:

  ```bash
  npm run dev >/tmp/pwa-dev.log 2>&1 &
  for _ in $(seq 60); do curl -sf http://localhost:8687/api/health >/dev/null && break; sleep 1; done
  ```

  Kill it with `kill %1` when done. If the loop times out, read `/tmp/pwa-dev.log` — do not proceed and do not report a failure of the thing being tested.

---

### Task 1: Icon set and favicon replacement

Produces the four PNGs and the new vector favicon that every later task references by path.

**Files:**
- Create: `tools/icons/icon.svg` (rounded source)
- Create: `tools/icons/icon-square.svg` (full-bleed source)
- Create: `tools/icons/generate.py` (renders and masks the PNGs; documents how they were made)
- Create: `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/apple-touch-icon.png`
- Replace: `public/favicon.svg` (currently 27KB of base64 PNG wrapped in SVG)

**Interfaces:**
- Consumes: nothing.
- Produces: the exact public paths `/favicon.svg`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`, `/apple-touch-icon.png`. Task 2's manifest and Task 3's head config both hardcode these.

Two sources, not four, because the letterform at `font-size="300"` sits within a radius of ~139px of centre in a 512px box, and Android's maskable safe circle allows 204.8px — so the full-bleed square serves as both the maskable icon and the `apple-touch-icon`. Rounded corners are deliberately absent from the square variant: iOS and Android each apply their own mask, and a pre-rounded source gets double-rounded.

- [ ] **Step 1: Create the rounded icon source**

`tools/icons/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#c026d3"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <text x="256" y="256" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="300" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">S</text>
</svg>
```

- [ ] **Step 2: Create the full-bleed square source**

`tools/icons/icon-square.svg` — identical but with no `rx`, so the gradient reaches every edge:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#c026d3"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <text x="256" y="256" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="300" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">S</text>
</svg>
```

- [ ] **Step 3: Create the generator script**

`tools/icons/generate.py`. Not run by the build — the PNGs are committed artefacts.

**`qlmanage` alone cannot produce the rounded icons.** It is a QuickLook thumbnailer, and it flattens an SVG's transparent background onto opaque white — so rendering `icon.svg` directly yields a white square with a rounded gradient inside, which looks broken on any dark surface. The rounded PNGs are therefore rasterised **full-bleed from `icon-square.svg`** and given an antialiased rounded-rect alpha channel in Pillow. The corner radius is read out of `icon.svg` rather than duplicated, so the two cannot drift.

Pillow is **not** a project dependency and must not be added to `package.json`; it is installed into a throwaway venv, exactly as `qlmanage` is a local tool rather than a dependency.

```python
#!/usr/bin/env python3
"""Regenerates the committed PWA icons from the SVG sources.

Needs macOS (qlmanage) and Pillow, neither of which is a project dependency:

    python3 -m venv /tmp/icons-venv
    /tmp/icons-venv/bin/pip install pillow
    /tmp/icons-venv/bin/python tools/icons/generate.py
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent / 'public'
SQUARE = HERE / 'icon-square.svg'
ROUNDED = HERE / 'icon.svg'
VIEWBOX = 512
# Single source of truth for the corner radius: whatever icon.svg draws.
RX = float(re.search(r'rx="([\d.]+)"', ROUNDED.read_text()).group(1))


def rasterise(svg: Path, size: int) -> Image.Image:
    """qlmanage writes <name>.png beside the source; render, load, clean up."""
    subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', str(HERE), str(svg)],
                   check=True, capture_output=True)
    tmp = HERE / f'{svg.name}.png'
    im = Image.open(tmp).convert('RGBA')
    im.load()
    tmp.unlink()
    if im.size != (size, size):
        sys.exit(f'qlmanage produced {im.size} for {svg.name}, wanted {size}x{size}')
    return im


def round_corners(im: Image.Image) -> Image.Image:
    size = im.width
    ss = 4  # supersample the mask so its edge is antialiased, not jagged
    mask = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * ss - 1, size * ss - 1],
        radius=RX / VIEWBOX * size * ss, fill=255)
    im.putalpha(mask.resize((size, size), Image.LANCZOS))
    return im


def write(im: Image.Image, name: str) -> None:
    path = PUBLIC / name
    im.save(path, optimize=True)
    print(f'  public/{name:<24} {path.stat().st_size:>7} bytes  {im.width}x{im.height}'
          f'  mode={im.mode}')


print('writing:')
for size in (192, 512):
    write(round_corners(rasterise(SQUARE, size)), f'icon-{size}.png')
# Full-bleed and deliberately opaque: iOS and Android apply their own mask, so
# these carry no alpha channel at all.
write(rasterise(SQUARE, 512).convert('RGB'), 'icon-maskable-512.png')
write(rasterise(SQUARE, 180).convert('RGB'), 'apple-touch-icon.png')
shutil.copy(ROUNDED, PUBLIC / 'favicon.svg')
print(f'  public/{"favicon.svg":<24} {(PUBLIC / "favicon.svg").stat().st_size:>7} bytes')
```

- [ ] **Step 4: Run the generator**

```bash
python3 -m venv /tmp/icons-venv
/tmp/icons-venv/bin/pip -q install pillow
/tmp/icons-venv/bin/python tools/icons/generate.py
```

Expected: five lines. `icon-192.png` and `icon-512.png` report `mode=RGBA`; `icon-maskable-512.png` and `apple-touch-icon.png` report `mode=RGB`.

- [ ] **Step 5: Verify every PNG has the exact expected dimensions**

```bash
for f in icon-192.png:192 icon-512.png:512 icon-maskable-512.png:512 apple-touch-icon.png:180; do
  p=public/${f%:*}; want=${f#*:}
  w=$(sips -g pixelWidth "$p" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$p" | awk '/pixelHeight/{print $2}')
  [ "$w" = "$want" ] && [ "$h" = "$want" ] && r=OK || r=WRONG
  printf '%-34s %sx%s want %sx%s  %s\n' "$p" "$w" "$h" "$want" "$want" "$r"
done
```

Expected: four lines, all `OK`. The generator already exits non-zero on a size mismatch, but check anyway — a wrong-sized icon makes an install look broken rather than fail outright.

- [ ] **Step 5b: Verify corner transparency**

This is the check whose absence let a broken icon ship once already: dimensions and file size were both correct while the corners were opaque white. Assert the alpha channel directly.

```bash
/tmp/icons-venv/bin/python - <<'PY'
from PIL import Image
want = {'icon-192.png': 0, 'icon-512.png': 0,
        'icon-maskable-512.png': 255, 'apple-touch-icon.png': 255}
for name, expect in want.items():
    im = Image.open(f'public/{name}').convert('RGBA')
    got = im.getpixel((0, 0))[3]
    print(f'{name:<24} corner alpha={got:<4} want={expect:<4} '
          f'{"OK" if got == expect else "WRONG"}')
PY
```

Expected: four lines, all `OK`. The two rounded icons must be fully transparent at the corner (`alpha=0`); the two full-bleed icons must be fully opaque (`alpha=255`).

- [ ] **Step 6: Confirm the favicon shrank and is real vector**

```bash
ls -l public/favicon.svg && grep -c "base64" public/favicon.svg || true
```

Expected: well under 1KB, and `grep -c base64` prints `0`. The old file was 27KB with embedded base64 rasters.

- [ ] **Step 7: Commit**

```bash
git add tools/icons public/favicon.svg public/icon-192.png public/icon-512.png \
        public/icon-maskable-512.png public/apple-touch-icon.png
git commit -m "feat(pwa): gradient-S app icons, replacing the raster favicon

The old favicon.svg was 27KB of base64 PNG wrapped in SVG. The new mark is
real vector matching the sidebar badge, so the tab and home screen agree.
Square variants carry no rounded corners because iOS and Android each apply
their own mask."
```

---

### Task 2: Web app manifest, with a regression test

**Files:**
- Create: `public/manifest.webmanifest`
- Test: `tests/pwa.spec.ts`

**Interfaces:**
- Consumes: the icon paths from Task 1.
- Produces: `/manifest.webmanifest` with `start_url` `/dashboard`. Task 3 links it.

`start_url` is `/dashboard`, not `/`: `app/pages/index.vue` calls `navigateTo('/dashboard', { replace: true })`, so starting at `/` costs a redirect on every cold launch, and `/dashboard` is already in `nitro.prerender.routes`.

The test earns its place by guarding this repo's documented blank-page trap — a `start_url` that isn't prerendered launches the PWA into an empty shell that still returns HTTP 200, so nothing else would catch it.

- [ ] **Step 1: Write the failing test**

`tests/pwa.spec.ts`. Note the explicit interfaces: `tsconfig.test.json` runs under `strict`, so a bare `JSON.parse` result would make every property access an implicit `any` and fail `npm run typecheck:tests`.

```ts
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

  // A start_url nitro does not prerender launches into a blank shell that still
  // returns 200 — see the prerender comment in nuxt.config.ts.
  it('starts on a route nitro prerenders', () => {
    const routes = read('nuxt.config.ts').match(/prerender:\s*\{\s*routes:\s*\[([^\]]*)\]/)?.[1]
    expect(routes).toBeDefined()
    expect(routes).toContain(`'${manifest.start_url}'`)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/pwa.spec.ts
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../public/manifest.webmanifest'`.

- [ ] **Step 3: Create the manifest**

`public/manifest.webmanifest`:

```json
{
  "name": "Seenr Bridge",
  "short_name": "Seenr Bridge",
  "description": "Tautulli to seenr scrobbling that gets episodes right, for every Plex user.",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0a0e16",
  "theme_color": "#0a0e16",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/pwa.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm the whole suite and typecheck still pass**

```bash
npm test && npm run typecheck
```

Expected: 211 tests passing across 8 files (206 existing + 5 new), typecheck clean with no `WARN Duplicated imports`. NOTE: CLAUDE.md claims "90 tests across 6 files" and is stale — it predates `plex.spec.ts` (35 tests). Trust the runner, not the doc.

- [ ] **Step 6: Commit**

```bash
git add public/manifest.webmanifest tests/pwa.spec.ts
git commit -m "feat(pwa): web app manifest, with icon and prerender guards

start_url is /dashboard rather than / because index.vue immediately
redirects there, so / would cost a navigation on every cold launch. The
test asserts start_url stays inside nitro.prerender.routes: an
unprerendered route serves a blank shell with a 200, which no HTTP check
would catch."
```

---

### Task 3: Head configuration

**Files:**
- Modify: `nuxt.config.ts` (the `app.head` block, currently lines 6-12)

**Interfaces:**
- Consumes: `/manifest.webmanifest` (Task 2), `/apple-touch-icon.png` (Task 1).
- Produces: the `viewport-fit=cover` viewport that makes Task 5's `env(safe-area-inset-*)` resolve to non-zero.

- [ ] **Step 1: Replace the `app.head` block**

In `nuxt.config.ts`, replace:

```ts
  app: {
    head: {
      title: 'Seenr Bridge',
      htmlAttrs: { lang: 'en' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
```

with:

```ts
  app: {
    head: {
      title: 'Seenr Bridge',
      htmlAttrs: { lang: 'en' },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        // iOS does not reliably take home-screen icons from the manifest.
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      meta: [
        // Nuxt's default viewport omits viewport-fit, and without it every
        // env(safe-area-inset-*) in the layout resolves to 0px.
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0a0e16' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Seenr Bridge' },
      ],
    },
  },
```

- [ ] **Step 2: Verify the viewport is overridden rather than duplicated**

```bash
npm run dev >/tmp/pwa-dev.log 2>&1 &
for _ in $(seq 60); do curl -sf http://localhost:8687/api/health >/dev/null && break; sleep 1; done
curl -s http://localhost:8687/login | grep -o '<meta name="viewport"[^>]*>'
```

Expected: exactly **one** viewport meta, containing `viewport-fit=cover`. Two lines means unhead did not dedupe and the default is still winning — fix before continuing, because Task 5 depends on this.

- [ ] **Step 3: Verify the manifest and icons are reachable and unauthenticated**

```bash
for p in /manifest.webmanifest /favicon.svg /icon-192.png /icon-512.png \
         /icon-maskable-512.png /apple-touch-icon.png; do
  printf "%-26s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:8687$p)"
done
kill %1
```

Expected: every path `200`. `/manifest.webmanifest` should report `application/manifest+json`. All are non-`/api/` paths, so `requiresAuth()` early-returns and none require a session — confirm no `401`.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add nuxt.config.ts
git commit -m "feat(pwa): manifest, theme-color, and a viewport-fit viewport

viewport-fit=cover is load-bearing rather than cosmetic: Nuxt's default
viewport omits it, and without it env(safe-area-inset-*) is always 0px,
so notch padding silently does nothing."
```

---

### Task 4: Service worker and registration

**Files:**
- Create: `public/sw.js`
- Create: `app/plugins/pwa.client.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a registered service worker at scope `/`. The later push work attaches `push` and `notificationclick` handlers to this file.

- [ ] **Step 1: Create the service worker**

`public/sw.js`:

```js
// No fetch handler on purpose — caching a live dashboard would serve stale data.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
```

- [ ] **Step 2: Create the registration plugin**

`app/plugins/pwa.client.ts`. The `isSecureContext` guard is not defensive noise: on a plain-http LAN address registration always throws, and that is the expected state today, so it must not log an error.

```ts
export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  // Registration requires a secure context; over plain http it always throws,
  // which is the expected state on a LAN address rather than a failure.
  if (!window.isSecureContext) return

  navigator.serviceWorker.register('/sw.js').catch((e) => {
    console.warn('[pwa] service worker registration failed', e)
  })
})
```

- [ ] **Step 3: Verify the worker is served and typecheck passes**

```bash
npm run dev >/tmp/pwa-dev.log 2>&1 &
for _ in $(seq 60); do curl -sf http://localhost:8687/api/health >/dev/null && break; sleep 1; done
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:8687/sw.js
curl -s http://localhost:8687/sw.js
kill %1
npm run typecheck
```

Expected: `200` with a JavaScript content type, the two-listener body echoed back, and a clean typecheck.

- [ ] **Step 4: Confirm there is no `fetch` handler**

```bash
grep -c "addEventListener('fetch'" public/sw.js || true
```

Expected: `0`. This is a hard constraint, not a preference — assert it rather than assume it.

- [ ] **Step 5: Commit**

```bash
git add public/sw.js app/plugins/pwa.client.ts
git commit -m "feat(pwa): minimal service worker, no fetch handler

Exists to make the app installable and to be the attach point for push
handlers later. Having no fetch handler is the point: a worker that cannot
intercept requests cannot serve a stale prerendered build."
```

---

### Task 5: Safe-area insets in the layout

**Files:**
- Modify: `app/layouts/default.vue` (the `<header>`, the `<main>`, and the `USlideover` `:ui` prop)

**Interfaces:**
- Consumes: the `viewport-fit=cover` viewport from Task 3. Without it every `env()` below is `0px` and this task appears to do nothing.
- Produces: nothing other tasks depend on.

Insets are **added to** existing padding, never replacing it, so devices with no inset render exactly as before. `apple-mobile-web-app-status-bar-style: black-translucent` from Task 3 puts content *under* the status bar, so without the header inset the page title renders under the clock.

**The `_` in the `calc()` values is required.** Tailwind converts `_` to a space, and `calc(0.75rem+env(...))` without spaces around `+` is invalid CSS that silently produces no padding.

- [ ] **Step 1: Add the top inset to the header**

In `app/layouts/default.vue`, in the `<header>` class list, replace `py-3` with:

```
pt-[calc(0.75rem_+_env(safe-area-inset-top))] pb-3
```

The full opening tag becomes:

```html
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-default bg-default/80 px-4 pt-[calc(0.75rem_+_env(safe-area-inset-top))] pb-3 backdrop-blur sm:px-6">
```

- [ ] **Step 2: Add the bottom inset to main**

Replace:

```html
      <main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
```

with:

```html
      <main class="mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(1.5rem_+_env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 sm:pb-[calc(2rem_+_env(safe-area-inset-bottom))]">
```

`py-6 sm:py-8` is split into explicit `pt-`/`pb-` pairs so the top padding is unchanged while the bottom gains the inset.

- [ ] **Step 3: Add insets to the mobile drawer**

Replace:

```html
      :ui="{ content: 'bg-rail' }"
```

with:

```html
      :ui="{ content: 'bg-rail pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]' }"
```

The left inset matters in landscape on a notched phone; it is `0px` in portrait. Passing these through `:ui` rather than a CSS override follows the repo's stated preference for using a Nuxt UI component's own API.

- [ ] **Step 4: Verify the classes reached the compiled CSS**

Tailwind only emits arbitrary-value utilities it actually finds in source, so a typo yields no rule at all rather than an error.

```bash
npm run dev >/tmp/pwa-dev.log 2>&1 &
for _ in $(seq 60); do curl -sf http://localhost:8687/api/health >/dev/null && break; sleep 1; done
css=$(curl -s http://localhost:8687/login | grep -o '/_nuxt/[^"]*\.css' | head -1)
curl -s "http://localhost:8687$css" | grep -o 'safe-area-inset-[a-z]*' | sort -u
kill %1
```

Expected: `safe-area-inset-bottom`, `safe-area-inset-left`, and `safe-area-inset-top` all present. In dev the CSS may be served inline or via a different URL — if the grep for the stylesheet path comes up empty, load the page in a browser and inspect the header's computed `padding-top` instead, which must read `calc(0.75rem + env(safe-area-inset-top))`.

- [ ] **Step 5: Confirm no `calc()` lost its spaces**

```bash
grep -o 'calc([^)]*+[^)]*)' app/layouts/default.vue
```

Expected: every match contains `_+_`, never a bare `+`. A bare `+` is invalid CSS and the padding silently disappears.

- [ ] **Step 6: Commit**

```bash
git add app/layouts/default.vue
git commit -m "feat(pwa): respect safe-area insets in the app layout

black-translucent puts content under the iOS status bar, so the sticky
header needs the top inset or the page title sits under the clock. Insets
are added to existing padding, so devices without one render unchanged."
```

---

### Task 6: Mobile layout audit at 390px

**Files:**
- Modify: whichever of `app/pages/settings.vue`, `app/pages/shared.vue`, `app/pages/login.vue`, `app/pages/dashboard.vue`, `app/components/EventRow.vue`, `app/components/ItemPicker.vue`, `app/components/SharedTitleModal.vue` the measurements implicate. **There is no known list up front** — a static scan found no fixed widths, `whitespace-nowrap`, `overflow-x`, or grids wider than 4 columns in any of them.

**Interfaces:**
- Consumes: Tasks 3 and 5 (the layout should be final before measuring).
- Produces: nothing other tasks depend on.

Run against a **throwaway `DATA_DIR`** so the real database is untouched. Registration is open while `countUsers() === 0`, so a fresh directory allows creating a disposable account through the normal flow.

- [ ] **Step 1: Start the app on a disposable database**

```bash
mkdir -p /tmp/pwa-audit
DATA_DIR=/tmp/pwa-audit npm run dev >/tmp/pwa-dev.log 2>&1 &
for _ in $(seq 60); do curl -sf http://localhost:8687/api/health >/dev/null && break; sleep 1; done
curl -s http://localhost:8687/api/auth/status
```

Expected JSON with `"needsSetup":true` — confirming a clean database rather than the real one.

- [ ] **Step 2: Register a throwaway account**

```bash
curl -s -c /tmp/pwa-cookie -X POST http://localhost:8687/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"audit","password":"audit-password-1"}'
```

Expected: `{"authenticated":true,"username":"audit","needsSetup":false}`.

- [ ] **Step 3: Measure horizontal overflow at 390×844 on every route**

Use the Playwright MCP browser. Resize to 390×844, sign in as `audit` / `audit-password-1`, then for each of `/dashboard`, `/shared`, `/settings`, `/login` navigate and evaluate:

```js
() => ({
  route: location.pathname,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  culprits: [...document.querySelectorAll('*')]
    .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .slice(0, 10)
    .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120)),
})
```

Expected: `overflows: false` on all four. `culprits` names the offending elements when it is `true`.

- [ ] **Step 4: Record the findings before changing anything**

Write the four measurements into the task notes, including screenshots. This is the audit result — if all four pass, say so explicitly and skip to Step 6 rather than inventing changes.

- [ ] **Step 5: Fix each overflow, re-measuring after every fix**

For each culprit, prefer the smallest change consistent with the surrounding code: an existing `sm:` breakpoint pattern, `min-w-0` plus `truncate` on a flex child, or `flex-wrap`. Re-run Step 3's evaluation after each fix and confirm `overflows: false` before moving to the next.

Do **not** introduce `overflow-x: auto` on the page body. Per the repo's conventions wide content scrolls inside its own container; the body must never scroll horizontally.

- [ ] **Step 6: Note the coverage gap honestly**

`ItemPicker.vue` and `SharedTitleModal.vue` only render populated once Tautulli is configured, which the throwaway database is not. Record in the task notes that these two were audited **empty only**, and that verifying them populated needs the real instance. Do not report them as verified.

- [ ] **Step 7: Clean up and commit**

```bash
kill %1
rm -rf /tmp/pwa-audit /tmp/pwa-cookie
npm test && npm run typecheck
```

Then commit only if Step 5 actually changed files. Write the real subject from the
measured finding — e.g. `fix(ui): wrap the Settings trigger row at mobile width` —
never a generic "mobile fixes":

```bash
git status --short          # confirm what changed before staging
git add -u
git commit -m "fix(ui): <name the element and the route from Step 4>"
```

If nothing needed fixing, make no commit, and report that all four routes passed
with the measured numbers. A clean audit is a valid result; do not manufacture a
change to justify the task.

---

### Task 7: Production build verification

**Files:** none modified. This is the gate the spec makes mandatory.

**Interfaces:**
- Consumes: everything above.
- Produces: confidence that the shell still boots.

Per CLAUDE.md, a broken SPA shell returns HTTP 200 with a blank page, so an HTTP status check cannot detect it. This task edits nothing but must not be skipped — Task 3 changed `app.head`, which is exactly the surface that breaks it.

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: success, `.output/` written.

- [ ] **Step 2: Confirm every prerendered route still ships an entry script**

```bash
for r in "" dashboard shared settings login; do
  f=".output/public/${r:+$r/}index.html"
  printf "%-44s %s\n" "$f" "$(grep -c 'src="/_nuxt/' "$f" 2>/dev/null || echo MISSING)"
done
```

Expected: every line a count of `1` or more. A `0` or `MISSING` means that page ships blank — the exact failure the CLAUDE.md prerender note describes.

- [ ] **Step 3: Serve the build and check the PWA assets**

```bash
DATA_DIR=/tmp/pwa-build-check npm start >/tmp/pwa-start.log 2>&1 &
for _ in $(seq 60); do curl -sf http://localhost:8687/api/health >/dev/null && break; sleep 1; done
for p in /manifest.webmanifest /sw.js /favicon.svg /icon-192.png /icon-512.png \
         /icon-maskable-512.png /apple-touch-icon.png; do
  printf "%-26s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8687$p)"
done
curl -s http://localhost:8687/dashboard | grep -o '<link rel="manifest"[^>]*>'
kill %1; rm -rf /tmp/pwa-build-check
```

Expected: every asset `200`, and the manifest link present in the served HTML.

- [ ] **Step 4: Record the result**

No commit. Report the two greps' output verbatim — this is the evidence the build is intact, and it must be shown rather than summarised.

---

### Task 8: Version bump and changelog

**Files:**
- Modify: `shared/version.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above being complete.
- Produces: the release. Pushing this to `main` is what makes CI cut the tag.

One bump for the whole branch. `.github/workflows/pr-checks.yml` fails the PR when app code changed without both a `shared/version.ts` bump and a matching `## X.Y.Z` section.

- [ ] **Step 1: Bump the version**

In `shared/version.ts`, change `'2.5.0'` to `'2.6.0'`. Minor, because this adds a user-facing capability without breaking anything.

- [ ] **Step 2: Add the changelog section**

Insert immediately above the existing `## 2.5.0` heading in `CHANGELOG.md`, matching the surrounding style:

```markdown
## 2.6.0

### Added

- **Installable on a phone.** The bridge now ships a web app manifest, so it can
  be added to an iPhone or Android home screen and launches standalone, without
  browser chrome. Requires an HTTPS origin — a plain-http LAN address cannot be
  installed.
- New app icon: a violet-to-fuchsia gradient mark matching the sidebar badge,
  including a maskable variant so Android does not crop the corners. The favicon
  is the same mark, replacing a 27KB embedded raster with real vector.
- A service worker, deliberately with no caching, so the app is installable and
  push notifications have somewhere to attach later.

### Fixed

- The layout now respects display cut-outs. Content no longer sits under the
  status bar or the home indicator when launched from the home screen.
```

- [ ] **Step 3: Verify the PR gate's two conditions agree**

```bash
grep VERSION shared/version.ts
grep -n '^## 2\.6\.0' CHANGELOG.md
```

Expected: version reads `2.6.0`, and the changelog heading exists. A mismatch fails CI.

- [ ] **Step 4: Full check before pushing**

```bash
npm test && npm run typecheck
```

Expected: all green.

- [ ] **Step 5: Commit and push**

```bash
git add shared/version.ts CHANGELOG.md
git commit -m "chore: bump version to 2.6.0"
git push -u origin feat/pwa-mobile
```

- [ ] **Step 6: Open the PR**

```bash
GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}" gh pr create \
  --title "feat(pwa): installable shell, app icons, and safe-area insets" \
  --body "$(cat <<'BODY'
## Summary

First of two pieces making the bridge usable on a phone. This one is the
installable shell; push notifications on stream start are a separate follow-up.

- Web app manifest, `start_url` `/dashboard` (index.vue redirects there, so `/`
  would cost a navigation on every cold launch)
- New gradient-S icon set: 192, 512, maskable 512, apple-touch 180, and a vector
  favicon replacing 27KB of embedded base64 raster
- `viewport-fit=cover` plus safe-area insets, so content clears the notch and the
  home indicator
- A service worker with no `fetch` handler — installability only, no caching

## Deliberately not included

No `@vite-pwa/nuxt`, no offline support, no install button, no new dependencies,
no auth changes.

## Verification

- `npm test` (211 tests) and `npm run typecheck` pass
- Production build checked for `src="/_nuxt/` on every prerendered route, because
  a broken shell returns 200 and an HTTP check cannot catch it
- Manifest, service worker, icons and favicon all serve 200 from the built server,
  and the head links them
- Exactly one `viewport` meta, carrying `viewport-fit=cover`, so the safe-area
  insets resolve non-zero
- All three `env(safe-area-inset-*)` rules confirmed present in the compiled CSS

**Not verified — stated plainly rather than implied:**

- **No 390px layout measurement was taken.** The browser-driven audit was skipped
  by decision. A static scan of `settings.vue`, `ItemPicker.vue`,
  `SharedTitleModal.vue`, `EventRow.vue` and `shared.vue` found no fixed pixel
  widths, no `whitespace-nowrap`, no `overflow-x` and no grids wider than four
  columns, so there is no *known* breakage — but "no known breakage" is not
  "measured and clean". Worth a look in DevTools' device toolbar before merge.
- **The install flow was not exercised.** Installability requires a secure
  context, so it cannot be tested over `http://<lan-ip>:8687`. Needs the
  Cloudflare Tunnel.
- **Safe-area insets were not seen rendering.** They are `0px` on any display
  without a cut-out, so only a real notched device shows their effect.

Design: `docs/superpowers/specs/2026-07-29-pwa-mobile-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Follow-up, not in this plan

Push notifications on stream start. The design decisions are already recorded in the spec's "Follow-up" section — the `play`-trigger webhook branch, why `watched` fires too late, `settings.notify_users`, per-device subscriptions keyed on `user_id`, and `web-push` as the one new dependency.

Also recorded there and **worth raising with the user before the Cloudflare Tunnel goes live**: `/api/webhook/tautulli` is unauthenticated by design, which is safe only while the bridge is LAN-only. Behind a public hostname it accepts forged scrobbles from anyone who finds the domain.
