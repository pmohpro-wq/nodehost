'use client'

/** Global UI store: bootstrap polling + console session persistence. */
import { create } from 'zustand'
import { nhGet } from './api'
import type { BootstrapDto, ConsoleSession } from './types'

const SESSION_KEY = 'nodehost.console.session'

interface NhState {
  data: BootstrapDto | null
  loading: boolean
  error: string | null
  tab: string
  session: ConsoleSession | null
  setTab: (t: string) => void
  refresh: () => Promise<void>
  setSession: (s: ConsoleSession | null) => void
}

export const useNh = create<NhState>((set, get) => ({
  data: null,
  loading: true,
  error: null,
  tab: 'dashboard',
  session: null,
  setTab: (tab) => set({ tab }),
  refresh: async () => {
    try {
      const data = await nhGet<BootstrapDto>('bootstrap')
      set({ data, loading: false, error: null })
    } catch (err) {
      // Kernel unreachable is a *temporary* state by design — keep old data
      set({ loading: false, error: String(err) })
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
