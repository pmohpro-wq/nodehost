/**
 * broadcast module — publish/subscribe across the whole network.
 *
 * Publishing: an admin emits `broadcast.publish` addressed to (*,*).
 * The SENDING kernel fans out one `broadcast.post` per remote host and
 * per eligible local node; each target kernel re-fans-out locally to
 * nodes that enabled the broadcast module. Subscribe = enable module.
 */
import { MODULE_TYPES, makeEnvelope } from '../protocol'
import { defineModule } from '../interfaces'

export default defineModule({
  id: 'broadcast',
  name: 'Broadcast / تابلو اعلانات',
  version: '1.0.0',
  description:
    'انتشار پیام همگانی در کل شبکه — هر نودی که ماژول را فعال کرده باشد پست را دریافت می‌کند',
  author: 'core',

  async onMessage(envelope, ctx) {
    const { PUBLISH, POST } = MODULE_TYPES.broadcast
    if (envelope.type !== PUBLISH && envelope.type !== POST) return null
    const p = envelope.payload as { title?: string; body?: string; origin?: string }
    if (!p?.title) return null

    // Track last-seen post id in the private storage sandbox.
    await ctx.storage.set('lastPost', {
      id: envelope.id,
      title: p.title,
      origin: p.origin ?? envelope.from.host,
      at: envelope.ts,
    })

    ctx.logger.info(`bulletin received: "${p.title}" from ${envelope.from.host}`)
    return null // bulletins are one-way; no ack noise
  },
})
