export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()

  if (!auth.ready) await auth.fetchStatus()

  if (!auth.authenticated && to.path !== '/login') {
    return navigateTo('/login')
  }
  if (auth.authenticated && to.path === '/login') {
    return navigateTo('/dashboard')
  }
})
