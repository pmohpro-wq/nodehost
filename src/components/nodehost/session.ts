'use client'

/**
 * session.ts — the TAB's session, nothing more.
 *
 * NodeHost has no cookies and no server sessions. Each browser tab keeps
 * its viewer in sessionStorage (per-tab by spec — a second tab starts
 * empty, so two tabs are two independent users) and mirrors the identity
 * into the address bar as `?u=<name>`:
 *
 *   - login   → sessionStorage + `?u=<name>` appear together;
 *   - refresh → the URL restores the session in THIS tab only;
 *   - logout  → both are removed and the tab is a guest again;
 *   - every API call presents the identity as the `x-nh-user` header,
 *     which the server re-validates against the User table per request.
 *
 * The URL is the single source of truth; sessionStorage is the write-through
 * cache so a refresh does not need to re-enter. Nothing ever lands in
 * localStorage or cookies — that is what keeps tabs from leaking into
 * each other.
 */

export interface TabUser {
  id: string
  name: string
  role: 'user' | 'admin'
}

const KEY = 'nh.tab.user'

/** Read this tab's viewer (null when the tab is a guest). */
export function readTabUser(): TabUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as TabUser
    return u && typeof u.name === 'string' && u.name ? u : null
  } catch {
    return null
  }
}

/** Write this tab's viewer (sessionStorage ONLY — never localStorage). */
export function writeTabUser(u: TabUser): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(u))
  } catch {
    /* private-mode quota — the URL param still carries the identity */
  }
}

/** Forget this tab's viewer. Other tabs are untouched by definition. */
export function clearTabUser(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}

/**
 * Headers that present this tab's identity to the web layer.
 * The name travels URL-encoded (Persian names are not header-safe raw).
 */
export function tabUserHeaders(): Record<string, string> {
  const u = readTabUser()
  return u ? { 'x-nh-user': encodeURIComponent(u.name) } : {}
}

/** The canonical in-app URL for a viewer (or the bare guest URL). */
export function urlForUser(name: string | null): string {
  return name ? `/?u=${encodeURIComponent(name)}` : '/'
}

/** Rewrite the address bar without navigation/history noise. */
export function setUrlForUser(name: string | null): void {
  if (typeof window === 'undefined') return
  const url = urlForUser(name)
  try {
    window.history.replaceState(null, '', url)
  } catch {
    /* older browsers — the session still works, only the bar lags */
  }
}

/** The `u` identity currently in the address bar (null when absent). */
export function urlUserName(): string | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('u')
  if (raw === null) return null
  const name = raw.trim()
  return name || null
}
