/**
 * contacts module — the node's PERSONAL address book.
 *
 * The two books must never be confused:
 *   - The NETWORK DIRECTORY is what the network knows: ephemeral, shared,
 *     and unbounded — at internet scale nobody can enumerate it.
 *   - CONTACTS are what ONE user knows: personal, persistent, curated,
 *     hard-bounded.
 *
 * Scale axioms (this is the module's whole design):
 *  1. ZERO protocol traffic — add/read/remove never leaves this host.
 *     No gossip, no replication, no sync, no notification. A billion
 *     users keep a billion private books at zero network cost; the only
 *     stored state is O(contacts) per node with a hard cap.
 *  2. Address-first, presence-second — you may save `user@host` for a
 *     host this kernel has NEVER heard of (the phone-book model).
 *     Resolution happens at SEND time via NHP routing + well-known
 *     discovery, never at save time.
 *  3. Presence is COMPUTED at read time from the kernel directory — one
 *     pass, one Map lookup per contact — and never stored, so it can
 *     never go stale.
 *
 * App API (served by the kernel at nodes/<id>/apps/contacts/*, after the
 * web proxy verified node ownership):
 *
 *   GET  list?q=                          → contacts + live presence
 *   POST add    {host, node, name?, note?} → upsert (idempotent)
 *   POST update {host, node, name?, note?, pinned?}
 *   POST remove {host, node}
 *
 * onMessage is a deliberate no-op: your address book is yours — nobody
 * is notified when they are saved, and nothing about it ever crosses
 * the wire (privacy by construction).
 */
import { defineModule } from '../interfaces'
import type { INodeContext } from '../interfaces'

const CONTACTS_KEEP = 500 // hard cap per node — explicit error, never silent eviction

/** Same charset rule as usernames: no `|` (storage-key separator), no control chars. */
const ADDR_RE = /^[^|\u0000-\u001f\u007f]{1,64}$/

interface Peer {
  host: string
  node: string
}

interface Contact {
  host: string
  node: string
  /** Optional display alias — the node id stays the address of record. */
  name?: string
  note?: string
  pinned?: boolean
  addedAt: number
}

const cKey = (p: Peer) => `contact:${p.host}|${p.node}`
const parseCKey = (key: string): Peer | null => {
  const m = /^contact:([^|]+)\|(.+)$/.exec(key)
  return m ? { host: m[1], node: m[2] } : null
}

const isPeer = (v: unknown): v is Peer =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Peer).host === 'string' &&
  (v as Peer).host.length > 0 &&
  typeof (v as Peer).node === 'string' &&
  (v as Peer).node.length > 0

const validAddr = (s: string) => ADDR_RE.test(s)
const isSelf = (ctx: INodeContext, p: Peer) =>
  p.host === ctx.node.hostCode && p.node === ctx.node.code

/** Trim + clamp an optional string field; '' means "clear the field". */
function clampStr(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  return String(v).trim().slice(0, max)
}

function parsePeer(body: Record<string, unknown>): Peer | null {
  const peer = { host: String(body.host ?? '').trim(), node: String(body.node ?? '').trim() }
  if (!isPeer(peer) || !validAddr(peer.host) || !validAddr(peer.node)) return null
  return peer
}

const badAddr = {
  status: 422,
  json: {
    ok: false,
    error: 'آدرس نامعتبر است — میزبان و شناسه هر باید ۱ تا ۶۴ نویسه باشند و | نداشته باشند',
  },
} as const

/** Public shape of a contact row (no presence — the list computes it live). */
const pub = (c: Contact) => ({
  host: c.host,
  node: c.node,
  name: c.name ?? '',
  note: c.note ?? '',
  pinned: !!c.pinned,
  addedAt: c.addedAt,
})

export default defineModule({
  id: 'contacts',
  name: 'مخاطبین / Contacts',
  version: '1.0.0',
  description:
    'دفترچهٔ مخاطبین شخصی هر نود — ذخیرهٔ دائمی آدرس کاربران (حتی سرورهایی که هنوز به شبکه نیامده‌اند)، نام مستعار، یادداشت، نشانک و حضور زنده از دفترچهٔ شبکه؛ صفر ترافیک شبکه',
  author: 'core',

  // The address book has no wire behavior by design. Direct envelopes to
  // this module (protocol noise) are dropped silently.
  async onMessage() {
    return null
  },

  // ---- the app API served to the node's owner ----
  async onApi(req, ctx) {
    const me = { host: ctx.node.hostCode, node: ctx.node.code, name: ctx.node.name }

    // ---- GET list?q= : bounded list + live presence ----
    if (req.method === 'GET' && req.path === 'list') {
      const q = (req.query.q ?? '').trim().toLowerCase()
      const keys = await ctx.storage.keys()
      const rows: Contact[] = []
      for (const k of keys) {
        const peer = parseCKey(k)
        if (!peer) continue
        const c = await ctx.storage.get<Contact>(k)
        if (isPeer(c)) rows.push({ ...c, host: peer.host, node: peer.node })
      }

      // Presence enrichment: ONE directory pass, O(1) Map lookup per
      // contact. Never a per-contact network query, never stored.
      const dir = await ctx.directory()
      const byAddr = new Map(dir.map((d) => [`${d.hostCode}|${d.nodeCode}`, d]))

      let contacts = rows.map((c) => {
        const d = byAddr.get(`${c.host}|${c.node}`) ?? null
        return {
          ...pub(c),
          presence: {
            /** In the live network directory right now? */
            known: !!d,
            /** Owner of the peer node currently has their panel open. */
            online: d?.adminOnline ?? false,
            /** Peer can be messaged right now (chat enabled on their node). */
            hasChat: d?.modules.includes('chat') ?? false,
            hostName: d?.hostName ?? c.host,
          },
        }
      })

      if (q)
        contacts = contacts.filter((c) => `${c.name} ${c.node} ${c.host}`.toLowerCase().includes(q))

      contacts.sort(
        (a, b) =>
          (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1) ||
          a.name.localeCompare(b.name, 'fa') ||
          a.node.localeCompare(b.node, 'fa'),
      )
      return { json: { ok: true, me, total: contacts.length, contacts } }
    }

    // ---- POST add {host, node, name?, note?} : upsert, idempotent ----
    if (req.method === 'POST' && req.path === 'add') {
      const body = (req.body ?? {}) as Record<string, unknown>
      const peer = parsePeer(body)
      if (!peer) return badAddr
      if (isSelf(ctx, peer))
        return {
          status: 422,
          json: { ok: false, error: 'خودتان را نمی‌توانید به مخاطبین اضافه کنید' },
        }

      const name = clampStr(body.name, 60)
      const note = clampStr(body.note, 200)
      const k = cKey(peer)

      // Upsert — address books merge, they don't duplicate. Existing rows
      // keep their pinned/addedAt; only provided fields are overwritten.
      const existing = await ctx.storage.get<Contact>(k)
      if (isPeer(existing)) {
        const merged: Contact = {
          ...existing,
          host: peer.host,
          node: peer.node,
          ...(name !== undefined ? { name: name || undefined } : {}),
          ...(note !== undefined ? { note: note || undefined } : {}),
        }
        await ctx.storage.set(k, merged)
        return { json: { ok: true, alreadyExisted: true, contact: pub(merged) } }
      }

      // Hard cap — an explicit error beats silent eviction of people.
      const keys = await ctx.storage.keys()
      if (keys.length >= CONTACTS_KEEP)
        return {
          status: 422,
          json: {
            ok: false,
            error: `دفترچهٔ شما پر است (سقف ${CONTACTS_KEEP} مخاطب) — چند مخاطب کم‌استفاده را حذف کنید`,
          },
        }

      const c: Contact = {
        host: peer.host,
        node: peer.node,
        pinned: false,
        addedAt: Date.now(),
        ...(name ? { name } : {}),
        ...(note ? { note } : {}),
      }
      await ctx.storage.set(k, c)
      ctx.logger.info(`contact added: ${peer.node}@${peer.host}`)
      return { json: { ok: true, alreadyExisted: false, contact: pub(c) } }
    }

    // ---- POST update {host, node, name?, note?, pinned?} ----
    if (req.method === 'POST' && req.path === 'update') {
      const body = (req.body ?? {}) as Record<string, unknown>
      const peer = parsePeer(body)
      if (!peer) return badAddr
      const k = cKey(peer)
      const existing = await ctx.storage.get<Contact>(k)
      if (!isPeer(existing))
        return { status: 404, json: { ok: false, error: 'این مخاطب در دفترچهٔ شما نیست' } }

      const name = clampStr(body.name, 60)
      const note = clampStr(body.note, 200)
      const pinned = typeof body.pinned === 'boolean' ? body.pinned : undefined

      const updated: Contact = { ...existing, host: peer.host, node: peer.node }
      if (name !== undefined) {
        if (name) updated.name = name
        else delete updated.name
      }
      if (note !== undefined) {
        if (note) updated.note = note
        else delete updated.note
      }
      if (pinned !== undefined) updated.pinned = pinned
      await ctx.storage.set(k, updated)
      return { json: { ok: true, contact: pub(updated) } }
    }

    // ---- POST remove {host, node} ----
    if (req.method === 'POST' && req.path === 'remove') {
      const body = (req.body ?? {}) as Record<string, unknown>
      const peer = parsePeer(body)
      if (!peer) return badAddr
      await ctx.storage.delete(cKey(peer))
      return { json: { ok: true } }
    }

    return { status: 404, json: { ok: false, error: `no contacts api: ${req.method} ${req.path}` } }
  },
})
