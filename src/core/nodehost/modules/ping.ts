/**
 * ping module — liveness & latency probe between any two nodes.
 *
 * A node (via its admin console) sends `ping.request`; the target's
 * module instance immediately answers `ping.reply` echoing the original
 * timestamp so the requester can compute round-trip latency.
 * Demonstrates the NHP request/response correlation (replyTo).
 */
import { MODULE_TYPES, makeEnvelope } from '../protocol'
import { defineModule } from '../interfaces'

interface PingRequest {
  sentAt?: number
  note?: string
}

export default defineModule({
  id: 'ping',
  name: 'Ping / سنجش اتصال',
  version: '1.0.0',
  description: 'تست زنده‌بودن و اندازه‌گیری تاخیر رفت‌وبرگشت بین دو نود روی شبکه',
  author: 'core',

  async onEnable(ctx) {
    await ctx.storage.set('pingsServed', 0)
    ctx.logger.info('ping module enabled')
  },

  async onMessage(envelope, ctx) {
    if (envelope.type !== MODULE_TYPES.ping.REQUEST) return null
    const req = (envelope.payload ?? {}) as PingRequest

    const served = ((await ctx.storage.get<number>('pingsServed')) ?? 0) + 1
    await ctx.storage.set('pingsServed', served)

    return makeEnvelope({
      type: MODULE_TYPES.ping.REPLY,
      module: 'ping',
      from: { host: ctx.node.hostCode, node: ctx.node.code },
      to: envelope.from,
      payload: {
        sentAt: req.sentAt ?? envelope.ts,
        repliedAt: Date.now(),
        served,
        node: { code: ctx.node.code, name: ctx.node.name, host: ctx.node.hostCode },
      },
      replyTo: envelope.id,
    })
  },
})
