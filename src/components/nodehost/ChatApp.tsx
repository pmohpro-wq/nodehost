'use client'

/**
 * ChatApp — the node's ONE app, mounted when the owner enables the
 * messenger module. A real two-way messenger:
 *
 *  - the conversation list is the OWNER'S CONTACTS (Request 6: «فقط
 *    مخاطبین در پیام‌رسان») — the personal address book, not the raw
 *    network directory; conversations with non-contact peers still
 *    appear as marked rows so history is never hidden;
 *  - when the contacts module is off, the list falls back to the
 *    chat-enabled nodes of the directory (chat alone still works);
 *  - history and unread counts are the module's own app state, served
 *    by the kernel at nodes/<id>/apps/chat/*;
 *  - every message is a real NHP envelope (kernel-routed, federated,
 *    store-and-forward when a host is down).
 *
 * Live updates ride a 2.5s poll (conversations + the open thread).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, RefreshCw, SendHorizontal, UserPlus, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { nhGet, nhPost } from './api'
import { useNh } from './store'
import type { NodeDto } from './types'

interface Peer {
  host: string
  node: string
}

interface ChatMsg {
  id: string
  dir: 'in' | 'out'
  text: string
  at: number
}

interface Contact {
  host: string
  hostName: string
  node: string
  name: string
  online: boolean
}

interface Conversation {
  peer: Peer
  last: { text: string; at: number; dir: 'in' | 'out' }
  unread: number
}

interface BookRow {
  host: string
  node: string
  name: string
  presence: { known: boolean; online: boolean; hasChat: boolean; hostName: string }
}

interface BookReply {
  ok: boolean
  contacts: BookRow[]
}

interface ConvReply {
  ok: boolean
  me: { host: string; node: string; name: string }
  contacts: Contact[]
  conversations: Conversation[]
}

interface MsgsReply {
  ok: boolean
  items: ChatMsg[]
}

const peerKey = (p: Peer) => `${p.host}/${p.node}`
const clockOf = (at: number) =>
  new Date(at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })

export function ChatApp({ node }: { node: NodeDto }) {
  const { toast } = useToast()
  const base = `nodes/${node.id}/apps/chat`
  const chatFocus = useNh((s) => s.chatFocus)
  const clearChatFocus = useNh((s) => s.clearChatFocus)
  // The contacts app can deep-link INTO the messenger — only when the
  // address book is itself enabled (its app API would 409 otherwise).
  const contactsOn = node.moduleStates.some((s) => s.moduleId === 'contacts' && s.enabled)

  const [convs, setConvs] = useState<Conversation[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [book, setBook] = useState<BookRow[]>([])
  const [me, setMe] = useState<ConvReply['me'] | null>(null)
  const [selected, setSelected] = useState<Peer | null>(null)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef<Peer | null>(null)
  selectedRef.current = selected

  // ---- data loaders (module app API) ----
  const loadConvs = useCallback(async () => {
    try {
      const res = await nhGet<ConvReply>(`${base}/conversations`)
      setConvs(res.conversations ?? [])
      setContacts(res.contacts ?? [])
      setMe(res.me ?? null)
    } catch {
      /* kernel hiccup — next tick retries */
    } finally {
      setLoading(false)
    }
  }, [base])

  // Request 6: when the address book is enabled, THE BOOK is the
  // messenger's list — fetched straight from the contacts app API.
  const loadBook = useCallback(async () => {
    if (!contactsOn) return
    try {
      const res = await nhGet<BookReply>(`nodes/${node.id}/apps/contacts/list`)
      setBook(res.contacts ?? [])
    } catch {
      /* transient — next tick retries */
    }
  }, [contactsOn, node.id])

  const loadMsgs = useCallback(
    async (peer: Peer) => {
      try {
        const res = await nhGet<MsgsReply>(
          `${base}/messages?host=${encodeURIComponent(peer.host)}&node=${encodeURIComponent(peer.node)}`,
        )
        // Ignore stale replies after switching peers mid-flight.
        const cur = selectedRef.current
        if (cur && peerKey(cur) === peerKey(peer)) setMsgs(res.items ?? [])
      } catch {
        /* transient */
      }
    },
    [base],
  )

  // Initial + polling loop (conversations + open thread + the book).
  useEffect(() => {
    void loadConvs()
    void loadBook()
    const t = setInterval(() => {
      void loadConvs()
      void loadBook()
      if (selectedRef.current) void loadMsgs(selectedRef.current)
    }, 2500)
    return () => clearInterval(t)
  }, [loadConvs, loadBook, loadMsgs])

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs])

  const open = useCallback(
    (peer: Peer) => {
      setSelected(peer)
      setMsgs([])
      void loadMsgs(peer)
    },
    [loadMsgs],
  )

  // Deep link from the contacts app (tab-scoped store signal).
  useEffect(() => {
    if (chatFocus) {
      open({ host: chatFocus.host, node: chatFocus.node })
      clearChatFocus()
    }
  }, [chatFocus, open, clearChatFocus])

  const send = async () => {
    if (!selected || !text.trim() || sending) return
    setSending(true)
    try {
      const res = await nhPost<{ ok: boolean; outcome: string }>(`${base}/send`, {
        to: selected,
        text: text.trim(),
      })
      setText('')
      if (res.outcome === 'queued')
        toast({
          title: 'پیام ثبت شد — تحویل زنده بعداً',
          description: 'ادمین نود مقصد همین حالا آنلاین نیست؛ پیام در صندوق نود او منتظر می‌ماند و با باز شدن پنلش دیده می‌شود.',
        })
      await Promise.all([loadMsgs(selected), loadConvs()])
    } catch (err) {
      toast({ title: 'ارسال ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  const saveToContacts = async () => {
    if (!selected) return
    try {
      const res = await nhPost<{ ok: boolean; alreadyExisted: boolean }>(
        `nodes/${node.id}/apps/contacts/add`,
        { host: selected.host, node: selected.node, name: selectedPeer?.name ?? '' },
      )
      toast({
        title: res.alreadyExisted ? 'از قبل در مخاطبین شما بود' : 'به مخاطبین اضافه شد',
      })
    } catch (err) {
      toast({ title: 'افزودن به مخاطبین ناموفق بود', description: String(err), variant: 'destructive' })
    }
  }

  // The messenger's list (Request 6): the owner's contacts when the
  // address book is enabled — directory otherwise; conversations with
  // peers missing from the source list stay visible as marked rows.
  const listRows: Contact[] = contactsOn
    ? book.map((b) => ({
        host: b.host,
        hostName: b.presence.hostName ?? b.host,
        node: b.node,
        name: b.name || b.node,
        online: b.presence.online,
      }))
    : contacts
  const convByPeer = new Map(convs.map((c) => [peerKey(c.peer), c]))
  const rows: (Contact | { node: string; host: string; orphan: true; conv: Conversation })[] = [
    ...listRows,
    ...convs
      .filter((c) => !listRows.some((ct) => peerKey(ct) === peerKey(c.peer)))
      .map((c) => ({ node: c.peer.node, host: c.peer.host, orphan: true as const, conv: c })),
  ]
  const totalUnread = convs.reduce((a, c) => a + c.unread, 0)
  const selectedPeer = selected
    ? (listRows.find((c) => peerKey(c) === peerKey(selected)) ?? null)
    : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-5" /> پیام‌رسان
          {totalUnread > 0 && (
            <Badge className="mr-1">
              {totalUnread} خوانده‌نشده
            </Badge>
          )}
          {loading && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[280px_1fr]">
        {/* ---- directory / conversations column ---- */}
        <div className="rounded-xl border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
            <Users className="size-3.5" /> {contactsOn ? 'مخاطبین' : 'دفترچه شبکه'}
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground leading-6 px-4 py-6 text-center">
                {contactsOn
                  ? 'هنوز مخاطبی ندارید — از اپ «مخاطبین» آیدی یک کاربر را ذخیره کنید تا همین‌جا بیاید.'
                  : 'هنوز نود دیگری در شبکه نیست. برای تست، در مرورگر دوم با «ورود سریع» کاربر دومی بسازید — نود او بلافاصله همین‌جا ظاهر می‌شود.'}
              </p>
            ) : (
              rows.map((r) => {
                const conv = 'orphan' in r ? r.conv : convByPeer.get(peerKey(r))
                const peer = 'orphan' in r ? r.conv.peer : { host: r.host, node: r.node }
                const name = 'orphan' in r ? r.node : r.name
                const hostName = 'orphan' in r ? r.conv.peer.host : r.hostName
                const online = 'orphan' in r ? false : r.online
                const isSel = selected && peerKey(selected) === peerKey(peer)
                return (
                  <button
                    key={peerKey(peer)}
                    onClick={() => open(peer)}
                    className={`w-full text-right px-3 py-2.5 flex items-center gap-3 transition-colors hover:bg-muted/60 ${
                      isSel ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="size-9 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-bold">
                        {name.slice(0, 1)}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -left-0.5 size-3 rounded-full border-2 border-background ${
                          online ? 'bg-emerald-500' : 'bg-zinc-400'
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate">{name}</span>
                        {'orphan' in r && (
                          <span className="text-[9px] text-muted-foreground">(چت خاموش)</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {conv ? conv.last.text : `${hostName}`}
                      </div>
                    </div>
                    {!!conv?.unread && (
                      <Badge className="shrink-0 size-5 p-0 grid place-items-center text-[10px] rounded-full">
                        {conv.unread}
                      </Badge>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* ---- thread ---- */}
        <div className="rounded-xl border flex flex-col min-h-[420px]">
          {selected ? (
            <>
              <div className="px-4 py-2.5 border-b bg-muted/50 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">
                    {selectedPeer?.name ?? selected.node}
                    {!selectedPeer && (
                      <span className="text-[10px] text-muted-foreground"> (چت خاموش)</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground" dir="ltr">
                    {selected.host}/{selected.node}
                  </div>
                </div>
                {contactsOn && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    title="افزودن به مخاطبین"
                    onClick={() => void saveToContacts()}
                  >
                    <UserPlus className="size-4" />
                  </Button>
                )}
              </div>

              <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {msgs.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    گفتگو خالی است — اولین پیام را بفرستید.
                  </p>
                ) : (
                  msgs.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.dir === 'out' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-6 ${
                          m.dir === 'out'
                            ? 'bg-primary text-primary-foreground rounded-br-md'
                            : 'bg-muted rounded-bl-md'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                        <div
                          className={`text-[10px] mt-1 ${
                            m.dir === 'out' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          }`}
                        >
                          {clockOf(m.at)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t p-3 flex gap-2">
                <Input
                  dir="auto"
                  placeholder="پیام خود را بنویسید…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void send()}
                  disabled={sending}
                />
                <Button onClick={() => void send()} disabled={sending || !text.trim()}>
                  <SendHorizontal className="size-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-center px-6">
              <div className="space-y-2 text-muted-foreground">
                <MessageCircle className="size-8 mx-auto opacity-40" />
                <p className="text-sm">
                  {rows.length === 0
                    ? 'اول یک گفتگو را از دفترچه انتخاب کنید'
                    : 'از دفترچه سمت راست یک نود را انتخاب کنید و گفتگو را شروع کنید'}
                </p>
                {me && (
                  <p className="text-[11px]" dir="ltr">
                    {me.node}@{me.host}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
