/**
 * adminSocket.ts — admin session handlers (socket.io data-plane).
 *
 * An admin binds to EXACTLY ONE node per connection (architecture law).
 * This module owns the wire protocol of that session; all persistence
 * goes through mailbox.ts, all routing through the Kernel. The kernel
 * never needs to know how the admin socket layer is shaped.
 */
import type { Socket } from 'socket.io'
import type { NhpAddress } from '../../src/core/nodehost/protocol'
import { makeEnvelope } from '../../src/core/nodehost/protocol'
import type { Kernel } from './kernel'
import {
  alreadyDelivered,
  chatHistory,
  clearMailbox,
  listMailbox,
  recordInbound,
  replayMailbox,
} from './mailbox'
import { localRoster, log, prisma } from './store'

export function bindAdminSocket(kernel: Kernel, socket: Socket) {
  let boundNode: string | null = null

  // ---- login: bind this socket to exactly one node ----
  socket.on('admin:hello', async (p: { nodeCode: string; token: string }, cb) => {
    const node = await prisma.node.findUnique({
      where: { code: String(p?.nodeCode ?? '') },
      include: { host: true },
    })
    if (!node || node.token !== String(p?.token ?? '') || node.status !== 'active') {
      cb?.({ ok: false, error: 'نود یافت نشد یا توکن نامعتبر است' })
      await log('warn', 'kernel', `failed admin login for "${p?.nodeCode}"`)
      return
    }
    boundNode = node.code
    kernel.adminOnline.add(node.code)
    socket.join(adminRoom(node.code))

    const mailbox = await replayMailbox(node.code)
    cb?.({
      ok: true,
      node: {
        code: node.code,
        name: node.name,
        isDemo: node.isDemo,
        host: { code: node.host.code, name: node.host.name },
      },
      mailbox,
    })
    await log('info', 'kernel', `admin connected to "${node.code}"`)
    // Publish our updated roster to peers ASAP
    void kernel.heartbeatOnce()
  })

  // ---- send an NHP envelope from the bound node ----
  socket.on('nhp:send', async (p: {
    to: NhpAddress
    module: string
    type: string
    payload: unknown
  }, cb) => {
    if (!boundNode) return cb?.({ ok: false, error: 'ابتدا به نود متصل شوید' })
    const env = makeEnvelope({
      type: String(p?.type ?? ''),
      module: String(p?.module ?? ''),
      from: { host: kernel.self.code, node: boundNode },
      to: p?.to ?? { host: '*', node: '*' },
      payload: p?.payload ?? {},
    })
    const outcome = await kernel.route(env, 'local')
    cb?.({ ok: outcome !== 'rejected', envId: env.id, outcome })
  })

  // ---- module history queries (read models over the mailbox) ----
  socket.on('chat:history', async (p: { peerHost: string; peerNode: string }, cb) => {
    if (!boundNode) return cb?.({ ok: false, items: [] })
    const items = await chatHistory(
      boundNode,
      String(p?.peerHost ?? ''),
      String(p?.peerNode ?? ''),
    )
    cb?.({ ok: true, items })
  })

  socket.on('mailbox:list', async (p: { status?: string }, cb) => {
    if (!boundNode) return cb?.({ ok: false, items: [] })
    cb?.({ ok: true, items: await listMailbox(boundNode, p?.status) })
  })

  socket.on('mailbox:clear', async (_p, cb) => {
    if (!boundNode) return cb?.({ ok: false })
    await clearMailbox(boundNode)
    cb?.({ ok: true })
    await log('info', 'kernel', `mailbox cleared for "${boundNode}"`)
  })

  // ---- federation ----
  socket.on('net:refresh', async (_p, cb) => {
    await kernel.heartbeatOnce()
    cb?.({ ok: true, directory: await kernel.getDirectory() })
  })

  socket.on('disconnect', async () => {
    if (boundNode) {
      kernel.adminOnline.delete(boundNode)
      await log('info', 'kernel', `admin of "${boundNode}" went offline (node stays online)`)
      void kernel.heartbeatOnce()
    }
  })
}

/** Socket.io room name of a node's admin session — single source shared with the kernel. */
export const adminRoom = (nodeCode: string) => `node:${nodeCode}`
