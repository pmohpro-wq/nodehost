/**
 * chat module — THE app of a node: a real messenger.
 *
 * Architecture (module = app, not just a message sink):
 *  - Delivery stays kernel-grade: every message is an NHP envelope
 *    (`chat.message`) routed by the kernel — local or federated — and
 *    persisted in the target node's mailbox (admins may go offline;
 *    nodes never do).
 *  - The app's OWN state (conversations, history, unread marks) lives in
 *    the module's private storage sandbox, keyed per (node, module).
 *  - The owner's panel talks to the app through `onApi` — served by the
 *    kernel at /internal/nodes/:ref/apps/chat/... after the web proxy
 *    verified node ownership:
 *
 *      GET  conversations            → contacts (directory ∩ chat) + threads
 *      GET  messages?host=&node=     → one thread (marks it seen)
 *      POST send {to, text}          → envelope out + append to the thread
 */
import { MODULE_TYPES, NHP_SYS, makeEnvelope } from '../protocol'
import { defineModule } from '../interfaces'
import type { INodeContext } from '../interfaces'

const CHAT_KEEP = 200 // max messages retained per conversation (app state)

interface ChatMsg {
  id: string
  dir: 'in' | 'out'
  text: string
  at: number
}

interface Peer {
  host: string
  node: string
}

const convKey = (p: Peer) => `conv:${p.host}|${p.node}`
const seenKey = (p: Peer) => `seen:${p.host}|${p.node}`
const parseConvKey = (key: string): Peer | null => {
  const m = /^conv:([^|]+)\|(.+)$/.exec(key)
  return m ? { host: m[1], node: m[2] } : null
}

const isPeer = (v: unknown): v is Peer =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Peer).host === 'string' &&
  (v as Peer).host.length > 0 &&
  typeof (v as Peer).node === 'string' &&
  (v as Peer).node.length > 0

/** Same node? (self-send is meaningless for a messenger) */
const isSelf = (ctx: INodeContext, p: Peer) =>
  p.host === ctx.node.hostCode && p.node === ctx.node.code

async function loadConv(ctx: INodeContext, p: Peer): Promise<ChatMsg[]> {
  const rows = await ctx.storage.get<ChatMsg[]>(convKey(p))
  return Array.isArray(rows) ? rows : []
}

async function appendMsg(ctx: INodeContext, p: Peer, msg: ChatMsg) {
  const rows = await loadConv(ctx, p)
  rows.push(msg)
  if (rows.length > CHAT_KEEP) rows.splice(0, rows.length - CHAT_KEEP)
  await ctx.storage.set(convKey(p), rows)
}

export default defineModule({
  id: 'chat',
  name: 'پیام‌رسان / Messenger',
  version: '2.0.0',
  description:
    'اپ اصلی نود — گفتگوی دوطرفه با هر نود شبکه (همین سرور یا سرورهای فدرال) با انتخاب گیرنده از دفترچه، تاریخچه و شمارش خوانده‌نشده‌ها',
  author: 'core',

  // ---- inbound: the peer's message reached THIS node ----
  async onMessage(envelope, ctx) {
    if (envelope.type !== MODULE_TYPES.chat.MESSAGE) return null
    const text = String((envelope.payload as { text?: string })?.text ?? '').slice(0, 4000)
    if (!text) return null

    await appendMsg(ctx, { host: envelope.from.host, node: envelope.from.node }, {
      id: envelope.id,
      dir: 'in',
      text,
      at: envelope.ts || Date.now(),
    })
    ctx.logger.info(`message from ${envelope.from.host}/${envelope.from.node}`)

    // Protocol-level receipt (kernel routes it back; the sender's panel
    // may use it as a delivery hint). Conversation state lives above.
    return makeEnvelope({
      type: NHP_SYS.ACK,
      module: 'sys',
      from: { host: ctx.node.hostCode, node: ctx.node.code },
      to: envelope.from,
      payload: { received: true, envId: envelope.id },
      replyTo: envelope.id,
    })
  },

  // ---- the app API served to the node's owner ----
  async onApi(req, ctx) {
    const me = { host: ctx.node.hostCode, node: ctx.node.code, name: ctx.node.name }

    // ---- GET conversations: contacts + threads ----
    if (req.method === 'GET' && req.path === 'conversations') {
      const dir = await ctx.directory()
      const contacts = dir
        .filter(
          (d) =>
            d.modules.includes('chat') &&
            !(d.hostCode === me.host && d.nodeCode === me.node),
        )
        .map((d) => ({
          host: d.hostCode,
          hostName: d.hostName ?? d.hostCode,
          node: d.nodeCode,
          name: d.nodeName,
          online: d.adminOnline,
        }))

      const keys = await ctx.storage.keys()
      const conversations: {
        peer: Peer
        last: ChatMsg
        unread: number
      }[] = []
      for (const key of keys.filter((k) => k.startsWith('conv:'))) {
        const peer = parseConvKey(key)
        if (!peer) continue
        const rows = await loadConv(ctx, peer)
        if (!rows.length) continue
        const seen = (await ctx.storage.get<number>(seenKey(peer))) ?? 0
        const unread = rows.filter((r) => r.dir === 'in' && r.at > seen).length
        const last = rows[rows.length - 1]
        conversations.push({ peer, last, unread })
      }
      conversations.sort((a, b) => b.last.at - a.last.at)
      return { json: { ok: true, me, contacts, conversations } }
    }

    // ---- GET messages?host=&node= : one thread (and mark seen) ----
    if (req.method === 'GET' && req.path === 'messages') {
      const peer = { host: req.query.host ?? '', node: req.query.node ?? '' }
      if (!isPeer(peer)) return { status: 422, json: { ok: false, error: 'گیرنده مشخص نیست' } }
      const items = await loadConv(ctx, peer)
      await ctx.storage.set(seenKey(peer), Date.now())
      return { json: { ok: true, peer, items } }
    }

    // ---- POST send { to: {host,node}, text } ----
    if (req.method === 'POST' && req.path === 'send') {
      const body = (req.body ?? {}) as { to?: unknown; text?: unknown }
      const text = String(body.text ?? '').trim().slice(0, 4000)
      if (!isPeer(body.to)) return { status: 422, json: { ok: false, error: 'گیرنده مشخص نیست' } }
      if (!text) return { status: 422, json: { ok: false, error: 'متن پیام خالی است' } }
      if (isSelf(ctx, body.to))
        return { status: 422, json: { ok: false, error: 'گیرنده باید نود دیگری باشد' } }

      // Real NHP envelope through the kernel router — local or federated.
      const receipt = await ctx.send(
        { host: body.to.host, node: body.to.node },
        'chat',
        MODULE_TYPES.chat.MESSAGE,
        { text },
      )
      if (receipt.outcome === 'rejected')
        return {
          status: 422,
          json: {
            ok: false,
            error: 'تحویل ممکن نیست — نود مقصد در شبکه شناخته نشده یا ماژول چت ندارد',
          },
        }

      await appendMsg(ctx, body.to, {
        id: receipt.envId,
        dir: 'out',
        text,
        at: Date.now(),
      })
      return { json: { ok: true, envId: receipt.envId, outcome: receipt.outcome } }
    }

    return { status: 404, json: { ok: false, error: `no chat api: ${req.method} ${req.path}` } }
  },
})
