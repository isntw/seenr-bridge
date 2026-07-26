// A data fetch (e.g. settings.vue's top-level `await store.fetch()`) can
// 401 while the auth store still thinks the session is good — the session
// row can vanish server-side (change-password signs out every device)
// without the client ever navigating, so app/middleware/auth.global.ts never
// gets a chance to catch it. Without this, that 401 surfaces as an
// unhandled rejection and a blank/error page instead of a bounce to /login.
//
// Nuxt's auto-imported `$fetch` is a singleton captured once, as a frozen
// module-scope binding, by whichever file imports it first (see the
// generated #build/fetch module) — reassigning globalThis.$fetch afterwards
// does not change what already-imported call sites resolved to, so a plugin
// that tries to wrap and replace it (the usual recipe for this) silently
// misses most of the app's requests. ofetch's HTTP layer, however, always
// re-reads globalThis.fetch (the native Fetch API) fresh on every call —
// patching that instead reliably catches every request regardless of which
// $fetch binding made it.
export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuthStore()
  const nativeFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await nativeFetch(input, init)

    if (response.status === 401) {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(requestUrl, location.origin).pathname

      // Auth endpoints (login/register/status/logout/change-password) report
      // their own 401s — e.g. a wrong password on /api/auth/login. Redirecting
      // on those too would clobber the login form's inline error and could
      // loop back through here via /api/auth/status. Only react to our own
      // API, not incidental third-party fetches (icon lookups, etc.).
      if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
        await nuxtApp.runWithContext(async () => {
          auth.authenticated = false
          auth.username = null
          await navigateTo('/login')
        })
      }
    }

    return response
  }) as typeof globalThis.fetch
})
