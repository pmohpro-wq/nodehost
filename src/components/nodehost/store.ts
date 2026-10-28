'use client'

/** Global UI store: viewer identity + bootstrap polling + console session persistence. */
import { create } from 'zustand'
import { nhGet, nhJson } from './api'
import type { BootstrapDto, ConsoleSession, ViewerInfo } from './types'

const SESSION_KEY = 'nodehost.console.session'

/** Live-poll interval of the control panel (bootstrap + directory). */
export const UI_POLL_MS = 5_000

interface NhState {
  /** Signed-in web user. undefined = not resolved yet, null = guest. */
  me: ViewerInfo | null | undefined
  firstUserPending: boolean
  data: BootstrapDto | null
  loading: boolean
  error: string | null
  tab: string
  session: ConsoleSession | null
  setTab: (t: string) => void
  refresh: () => Promise<void>
  loadMe: () => Promise<void>
  logout: () => Promise<void>
  setSession: (s: ConsoleSession | null) => void
}

export const useNh = create<NhState>((set, get) => ({
  me: undefined,
  firstUserPending: false,
  data: null,
  loading: true,
  error: null,
  tab: 'dashboard',
  session: null,
  setTab: (tab) => set({ tab }),

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
      // Drop console session + cached panel data so nothing leaks across users.
      if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_KEY)
      set({ session: null, data: null, me: null, tab: 'dashboard' })
      await get().refresh()
    }
  },

  setSession: (s) => {
    if (typeof window !== 'undefined') {
      if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s))
      else window.localStorage.removeItem(SESSION_KEY)
    }
    set({ session: s })
  },
}))

/** Restore persisted session (client only). */
export function loadSession(): ConsoleSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as ConsoleSession) : null
  } catch {
    return null
  }
}

/** Build the connectable list of hosts (local first, then gwPort-capable peers). */
export function connectableHosts(data: BootstrapDto | null) {
  if (!data) return []
  const list: { code: string; name: string; gwPort: number | null; kind: string }[] = [
    { code: data.host.code, name: data.host.name, gwPort: data.host.gwPort, kind: 'local' },
  ]
  for (const h of data.hosts) {
    if (h.gwPort) list.push({ code: h.code, name: h.name, gwPort: h.gwPort, kind: 'remote' })
  }
  return list
}

/**
 * One-click console connection to a LOCAL node (nodes tab shortcut).
 * Builds the session from the freshest bootstrap state and switches tab.
 */
export function openConsoleForLocalNode(code: string, token: string) {
  const { data, setSession, setTab } = useNh.getState()
  if (!data) return
  setSession({
    hostCode: data.host.code,
    hostName: data.host.name,
    gwPort: data.host.gwPort,
    nodeCode: code,
    nodeName: data.nodes.find((n) => n.code === code)?.name ?? code,
    token,
  })
  setTab('console')
}
