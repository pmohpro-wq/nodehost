'use client'

/**
 * ChatApp — the node's ONE app, mounted when the owner enables the
 * messenger module. A real two-way messenger:
 *
 *  - recipients come from the NETWORK DIRECTORY (every node on this
 *    host + nodes on federated hosts) — filtered to chat-enabled nodes;
 *  - history and unread counts are the module's own app state, served
 *    by the kernel at nodes/<id>/apps/chat/*;
 *  - every message is a real NHP envelope (kernel-routed, federated,
 *    store-and-forward when a host is down).
 *
 * Live updates ride a 2.5s poll (conversations + the open thread).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, RefreshCw, SendHorizontal, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { nhGet, nhPost } from './api'
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

  const [convs, setConvs] = useState<Conversation[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
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

  // Initial + polling loop (conversations + open thread).
  useEffect(() => {
    void loadConvs()
    const t = setInterval(() => {
      void loadConvs()
      if (selectedRef.current) void loadMsgs(selectedRef.current)
    }, 2500)
    return () => clearInterval(t)
  }, [loadConvs, loadMsgs])

  // Keep the thread pinned to the newest message.
  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs])

  const open = (peer: Peer) => {
    setSelected(peer)
    setMsgs([])
    void loadMsgs(peer)
  }

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

  // Contacts merged with conversation overlays (history outlives chat being
  // disabled on a peer — such rows stay visible but marked).
  const convByPeer = new Map(convs.map((c) => [peerKey(c.peer), c]))
  const rows: (Contact | { node: string; host: string; orphan: true; conv: Conversation })[] = [
    ...contacts,
    ...convs
      .filter((c) => !contacts.some((ct) => peerKey(ct) === peerKey(c.peer)))
      .map((c) => ({ node: c.peer.node, host: c.peer.host, orphan: true as const, conv: c })),
  ]
  const totalUnread = convs.reduce((a, c) => a + c.unread, 0)
  const selectedPeer = selected
    ? (contacts.find((c) => peerKey(c) === peerKey(selected)) ?? null)
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
            <Users className="size-3.5" /> دفترچه شبکه
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground leading-6 px-4 py-6 text-center">
                هنوز نود دیگری در شبکه نیست. برای تست، در مرورگر دوم با «ورود سریع» کاربر دومی
                بسازید — نود او بلافاصله همین‌جا ظاهر می‌شود.
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
              <div className="px-4 py-2.5 border-b bg-muted/50">
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
