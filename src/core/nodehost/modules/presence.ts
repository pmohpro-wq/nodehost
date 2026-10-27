/**
 * presence module — the network directory.
 *
 * - `presence.query`  -> replies with the hosting node's LOCAL roster
 * - `presence.roster` -> kernel merges a received roster into NetDirectory
 * Kernels additionally exchange rosters inside sys.hello heartbeats;
 * this module lets any node ask any other node directly, on demand.
 */
import { MODULE_TYPES, makeEnvelope } from '../protocol'
import { defineModule } from '../interfaces'

export default defineModule({
  id: 'presence',
  name: 'Presence / دایرکتوری حضور',
  version: '1.0.0',
  description: 'پاسخ به پرس‌وجوی دایرکتوری شبکه — فهرست نودهای محلی و وضعیت ادمین‌ها',
  author: 'core',

  async onMessage(envelope, ctx) {
    if (envelope.type === MODULE_TYPES.presence.QUERY) {
      const roster = await ctx.send(
        { host: envelope.from.host, node: envelope.from.node },
        'presence',
        MODULE_TYPES.presence.ROSTER,
        { requestedBy: envelope.from, at: Date.now() },
      )
      ctx.logger.info(`roster query answered (receipt: ${roster.outcome})`)
      return null // reply already routed via ctx.send
    }
    return null
  },
})
