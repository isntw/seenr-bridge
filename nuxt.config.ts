export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],

  // Login-gated LAN admin panel: SSR buys nothing and complicates auth state.
  ssr: false,

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

  devServer: { port: 8687 },

  css: ['~/assets/css/main.css'],

  colorMode: { preference: 'dark' },

  // @nuxt/icon's client bundle ships only @nuxt/ui's own internal icons — the app's
  // own `i-lucide-*` names are not in it, and are otherwise fetched at runtime from
  // /api/_nuxt_icon/<collection> on every cold load. `scan: true` inlines the icons
  // referenced in source instead, so they paint with no round-trip and without
  // depending on that endpoint being reachable (requiresAuth() exempts it
  // explicitly for exactly this reason — see ICON_PATH_PREFIX in server/utils/auth.ts).
  // Icon names built dynamically can't be scanned: list those in clientBundle.icons.
  icon: {
    clientBundle: { scan: true },
  },

  nitro: {
    preset: 'node-server',

    // ssr:false means Nitro serves an SPA shell, but its built-in shell template
    // builds EMPTY in Nuxt 4.5.0 — the served HTML then has no entry script, so
    // the app never hydrates and every page is blank. Prerendering each page route
    // emits a real index.html per route with the module script injected.
    // NOTE: adding a new page means adding its path here, or that page ships blank.
    prerender: { routes: ['/', '/dashboard', '/shared', '/settings', '/login'] },
    // better-sqlite3 ships a native .node binding. Bundling it breaks the
    // require path at runtime, so keep it external and resolved from disk.
    externals: { external: ['better-sqlite3'] },
  },

  typescript: {
    strict: true,

    // Without this, a component name that doesn't exist (e.g. UButtonGroup, which
    // Nuxt UI v4 renamed to UFieldGroup) passes `npm run typecheck`, passes
    // `nuxt build`, and then renders NOTHING at runtime — prerendering an
    // ssr:false shell never mounts a component, so nothing warns either. This is
    // the only static check that catches it.
    tsConfig: { vueCompilerOptions: { checkUnknownComponents: true } },
  },
})
