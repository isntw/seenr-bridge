export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],

  // Login-gated LAN admin panel: SSR buys nothing and complicates auth state.
  ssr: false,

  app: {
    head: {
      title: 'Seenr Bridge',
      htmlAttrs: { lang: 'en' },
    },
  },

  devServer: { port: 8687 },

  css: ['~/assets/css/main.css'],

  colorMode: { preference: 'dark' },

  nitro: {
    preset: 'node-server',

    // ssr:false means Nitro serves an SPA shell, but its built-in shell template
    // builds EMPTY in Nuxt 4.5.0 — the served HTML then has no entry script, so
    // the app never hydrates and every page is blank. Prerendering each page route
    // emits a real index.html per route with the module script injected.
    // NOTE: adding a new page means adding its path here, or that page ships blank.
    prerender: { routes: ['/', '/dashboard', '/settings', '/login'] },
    // better-sqlite3 ships a native .node binding. Bundling it breaks the
    // require path at runtime, so keep it external and resolved from disk.
    externals: { external: ['better-sqlite3'] },
  },

  typescript: { strict: true },
})
