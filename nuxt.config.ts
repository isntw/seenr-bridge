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
    // better-sqlite3 ships a native .node binding. Bundling it breaks the
    // require path at runtime, so keep it external and resolved from disk.
    externals: { external: ['better-sqlite3'] },
  },

  typescript: { strict: true },
})
