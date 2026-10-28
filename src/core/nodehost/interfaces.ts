/**
 * ============================================================
 * NodeHost Module Interfaces — the open developer contract
 * ============================================================
 * Anyone can extend the network by implementing `INodeModule`.
 * A module is pure logic: it receives envelopes for the nodes
 * that enabled it and may reply / broadcast through its context.
 *
 * Guarantees given to every module by the kernel:
 *  - ctx is scoped to ONE node (isolation by construction)
 *  - storage is a private KV sandbox keyed (node, module)
 *  - the kernel never leaks the admin socket; modules talk NHP only
 *  - enabling/disabling is hot: onEnable/onDisable run at runtime
 * ============================================================
 */

import type { NhpAddress, NhpEnvelope, RouteOutcome } from './protocol'

/** Minimal read-only view of the node a module instance is attached to. */
export interface INodeIdentity {
  id: string
  code: string
  name: string
  hostId: string
  hostCode: string
  hostName: string
}

/** Private per-(node,module) key/value sandbox — persisted by the kernel. */
export interface IKeyValueStore {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

/** Structured logger, automatically scoped to node + module. */
export interface ILogger {
  info(msg: string, data?: unknown): void
  warn(msg: string, data?: unknown): void
  error(msg: string, data?: unknown): void
}

/** An entry of the live network directory (presence view). */
export interface IDirectoryEntry {
  hostCode: string
  hostName?: string
  nodeCode: string
  nodeName: string
  modules: string[]
  adminOnline: boolean
  /** Demo nodes publish their token for test consoles. */
  isDemo?: boolean
  demoToken?: string
}

/** Receipt returned after handing an envelope to the router. */
export interface IReceipt {
  envId: string
  outcome: RouteOutcome
}

/** Result of a correlated request() call. */
export interface IRequestResult {
  ok: boolean
  /** The reply envelope (matched via replyTo) when ok. */
  reply?: NhpEnvelope
  error?: string
}

/**
 * Everything a module may touch. This is the sandbox wall:
 * no DB handles, no sockets, no globals — only this context.
 */
export interface INodeContext {
  /** The node this module instance runs for. */
  node: INodeIdentity
  /** Per-node module config (from NodeModuleState.config). */
  config: Record<string, unknown>
  /** Private storage sandbox for (node, module). */
  storage: IKeyValueStore
  /** Scoped logger. */
  logger: ILogger
  /** Send a new envelope from the hosting node. */
  send(to: NhpAddress, module: string, type: string, payload: unknown): Promise<IReceipt>
  /**
   * Send and AWAIT the correlated reply envelope (NHP request/response).
   * The remote module's returned envelope is matched via `replyTo`.
   * Resolves `{ ok: false, error }` on timeout (default 10s) or rejection.
   */
  request(
    to: NhpAddress,
    module: string,
    type: string,
    payload: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<IRequestResult>
  /** Fan-out to every node (local + federation) that enabled `module`. */
  broadcast(module: string, type: string, payload: unknown): Promise<number>
  /** Query the live network directory (local nodes + learned rosters). */
  directory(): Promise<IDirectoryEntry[]>
}

/**
 * THE extension point of the whole architecture.
 *
 * Lifecycle:
 *   kernel.enable(node, module)  -> factory(ctx) -> onEnable()
 *   kernel.disable(node, module) -> onDisable() -> instance dropped
 *
 * Message flow:
 *   envelope arrives for node N with module M enabled
 *     -> kernel calls M.onMessage(envelope, ctxOf(N))
 *     -> may return a reply envelope, which the kernel routes back
 */
export interface INodeModule<P = unknown> {
  /** Unique module id used in envelopes ("chat", "my-custom-thing"). */
  id: string
  /** Human title (shown in the UI module registry). */
  name: string
  /** Semver of the module implementation. */
  version: string
  /** One-line description for the registry. */
  description: string
  /** Author/tag shown in the registry. */
  author?: string

  /** Called once when a node enables the module (hot-plug). */
  onEnable?(ctx: INodeContext): Promise<void>
  /** Called once when a node disables the module (hot-unplug). */
  onDisable?(ctx: INodeContext): Promise<void>
  /**
   * Handle an inbound envelope. Return an envelope to auto-route it,
   * or null when no reply is needed.
   */
  onMessage(envelope: NhpEnvelope<P>, ctx: INodeContext): Promise<NhpEnvelope | null>
}

/** Module factory — how kernels instantiate per-node instances. */
export type ModuleFactory = () => INodeModule

/** Registration shape used by both built-ins and third-party modules. */
export interface ModuleRegistration {
  factory: ModuleFactory
  meta: { id: string; name: string; version: string; description: string; author?: string }
}

/**
 * Helper to define a module with full type inference.
 * Third-party developers only need this function.
 */
export function defineModule<P>(def: INodeModule<P> & { author?: string }): ModuleRegistration {
  return {
    factory: () => def as unknown as INodeModule,
    meta: {
      id: def.id,
      name: def.name,
      version: def.version,
      description: def.description,
      ...(def.author ? { author: def.author } : {}),
    },
  }
}
