/**
 * runtime.ts — the module runtime (hot-plug sandbox per node).
 *
 * For every (node, enabled module) pair the runtime owns ONE instance.
 * Instances are reconciled against the DB on every config change, so
 * flipping a switch in the UI instantly attaches/detaches the module.
 * A module can never see another node's context — isolation by design.
 */
import type {
  IKeyValueStore,
  ILogger,
  INodeContext,
  INodeModule,
  INodeIdentity,
  ModuleRegistration,
} from '../../src/core/nodehost/interfaces'
import type { NhpEnvelope } from '../../src/core/nodehost/protocol'
import type { Kernel } from './kernel'
import { prisma } from './store'

interface Instance {
  nodeId: string
  nodeCode: string
  moduleId: string
  mod: INodeModule
  ctx: INodeContext
}

const instKey = (nodeCode: string, moduleId: string) => `${nodeCode}::${moduleId}`

export class ModuleRuntime {
  /** nodeCode::moduleId -> live instance */
  private live = new Map<string, Instance>()

  constructor(
    private kernel: Kernel,
    private registry: Map<string, ModuleRegistration>,
  ) {}

  /** Attach a module instance to a node (runs onEnable). */
  private async attach(node: INodeIdentity, moduleId: string, config: Record<string, unknown>) {
    const reg = this.registry.get(moduleId)
    if (!reg) return
    const ctx = this.buildContext(node, moduleId, config)
    const inst: Instance = {
      nodeId: node.id,
      nodeCode: node.code,
      moduleId,
      mod: reg.factory(),
      ctx,
    }
    this.live.set(instKey(node.code, moduleId), inst)
    try {
      await inst.mod.onEnable?.(ctx)
    } catch (err) {
      inst.ctx.logger.error('onEnable failed', String(err))
    }
  }

  /** Detach (runs onDisable). */
  private async detach(nodeCode: string, moduleId: string) {
    const inst = this.live.get(instKey(nodeCode, moduleId))
    if (!inst) return
    this.live.delete(instKey(nodeCode, moduleId))
    try {
      await inst.mod.onDisable?.(inst.ctx)
    } catch (err) {
      inst.ctx.logger.error('onDisable failed', String(err))
    }
  }

  /**
   * Reconcile live instances with DB state.
   * Called on boot and after every node/module mutation.
   */
  async syncAll() {
    const nodes = await prisma.node.findMany({
      include: { host: true, moduleStates: true },
    })

    // Detach instances whose node/module pair no longer exists or is disabled
    for (const [key, inst] of [...this.live]) {
      const node = nodes.find((n) => n.code === inst.nodeCode)
      const state = node?.moduleStates.find((s) => s.moduleId === inst.moduleId)
      if (!node || !state?.enabled || node.status !== 'active') {
        this.live.delete(key)
        await this.detach(inst.nodeCode, inst.moduleId)
      }
    }

    // Attach missing
    for (const node of nodes) {
      if (node.status !== 'active') continue
      const identity: INodeIdentity = {
        id: node.id,
        code: node.code,
        name: node.name,
        hostId: node.host.id,
        hostCode: node.host.code,
        hostName: node.host.name,
      }
      for (const state of node.moduleStates) {
        if (!state.enabled) continue
        if (!this.registry.has(state.moduleId)) continue
        if (this.live.has(instKey(node.code, state.moduleId))) continue
        await this.attach(
          identity,
          state.moduleId,
          safeParse(state.config, {}),
        )
      }
    }
  }

  isEnabled(nodeCode: string, moduleId: string) {
    return this.live.has(instKey(nodeCode, moduleId))
  }

  /** Dispatch an envelope to the target node's module instance. */
  async dispatch(env: NhpEnvelope): Promise<void> {
    const inst = this.live.get(instKey(env.to.node, env.module))
    if (!inst) return
    try {
      const reply = await inst.mod.onMessage(env, inst.ctx)
      if (reply) await this.kernel.route(reply, 'module')
    } catch (err) {
      inst.ctx.logger.error(`onMessage(${env.type}) failed`, String(err))
    }
  }

  /** Build the sandboxed context handed to modules. */
  private buildContext(
    node: INodeIdentity,
    moduleId: string,
    config: Record<string, unknown>,
  ): INodeContext {
    const kernel = this.kernel
    return {
      node,
      config,
      storage: this.buildStorage(node.id, moduleId),
      logger: this.buildLogger(node, moduleId),
      send: (to, module, type, payload) =>
        kernel.sendFromNode(
          { host: node.hostCode, node: node.code },
          to,
          module,
          type,
          payload,
        ),
      broadcast: (module, type, payload) =>
        kernel.broadcastFromNode({ host: node.hostCode, node: node.code }, module, type, payload),
      directory: () => kernel.getDirectory(),
    }
  }

  private buildStorage(nodeId: string, moduleId: string): IKeyValueStore {
    return {
      async get<T = unknown>(key: string): Promise<T | null> {
        const row = await prisma.moduleStorage.findUnique({
          where: { nodeId_moduleId_key: { nodeId, moduleId, key } },
        })
        return row ? (JSON.parse(row.value) as T) : null
      },
      async set(key: string, value: unknown) {
        await prisma.moduleStorage.upsert({
          where: { nodeId_moduleId_key: { nodeId, moduleId, key } },
          update: { value: JSON.stringify(value ?? null) },
          create: { nodeId, moduleId, key, value: JSON.stringify(value ?? null) },
        })
      },
      async delete(key: string) {
        await prisma.moduleStorage
          .delete({ where: { nodeId_moduleId_key: { nodeId, moduleId, key } } })
          .catch(() => {})
      },
      async keys() {
        const rows = await prisma.moduleStorage.findMany({
          where: { nodeId, moduleId },
          select: { key: true },
        })
        return rows.map((r) => r.key)
      },
    }
  }

  private buildLogger(node: INodeIdentity, moduleId: string): ILogger {
    const scope = `mod:${moduleId}@${node.code}`
    return {
      info: (msg, data) => {
        console.log(`[${scope}] ${msg}`, data ?? '')
        void prisma.sysLog
          .create({
            data: { level: 'info', scope, message: msg, data: json(data) },
          })
          .catch(() => {})
      },
      warn: (msg, data) => {
        console.warn(`[${scope}] ${msg}`, data ?? '')
        void prisma.sysLog
          .create({ data: { level: 'warn', scope, message: msg, data: json(data) } })
          .catch(() => {})
      },
      error: (msg, data) => {
        console.error(`[${scope}] ${msg}`, data ?? '')
        void prisma.sysLog
          .create({ data: { level: 'error', scope, message: msg, data: json(data) } })
          .catch(() => {})
      },
    }
  }
}

function json(v: unknown) {
  return v === undefined ? '{}' : JSON.stringify(v).slice(0, 2000)
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
