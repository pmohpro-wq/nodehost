'use client'

/**
 * ConsoleSocketContext — behavior-level handle on the admin session.
 *
 * Replaces the former window.__nhSocket global registry. The session
 * view owns the socket.io lifecycle ONCE and exposes intent-level
 * operations; panels never touch the socket object itself (they don't
 * even import socket.io-client).
 */
import { createContext, useContext } from 'react'
import type { SendFn } from '../types'

/** Raw wire envelope pushed by the kernel (nhp:in). */
export interface WireEnvelope {
  id?: string
  module?: string
  type?: string
  from?: { host?: string; node?: string }
  to?: { host?: string; node?: string }
  [key: string]: unknown
}

/** Connection state of the admin session. */
export type ConnState = 'idle' | 'connecting' | 'connected' | 'error'

interface ConsoleSocket {
  conn: ConnState
  /** Send an NHP envelope from the bound node (shared implementation). */
  send: SendFn
  /** Emit a session-socket event (no-op while offline). */
  emit: (event: string, ...args: unknown[]) => void
  /** Subscribe to live kernel pushes (nhp:in); returns unsubscribe. */
  onNhpIn: (handler: (env: WireEnvelope) => void) => () => void
}

const ConsoleSocketContext = createContext<ConsoleSocket>({
  conn: 'idle',
  send: () => {},
  emit: () => {},
  onNhpIn: () => () => {},
})

export const ConsoleSocketProvider = ConsoleSocketContext.Provider

export function useConsoleSocket() {
  return useContext(ConsoleSocketContext)
}
