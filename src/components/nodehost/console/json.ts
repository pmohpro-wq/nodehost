'use client'

/** Tiny JSON helpers shared by the console panels. */
import type { MailRow } from '../types'

export function safeParse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return {} as T
  }
}

/** Rebuild the original NHP envelope of a mailbox row (for the raw view). */
export function rowToEnvelope(m: MailRow) {
  try {
    return JSON.parse(m.envelope)
  } catch {
    return { envId: m.envId, payload: safeParse(m.payload) }
  }
}
