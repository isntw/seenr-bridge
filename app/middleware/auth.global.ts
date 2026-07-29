import { safeRedirect } from '../utils/safe-redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()

  if (!auth.ready) await auth.fetchStatus()

  if (!auth.authenticated && to.path !== '/login') {
    return navigateTo(to.fullPath === '/' ? '/login' : `/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
  if (auth.authenticated && to.path === '/login') {
    return navigateTo(safeRedirect(to.query.redirect))
  }
})
