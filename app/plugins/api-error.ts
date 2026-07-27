export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuthStore()
  const nativeFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await nativeFetch(input, init)

    if (response.status === 401) {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(requestUrl, location.origin).pathname

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
