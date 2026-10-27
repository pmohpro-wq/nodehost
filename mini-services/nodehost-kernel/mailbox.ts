/**
 * mailbox.ts — the ONE home of NhpMessage row persistence.
 *
 * The envelope store doubles as:
 *  - the offline mailbox (direction=in, status=queued → waits for admin)
 *  - the outbound forward queue (direction=out, status=queued → retried)
 *  - the observability log of every routed envelope
 *
 * Before this module existed, row construction was copy-pasted in four
 * places inside kernel.ts and the socket handlers. Now the kernel only
 * states *what happened* (inbound delivered/queued, outbound forwarded/
 * queued) and this module owns *how it is stored*.
 */
import type { NhpEnvelope } from '../../src/core/nodehost/protocol'
import { CHAT_HISTORY, MAILBOX_LIST, MAILBOX_REPLAY } from './config'
import { prisma } from './store'

/** Shared column mapping for every persisted envelope row. */
function rowBase(env: NhpEnvelope) {
  return {
    envId: env.id,
    module: env.module,
    type: env.type,
    fromHost: env.from.host,
    fromNode: env.from.node,
    toHost: env.to.host,
    payload: JSON.stringify(env.payload ?? {}),
    envelope: JSON.stringify(env),
  }
}

/**
 * Persist an inbound envelope for one local target node.
 * Delivered immediately when the admin is online, otherwise it waits
 * in the mailbox (admins MAY go offline — nodes never do).
 */
export async function recordInbound(
  env: NhpEnvelope,
  opts: { toNode: string; adminOnline: boolean; senderIsLocal: boolean },
) {
  return prisma.nhpMessage.create({
    data: {
      ...rowBase(env),
      toNode: opts.toNode,
      channel: opts.senderIsLocal ? 'local' : 'remote',
      direction: 'in',
      status: opts.adminOnline ? 'delivered' : 'queued',
      deliveredAt: opts.adminOnline ? new Date() : null,
    },
  })
}

/** True when this envelope id was already persisted for the node (at-least-once guard). */
export async function alreadyDelivered(envId: string, toNode: string, moduleId: string) {
  const dup = await prisma.nhpMessage.findFirst({
    where: { envId, toNode, direction: 'in', module: moduleId },
    select: { id: true },
  })
  return !!dup
}

/** Persist (or update, when retrying an existing row) an outbound forward result. */
export async function recordOutbound(
  env: NhpEnvelope,
  status: 'forwarded' | 'queued',
  opts: { error?: string; existingRowId?: string },
): Promise<void> {
  const error = opts.error ? { error: opts.error.slice(0, 500) } : {}
  if (opts.existingRowId) {
    await prisma.nhpMessage.update({
      where: { id: opts.existingRowId },
      data: {
        status,
        ...error,
        ...(status === 'forwarded' ? { deliveredAt: new Date() } : {}),
      },
    })
    return
  }
  await prisma.nhpMessage.create({
    data: {
      ...rowBase(env),
      toNode: env.to.node,
      channel: 'remote',
      direction: 'out',
      status,
      attempts: 1,
      ...error,
      ...(status === 'forwarded' ? { deliveredAt: new Date() } : {}),
    },
  })
}

/** A retry row finally reached its host. */
export async function markRowForwarded(rowId: string) {
  await prisma.nhpMessage.update({
    where: { id: rowId },
    data: { status: 'forwarded', error: null, deliveredAt: new Date() },
  })
}

/** A retry row is corrupt / its host vanished — stop trying. */
export async function markRowDead(rowId: string, error: string) {
  await prisma.nhpMessage
    .update({ where: { id: rowId }, data: { status: 'dead', error: error.slice(0, 500) } })
    .catch(() => {})
}

/** One more failed attempt on a queued row; dead-letter at the cap. */
export async function bumpRowAttempt(
  rowId: string,
  currentAttempts: number,
  maxAttempts: number,
  error: string,
): Promise<'retry' | 'dead'> {
  const attempts = currentAttempts + 1
  await prisma.nhpMessage.update({
    where: { id: rowId },
    data: {
      attempts,
      error: error.slice(0, 500),
      ...(attempts >= maxAttempts ? { status: 'dead' } : {}),
    },
  })
  return attempts >= maxAttempts ? 'dead' : 'retry'
}

// ------------------------------------------------------------
// Read helpers (admin socket + REST control-plane)
// ------------------------------------------------------------

/** Full inbound mailbox replay for a just-connected admin (oldest first). */
export async function replayMailbox(nodeCode: string) {
  const rows = await prisma.nhpMessage.findMany({
    where: { toNode: nodeCode, direction: 'in' },
    orderBy: { createdAt: 'desc' },
    take: MAILBOX_REPLAY,
  })
  return rows.reverse()
}

/** Filtered mailbox list (admin console + REST). */
export async function listMailbox(nodeCode: string, status?: string) {
  return prisma.nhpMessage.findMany({
    where: { toNode: nodeCode, direction: 'in', ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: MAILBOX_LIST,
  })
}

/** Direct node-to-node conversation (chat module). */
export async function chatHistory(nodeCode: string, peerHost: string, peerNode: string) {
  return prisma.nhpMessage.findMany({
    where: {
      module: 'chat',
      type: 'chat.message',
      OR: [
        { fromHost: peerHost, fromNode: peerNode, toNode: nodeCode },
        { fromNode: nodeCode, toHost: peerHost, toNode: peerNode },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: CHAT_HISTORY,
  })
}

/** Broadcast posts received by a node. */
export async function broadcastHistory(nodeCode: string) {
  return prisma.nhpMessage.findMany({
    where: { toNode: nodeCode, module: 'broadcast' },
    orderBy: { createdAt: 'desc' },
    take: MAILBOX_LIST,
  })
}

/** Wipe a node's inbound mailbox (admin action). */
export async function clearMailbox(nodeCode: string) {
  await prisma.nhpMessage.deleteMany({ where: { toNode: nodeCode, direction: 'in' } })
}
