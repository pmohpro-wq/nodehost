/**
 * ============================================================
 * NHP — NodeHost Protocol v1
 * ============================================================
 * The single, versioned wire contract spoken by every NodeHost
 * and every Node, regardless of who wrote them or where they run.
 *
 * Design axioms (from the NodeHost manifesto):
 *  1. Every message is fully host-qualified: (host, node).
 *     A node on the local host and a node on a remote host are
 *     semantically identical — routing is pure networking.
 *  2. Nodes are ALWAYS online. A temporarily unreachable node is
 *     a routing concern (store-and-forward), never a semantic one.
 *  3. Admins MAY go offline. Their node keeps buffering for them.
 *  4. Modules are optional capabilities; every envelope names its
 *     target module so nodes can ignore what they did not enable.
 *
 * This file is dependency-free on purpose: any runtime (bun, node,
 * browser, deno) must be able to speak NHP by importing it alone.
 * ============================================================
 */

/** Current protocol version marker carried by every envelope. */
export const NHP_VERSION = 1 as const

/** Wildcard — matches any host / any node (used for fan-out). */
export const NHP_WILDCARD = '*'

// ------------------------------------------------------------
// Core envelope
// ------------------------------------------------------------

/** Fully-qualified network address of a node. */
export interface NhpAddress {
  /** Host routing code (e.g. "alfa") or "*" for any host. */
  host: string
  /** Node routing code (e.g. "node-a1") or "*" for any node. */
  node: string
}

/**
 * The NHP envelope — the ONLY unit of communication on the network.
 * Routers (kernels) never inspect `payload`; only modules do.
 */
export interface NhpEnvelope<T = unknown> {
  /** Protocol marker + version. Reject anything else. */
  nhp: number
  /** Globally unique envelope id (uuid). */
  id: string
  /** Namespaced action, e.g. "chat.message", "sys.hello". */
  type: string
  /** Target module id ("chat") or "sys" for system traffic. */
  module: string
  /** Sender address (never a wildcard). */
  from: NhpAddress
  /** Destination address (may use wildcards for fan-out). */
  to: NhpAddress
  /** Creation timestamp (epoch ms). */
  ts: number
  /** Remaining hops before the envelope is dropped (loop guard). */
  ttl: number
  /** Opaque module payload. */
  payload: T
  /** Envelope id this message replies to (request/response correlation). */
  replyTo?: string
}

/** Routing outcome reported by a kernel. */
export type RouteOutcome = 'delivered' | 'queued' | 'forwarded' | 'rejected'

// ------------------------------------------------------------
// System message types (module = "sys")
// ------------------------------------------------------------

export const NHP_SYS = {
  /** Kernel-to-kernel heartbeat. Carries the sender's roster. */
  HELLO: 'sys.hello',
  /** Reply to hello (latency + receiver's roster). */
  HELLO_ACK: 'sys.hello_ack',
  /** Generic ack produced by kernels/modules. */
  ACK: 'sys.ack',
  /** Rejection (bad envelope, unknown host/module, ...). */
  ERROR: 'sys.error',
} as const

// ------------------------------------------------------------
// Well-known payload shapes (system layer)
// ------------------------------------------------------------

export interface RosterEntry {
  code: string
  name: string
  modules: string[]
  adminOnline: boolean
  /** Demo nodes publish their token so testers can connect from the console. */
  isDemo?: boolean
  demoToken?: string
}

export interface HelloPayload {
  host: {
    code: string
    name: string
    gwPort?: number | null
    /** Sender's ingress URL so the receiver can heartbeat back. */
    address?: string
  }
  nodes: RosterEntry[]
}

// ------------------------------------------------------------
// Runtime validation (dependency-free guards)
// ------------------------------------------------------------

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isAddr = (v: unknown): v is NhpAddress =>
  !!v && typeof v === 'object' && isStr((v as NhpAddress).host) && isStr((v as NhpAddress).node)

/**
 * Structural validation of an inbound envelope.
 * Kernels MUST reject anything that fails this check.
 */
export function isValidEnvelope(v: unknown): v is NhpEnvelope {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    e.nhp === NHP_VERSION &&
    isStr(e.id) &&
    isStr(e.type) &&
    isStr(e.module) &&
    isAddr(e.from) &&
    isAddr(e.to) &&
    typeof e.ts === 'number' &&
    typeof e.ttl === 'number' &&
    'payload' in e
  )
}

/** Factory for well-formed envelopes. */
export function makeEnvelope<P>(params: {
  type: string
  module: string
  from: NhpAddress
  to: NhpAddress
  payload: P
  ttl?: number
  replyTo?: string
  id?: string
}): NhpEnvelope<P> {
  return {
    nhp: NHP_VERSION,
    id: params.id ?? crypto.randomUUID(),
    type: params.type,
    module: params.module,
    from: params.from,
    to: params.to,
    ts: Date.now(),
    ttl: params.ttl ?? 8,
    payload: params.payload,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
  }
}

/** True when the address is a wildcard (fan-out target). */
export const isWildcardAddr = (a: NhpAddress) =>
  a.host === NHP_WILDCARD || a.node === NHP_WILDCARD

/** Namespaced message types used by the built-in modules. */
export const MODULE_TYPES = {
  chat: { MESSAGE: 'chat.message' },
} as const
