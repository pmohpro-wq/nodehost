/**
 * chat module — direct node-to-node messaging.
 *
 * Delivery model: the kernel persists every envelope in the target
 * node's mailbox. If the target admin is online the envelope is also
 * pushed over its socket; otherwise it waits (admins may go offline,
 * nodes never do). This module itself only acknowledges receipt.
 */
import { MODULE_TYPES, NHP_SYS, makeEnvelope } from '../protocol'
import { defineModule } from '../interfaces'

export default defineModule({
  id: 'chat',
  name: 'Chat / پیام‌رسانی',
  version: '1.0.0',
  description:
    'پیام مستقیم بین نودها — تحویل به ادمین مقصد یا نگه‌داری در صندوق نود تا بازگشت ادمین',
  author: 'core',

  async onMessage(envelope, ctx) {
    if (envelope.type !== MODULE_TYPES.chat.MESSAGE) return null
    const text = String((envelope.payload as { text?: string })?.text ?? '').slice(0, 4000)
    if (!text) return null

    ctx.logger.info(`message for ${envelope.to.node}: "${text.slice(0, 60)}"`)

    // The mailbox row itself is written by the kernel router; here we
    // only send a lightweight ack back to the sender's node.
    return makeEnvelope({
      type: NHP_SYS.ACK,
      module: 'sys',
      from: { host: ctx.node.hostCode, node: ctx.node.code },
      to: envelope.from,
      payload: { received: true, envId: envelope.id, preview: text.slice(0, 80) },
      replyTo: envelope.id,
    })
  },
})
