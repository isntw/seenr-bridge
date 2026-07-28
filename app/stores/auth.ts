import { defineStore } from 'pinia'
import type { AuthStatus } from '../../shared/types'

export const useAuthStore = defineStore('auth', () => {
  const authenticated = ref(false)
  const username = ref<string | null>(null)
  const needsSetup = ref(false)
  // Whether the login page should offer Plex sign-in at all. Hiding it when it cannot
  // succeed is the point: otherwise the operator approves in Plex and only then learns
  // their account was never linked.
  const plexLogin = ref(false)
  // False for an account created by signing in with Plex, which never had one.
  const hasPassword = ref(true)
  const ready = ref(false)

  function apply(s: AuthStatus) {
    authenticated.value = s.authenticated
    username.value = s.username
    needsSetup.value = s.needsSetup
    // Only /api/auth/status reports this; login and register leave it as-is rather
    // than clobbering it with a default.
    if (s.plexLogin !== undefined) plexLogin.value = s.plexLogin
    if (s.hasPassword !== undefined) hasPassword.value = s.hasPassword
  }

  async function fetchStatus() {
    try {
      apply(await $fetch<AuthStatus>('/api/auth/status'))
    } catch {
      apply({ authenticated: false, username: null, needsSetup: false })
    } finally {
      ready.value = true
    }
  }

  async function login(u: string, p: string) {
    apply(await $fetch<AuthStatus>('/api/auth/login', {
      method: 'POST',
      body: { username: u, password: p },
    }))
  }

  async function register(u: string, p: string) {
    apply(await $fetch<AuthStatus>('/api/auth/register', {
      method: 'POST',
      body: { username: u, password: p },
    }))
  }

  // The PIN flow, driven from the login page. The session cookie is set server-side by
  // /api/auth/plex/poll; nothing about the Plex token ever reaches this store.
  async function startPlexLogin(): Promise<{ id: string; url: string }> {
    return await $fetch<{ id: string; code: string; url: string }>('/api/auth/plex/start', {
      method: 'POST',
    })
  }

  async function pollPlexLogin(id: string): Promise<boolean> {
    const s = await $fetch<AuthStatus>('/api/auth/plex/poll', { method: 'POST', body: { id } })
    if (!s.authenticated) return false
    apply(s)
    return true
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      apply({ authenticated: false, username: null, needsSetup: false })
      await navigateTo('/login')
    }
  }

  return {
    authenticated, username, needsSetup, plexLogin, hasPassword, ready,
    fetchStatus, login, register, logout, startPlexLogin, pollPlexLogin,
  }
})
