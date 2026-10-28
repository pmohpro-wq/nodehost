'use client'

/**
 * Global UI store — viewer identity + bootstrap polling, TAB-SCOPED.
 *
 * Identity model (tab isolation):
 *   - the URL (`?u=<name>`) is the single source of truth for who this tab is;
 *   - sessionStorage mirrors it so a refresh needs no re-enter;
 *   - every API call carries the identity as the `x-nh-user` header and the
 *     server re-validates it per request;
 *   - login writes BOTH (session + URL), logout removes BOTH — other tabs
 *     never notice, because nothing is shared (no cookie, no localStorage).
 */
import { create } from 'zustand'
import { nhGet, nhJson } from './api'
import {
  clearTabUser,
  readTabUser,
  setUrlForUser,
  urlUserName,
  writeTabUser,
} from './session'
import type { NhpAddress } from '@/core/nodehost/protocol'
import type { BootstrapDto, ViewerInfo } from './types'

/** Live-poll interval of the panel (bootstrap refresh). */
export const UI_POLL_MS = 5_000

export type LoginResult =
  | { ok: true; user: ViewerInfo; created: boolean; nodeCreated?: boolean }
  | { ok: false; error: string }

interface NhState {
  /** This tab's viewer. undefined = boot not finished, null = guest tab. */
  me: ViewerInfo | null | undefined
  firstUserPending: boolean
  data: BootstrapDto | null
  loading: boolean
  error: string | null
  /** Mount sequence — runs ONCE per tab. */
  boot: () => Promise<void>
  refresh: () => Promise<void>
  /** Passwordless enter: creates account+node on first sight, then claims the tab. */
  login: (name: string) => Promise<LoginResult>
  /** Forget this tab's session and strip the identity from the address bar. */
  logout: () => Promise<void>
  /**
   * Cross-app jump within THIS tab (e.g. contacts → chat). Deliberately
   * plain component-level state in the tab-scoped store: it never crosses
   * tabs, so tab isolation holds by construction.
   */
  chatFocus: NhpAddress | null
  focusChat: (peer: NhpAddress) => void
  clearChatFocus: () => void
}

let bootStarted = false

export const useNh = create<NhState>((set, get) => ({
  me: undefined,
  firstUserPending: false,
  data: null,
  loading: true,
  error: null,

  boot: async () => {
    if (bootStarted) return
    bootStarted = true

    const urlName = urlUserName()
    const tab = readTabUser()

    // Address bar has an identity → THIS tab is that user. A matching
    // session in sessionStorage is the fast path; otherwise a silent
    // enter restores/creates it (paste the link into a fresh tab and you
    // are that user — the documented passwordless testing contract).
    if (urlName) {
      if (tab && tab.name === urlName) {
        set({ me: tab })
        await get().refresh()
        return
      }
      try {
        const res = await nhJson<{ ok: boolean; created?: boolean; user: ViewerInfo; nodeCreated?: boolean }>(
          '/api/auth/enter',
          'POST',
          { name: urlName },
        )
        writeTabUser(res.user)
        set({ me: res.user })
        setUrlForUser(res.user.name) // normalize encoding in the bar
      } catch (err) {
        // Unknown-but-rejected (suspended) or invalid name → guest tab.
        clearTabUser()
        setUrlForUser(null)
        set({ me: null, error: String(err) })
      }
      await get().refresh()
      return
    }

    // No identity in the bar → this tab is a guest, whatever the mirror says.
    clearTabUser()
    set({ me: null })
    await get().refresh()
  },

  refresh: async () => {
    try {
      const data = await nhGet<BootstrapDto>('bootstrap')
      // The proxy re-resolves the tab header on every poll: a suspended or
      // forgotten identity flips this tab back to the auth gate by itself.
      const me = data.viewer ?? null
      if (!me && readTabUser()) {
        // Server rejected the session this tab still claims → drop it.
        clearTabUser()
        setUrlForUser(null)
      }
      set({
        data,
        loading: false,
        error: null,
        me,
        firstUserPending: data.firstUserPending,
      })
    } catch (err) {
      // Kernel unreachable is a *temporary* state by design — keep old data
      set({ loading: false, error: String(err) })
    }
  },

  login: async (name) => {
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 40 || /[\u0000-\u001f\u007f|]/.test(trimmed)) {
      return { ok: false, error: 'نام باید ۲ تا ۴۰ نویسه باشد (بدون | و نویسه‌های کنترلی)' }
    }
    try {
      const res = await nhJson<{ ok: boolean; created?: boolean; user: ViewerInfo; nodeCreated?: boolean }>(
        '/api/auth/enter',
        'POST',
        { name: trimmed },
      )
      // Claim THIS tab only: per-tab storage + the address bar. No cookie,
      // no server session — so no other tab can be affected.
      writeTabUser(res.user)
      setUrlForUser(res.user.name)
      set({ me: res.user, error: null })
      await get().refresh()
      return { ok: true, user: res.user, created: !!res.created, nodeCreated: res.nodeCreated }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },

  logout: async () => {
    // No server call — there is no server session to end. Forget the tab:
    clearTabUser()
    setUrlForUser(null)
    set({ data: null, me: null, firstUserPending: false })
    await get().refresh() // guest bootstrap (drives the first-admin hint)
  },

  chatFocus: null,
  focusChat: (peer) => set({ chatFocus: { host: peer.host, node: peer.node } }),
  clearChatFocus: () => set({ chatFocus: null }),
}))
