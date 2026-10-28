/** Tiny wrapper around the control-plane proxy (/api/nh/* → kernel /internal/*). */

import { tabUserHeaders } from './session'

async function handle<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body
}

/**
 * Every call presents THIS tab's identity as the `x-nh-user` header —
 * the server re-resolves the viewer per request, which is what keeps
 * two tabs (two users) fully isolated.
 */
export function nhGet<T>(path: string): Promise<T> {
  return fetch(`/api/nh/${path}`, {
    cache: 'no-store',
    headers: tabUserHeaders(),
  }).then((r) => handle<T>(r))
}

export function nhPost<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`/api/nh/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...tabUserHeaders() },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  }).then((r) => handle<T>(r))
}

export function nhDelete<T>(path: string): Promise<T> {
  return fetch(`/api/nh/${path}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: tabUserHeaders(),
  }).then((r) => handle<T>(r))
}

/** Auth/admin endpoints (Next.js layer, NOT the kernel proxy). */
export async function nhJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...tabUserHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  }).then((r) => handle<T>(r))
}

/** Relative time in Persian. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.max(1, Math.round(diff / 1000))
  if (s < 60) return `${s} ثانیه پیش`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} دقیقه پیش`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ساعت پیش`
  return `${Math.round(h / 24)} روز پیش`
}

export function clockOf(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
