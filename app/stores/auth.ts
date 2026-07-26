import { defineStore } from 'pinia'
import type { AuthStatus } from '../../shared/types'

export const useAuthStore = defineStore('auth', () => {
  const authenticated = ref(false)
  const username = ref<string | null>(null)
  const needsSetup = ref(false)
  // Distinguishes "not logged in" from "haven't checked yet", so the route
  // guard doesn't bounce to /login before the first status call lands.
  const ready = ref(false)

  function apply(s: AuthStatus) {
    authenticated.value = s.authenticated
    username.value = s.username
    needsSetup.value = s.needsSetup
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

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      apply({ authenticated: false, username: null, needsSetup: false })
      await navigateTo('/login')
    }
  }

  return { authenticated, username, needsSetup, ready, fetchStatus, login, register, logout }
})
