'use client'

/** Global UI store: viewer identity + bootstrap polling. Deliberately tiny. */
import { create } from 'zustand'
import { nhGet, nhJson } from './api'
import type { BootstrapDto, ViewerInfo } from './types'

/** Live-poll interval of the panel (bootstrap refresh). */
export const UI_POLL_MS = 5_000

interface NhState {
  /** Signed-in web user. undefined = not resolved yet, null = guest. */
  me: ViewerInfo | null | undefined
  firstUserPending: boolean
  data: BootstrapDto | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  loadMe: () => Promise<void>
  logout: () => Promise<void>
}

export const useNh = create<NhState>((set, get) => ({
  me: undefined,
  firstUserPending: false,
  data: null,
  loading: true,
  error: null,

  refresh: async () => {
    try {
      const data = await nhGet<BootstrapDto>('bootstrap')
      // The proxy re-evaluates the session on every poll — a suspended or
      // logged-out user flips back to the auth gate automatically.
      set({
        data,
        loading: false,
        error: null,
        me: data.viewer ?? null,
        firstUserPending: data.firstUserPending,
      })
    } catch (err) {
      // Kernel unreachable is a *temporary* state by design — keep old data
      set({ loading: false, error: String(err) })
    }
  },

  loadMe: async () => {
    try {
      const res = await nhJson<{ user: ViewerInfo | null; firstUserPending: boolean }>(
        '/api/auth/me',
        'GET',
      )
      set({ me: res.user, firstUserPending: res.firstUserPending })
    } catch {
      set({ me: null })
    }
  },

  logout: async () => {
    try {
      await nhJson('/api/auth/logout', 'POST')
    } finally {
      set({ data: null, me: null })
      await get().refresh()
    }
  },
}))
