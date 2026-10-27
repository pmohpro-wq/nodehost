'use client'

/**
 * ConsoleTab — the admin console.
 * An admin binds to EXACTLY ONE node (per the architecture law) using
 * its token, over socket.io. The node stays online; the admin may leave.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useNh } from './store'
import { ago, clockOf } from './api'
import { SectionTitle, StatusBadge, StatusDot, EmptyHint, CodeBlock } from './bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  PlugZap,
  Unplug,
  SendHorizontal,
  Megaphone,
  Gauge,
  FileJson2,
  Trash2,
  RefreshCw,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConsoleSession, DirectoryEntry, MailRow } from './types'
import { STATUS_FA } from './types'

type ConnState = 'idle' | 'connecting' | 'connected' | 'error'
type Envelope = Record<string, unknown>

interface PingResult {
  peer: string
  ms: number
  at: string
  served: number
}

export function ConsoleTab() {
  const { data, session, setSession } = useNh()
  const { toast } = useToast()

  // ---- connect form state ----
  const [hostCode, setHostCode] = useState('')
  const [nodeCode, setNodeCode] = useState('')
  const [token, setToken] = useState('')

  const connectable = useMemo(() => {
    if (!data) return []
    const list = [
      { code: data.host.code, name: data.host.name, gwPort: data.host.gwPort, kind: 'local' },
      ...data.hosts.filter((h) => h.gwPort).map((h) => ({ code: h.code, name: h.name, gwPort: h.gwPort, kind: 'remote' })),
    ]
    return list
  }, [data])

  // Effective host = user choice, else first connectable (derived state — no effect needed)
  const effHostCode = hostCode || connectable[0]?.code || ''

  const nodeListForHost = useMemo(() => {
    if (!data || !effHostCode) return []
    if (effHostCode === data.host.code) {
      return data.nodes.map((n) => ({ code: n.code, name: n.name, demoToken: n.isDemo ? n.token : undefined }))
    }
    return data.directory
      .filter((d) => d.hostCode === effHostCode)
      .map((d) => ({
        code: d.nodeCode,
        name: d.nodeName,
        demoToken: d.demoToken,
      }))
  }, [data, effHostCode])

  const connect = () => {
    const host = connectable.find((h) => h.code === effHostCode)
    if (!host || !nodeCode.trim() || !token.trim()) return
    setSession({
      hostCode: host.code,
      hostName: host.name,
      gwPort: host.gwPort,
      nodeCode: nodeCode.trim(),
      nodeName: nodeListForHost.find((n) => n.code === nodeCode)?.name ?? nodeCode.trim(),
      token: token.trim(),
    })
  }

  return (
    <div className="space-y-5">
      {!session ? (
        <section>
          <SectionTitle
            icon={<PlugZap />}
            title="اتصال ادمین به نود"
            sub="هر ادمین فقط و فقط به نود خودش وصل می‌شود"
          />
          <Card>
            <CardContent className="p-4 grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">میزبان</label>
                <Select
                  value={effHostCode}
                  onValueChange={(v) => {
                    setHostCode(v)
                    setNodeCode('')
                    setToken('')
                  }}
                >
                  <SelectTrigger aria-label="انتخاب میزبان"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {connectable.map((h) => (
                      <SelectItem key={h.code} value={h.code}>
                        {h.name} {h.kind === 'remote' && '(راه‌دور)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">نود</label>
                <Select value={nodeCode} onValueChange={(v) => {
                  setNodeCode(v)
                  const demo = nodeListForHost.find((n) => n.code === v)?.demoToken
                  if (demo) setToken(demo)
                }}>
                  <SelectTrigger aria-label="انتخاب نود"><SelectValue placeholder="انتخاب نود" /></SelectTrigger>
                  <SelectContent>
                    {nodeListForHost.map((n) => (
                      <SelectItem key={n.code} value={n.code}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">توکن ادمین</label>
                <Input
                  dir="ltr"
                  className="ltr-block"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="nh_… یا demo-token-…"
                />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={connect} disabled={!nodeCode || !token}>
                  <PlugZap className="size-4" /> اتصال به نود
                </Button>
              </div>
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground mt-2">
            نودهای دمو توکن ازپیش‌شناس دارند و با انتخاب، خودکار پر می‌شوند. توکن نودهای تازه‌سازی‌شده
            را از تب «نودها» بردارید.
          </p>
        </section>
      ) : (
        <ConsoleSessionView
          key={`${session.hostCode}:${session.nodeCode}`}
          session={session}
          onDisconnect={() => setSession(null)}
        />
      )}
    </div>
  )
}

// ==============================================================
// Active session view
// ==============================================================

function ConsoleSessionView({
  session,
  onDisconnect,
}: {
  session: ConsoleSession
  onDisconnect: () => void
}) {
  const { data } = useNh()
  const { toast } = useToast()
  const socketRef = useRef<Socket | null>(null)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [mailbox, setMailbox] = useState<MailRow[]>([])
  const [live, setLive] = useState<Envelope[]>([])

  // peers = every other node in the directory
  const peers = useMemo(() => {
    if (!data) return []
    return data.directory.filter(
      (d) => !(d.hostCode === session.hostCode && d.nodeCode === session.nodeCode),
    )
  }, [data, session])

  const refreshMailbox = useCallback(() => {
    socketRef.current?.emit('mailbox:list', {}, (res: { ok: boolean; items?: MailRow[] }) => {
      if (res.ok && res.items) setMailbox(res.items)
    })
  }, [])

  // ---- socket lifecycle (binds to THIS node only) ----
  useEffect(() => {
    const url = session.gwPort ? `/?XTransformPort=${session.gwPort}` : '/'
    const s = io(url, {
      path: '/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1200,
      timeout: 8000,
      forceNew: true,
    })
    socketRef.current = s
    ;(window as unknown as { __nhSocket?: Socket }).__nhSocket = s

    s.on('connect', () => {
      s.emit(
        'admin:hello',
        { nodeCode: session.nodeCode, token: session.token },
        (res: { ok: boolean; error?: string; mailbox?: MailRow[] }) => {
          if (res.ok) {
            setConn('connected')
            setMailbox(res.mailbox ?? [])
            toast({ title: 'اتصال برقرار شد', description: `ادمینِ نود ${session.nodeCode} متصل شد` })
          } else {
            setConn('error')
            toast({ title: 'اتصال رد شد', description: res.error ?? 'توکن نامعتبر', variant: 'destructive' })
          }
        },
      )
    })
    s.on('disconnect', () => setConn('error'))
    s.on('connect_error', () => setConn('error'))
    s.on('nhp:in', (env: Envelope) => {
      setLive((prev) => [env, ...prev].slice(0, 60))
    })

    return () => {
      s.disconnect()
      socketRef.current = null
      if ((window as unknown as { __nhSocket?: Socket }).__nhSocket === s) {
        ;(window as unknown as { __nhSocket?: Socket }).__nhSocket = undefined
      }
    }
  }, [session.hostCode, session.nodeCode, session.token])

  const send = useCallback(
    (p: { to: { host: string; node: string }; module: string; type: string; payload: unknown },
     cb?: (res: { ok: boolean; outcome: string; envId: string }) => void) => {
      const s = socketRef.current
      if (!s || conn !== 'connected') {
        toast({ title: 'ادمین متصل نیست', variant: 'destructive' })
        return
      }
      s.emit('nhp:send', p, (res: { ok: boolean; outcome: string; envId: string }) => {
        if (!res.ok || res.outcome === 'rejected') {
          toast({
            title: 'پاکت مسیریابی نشد',
            description: 'مقصدها معتبر نیستند یا ماژول در نود مقصد فعال نیست',
            variant: 'destructive',
          })
        }
        cb?.(res)
      })
    },
    [conn, toast],
  )

  return (
    <div className="space-y-4">
      {/* Session header */}
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone={conn === 'connected' ? 'green' : conn === 'error' ? 'rose' : 'amber'} pulse={conn === 'connected'} />
          <div>
            <div className="font-bold text-sm">
              {session.nodeName} <span className="text-muted-foreground ltr-block inline" dir="ltr">@{session.hostCode}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {conn === 'connected'
                ? 'ادمین متصل است — نود همیشه آنلاین است'
                : conn === 'connecting'
                  ? 'در حال اتصال…'
                  : 'اتصال برقرار نیست (نود همچنان آنلاین و در حال صف‌بندی است)'}
            </div>
          </div>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={refreshMailbox}>
          <RefreshCw className="size-3.5" /> صندوق
        </Button>
        <Button variant="outline" size="sm" className="text-rose-600" onClick={onDisconnect}>
          <Unplug className="size-3.5" /> قطع اتصال ادمین
        </Button>
      </div>

      <Tabs defaultValue="chat" dir="rtl">
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="chat" className="gap-1.5"><MessageSquare className="size-3.5" /> گفتگو</TabsTrigger>
          <TabsTrigger value="board" className="gap-1.5"><Megaphone className="size-3.5" /> تابلو</TabsTrigger>
          <TabsTrigger value="ping" className="gap-1.5"><Gauge className="size-3.5" /> پینگ</TabsTrigger>
          <TabsTrigger value="raw" className="gap-1.5"><FileJson2 className="size-3.5" /> پاکت‌ها</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-4">
          <ChatPanel
            session={session}
            peers={peers}
            connected={conn === 'connected'}
            onSend={send}
            onIncoming={refreshMailbox}
          />
        </TabsContent>
        <TabsContent value="board" className="mt-4">
          <BoardPanel session={session} connected={conn === 'connected'} onSend={send} />
        </TabsContent>
        <TabsContent value="ping" className="mt-4">
          <PingPanel peers={peers} connected={conn === 'connected'} onSend={send} />
        </TabsContent>
        <TabsContent value="raw" className="mt-4">
          <RawPanel mailbox={mailbox} live={live} onRefresh={refreshMailbox} onClear={() => {
            socketRef.current?.emit('mailbox:clear', {}, () => {
              toast({ title: 'صندوق خالی شد' })
              refreshMailbox()
            })
          }} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ==============================================================
// Chat
// ==============================================================

function ChatPanel({
  session,
  peers,
  connected,
  onSend,
  onIncoming,
}: {
  session: ConsoleSession
  peers: DirectoryEntry[]
  connected: boolean
  onSend: (p: { to: { host: string; node: string }; module: string; type: string; payload: unknown }, cb?: (r: { ok: boolean; outcome: string }) => void) => void
  onIncoming: () => void
}) {
  const chatPeers = peers.filter((p) => p.modules.includes('chat'))
  // Selected peer stored as raw state (React-Compiler-friendly deps)
  const [peerHost, setPeerHost] = useState('')
  const [peerNode, setPeerNode] = useState('')
  const [text, setText] = useState('')
  const [items, setItems] = useState<MailRow[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const { toast } = useToast()

  const hasPeer = peerHost.length > 0 && peerNode.length > 0
  const peerEntry = chatPeers.find((p) => p.hostCode === peerHost && p.nodeCode === peerNode)

  const loadHistory = useCallback(() => {
    if (!peerHost || !peerNode) return
    socketRef.current?.emit(
      'chat:history',
      { peerHost, peerNode },
      (res: { ok: boolean; items?: MailRow[] }) => {
        if (res.ok) setItems(res.items ?? [])
      },
    )
  }, [peerHost, peerNode])

  // Access the session socket via a fresh connection? No — reuse the parent's
  // socket by exposing it through window-level registry (kept minimal).
  useEffect(() => {
    // parent sets window.__nhSocket for panels; simplest shared handle
    socketRef.current = (window as unknown as { __nhSocket?: Socket }).__nhSocket ?? null
  }, [connected])

  useEffect(() => {
    // subscribe to incoming chat envelopes for this conversation
    // (re-subscribes when the socket connects — parent sets window.__nhSocket)
    const s = (window as unknown as { __nhSocket?: Socket }).__nhSocket
    if (!s || !connected) return
    const handler = (env: { type: string; module: string; fromHost: string; fromNode: string; toNode: string }) => {
      if (env.type !== 'chat.message') return
      if (peerHost && env.fromHost === peerHost && env.fromNode === peerNode) {
        setTimeout(loadHistory, 150)
        onIncoming()
      }
    }
    s.on('nhp:in', handler)
    return () => {
      s.off('nhp:in', handler)
    }
  }, [connected, peerHost, peerNode, loadHistory, onIncoming])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [items])

  const sendMsg = () => {
    if (!peerEntry || !text.trim()) return
    onSend(
      {
        to: { host: peerEntry.hostCode, node: peerEntry.nodeCode },
        module: 'chat',
        type: 'chat.message',
        payload: { text: text.trim() },
      },
      (res) => {
        if (res.ok) {
          setText('')
          setTimeout(loadHistory, 250)
        }
      },
    )
  }

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-3">
      {/* Peer list */}
      <Card>
        <CardContent className="p-2">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">نودهای قابل گفتگو (ماژول chat فعال دارند)</div>
          {chatPeers.length === 0 && <div className="p-3 text-xs text-muted-foreground">هنوز هیچ نودی در دایرکتوری نیست.</div>}
          <div className="space-y-1 max-h-72 overflow-y-auto nh-scroll">
            {chatPeers.map((p) => (
              <button
                key={`${p.hostCode}:${p.nodeCode}`}
                onClick={() => {
                  setPeerHost(p.hostCode)
                  setPeerNode(p.nodeCode)
                }}
                className={cn(
                  'w-full text-right rounded-lg px-2.5 py-2 transition-colors',
                  peerHost === p.hostCode && peerNode === p.nodeCode
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-muted border border-transparent',
                )}
              >
                <div className="text-xs font-medium flex items-center gap-1.5">
                  <StatusDot tone={p.adminOnline ? 'green' : 'slate'} pulse={p.adminOnline} />
                  <span className="truncate">{p.nodeName}</span>
                </div>
                <div className="text-[10px] text-muted-foreground ltr-block" dir="ltr">
                  {p.nodeCode}@{p.hostCode}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Conversation */}
      <Card className="flex flex-col min-h-[380px]">
        <CardContent className="p-0 flex flex-col flex-1">
          <div className="px-4 py-2.5 border-b text-sm font-medium flex items-center gap-2">
            {peerEntry ? (
              <>
                <MessageSquare className="size-4 text-primary" />
                گفتگو با {peerEntry.nodeName}
                <span className="text-[10px] text-muted-foreground ltr-block" dir="ltr">
                  {peerEntry.nodeCode}@{peerEntry.hostCode}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-xs">یک نود را از فهرست انتخاب کنید</span>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto nh-scroll p-4 space-y-2 min-h-[280px] max-h-[420px]">
            {items.length === 0 && (
              <EmptyHint>
                پیامی نیست. اولین پیام را بفرستید — اگر ادمین مقصد غایب باشد، پیام در صندوق نود او می‌ماند.
              </EmptyHint>
            )}
            {items.map((m) => {
              const mine = m.direction === 'out'
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-start' : 'justify-end')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                      mine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm',
                    )}
                  >
                    <div className="leading-6 whitespace-pre-wrap break-words">
                      {safeParse<{ text?: string }>(m.payload).text ?? '—'}
                    </div>
                    <div className={cn('text-[9px] mt-0.5 flex items-center gap-1', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                      <span className="tabular-nums">{clockOf(m.createdAt)}</span>
                      {m.status === 'queued' && <span>· در انتظار ادمین مقصد</span>}
                      {m.status === 'dead' && <span>· منقضی</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <Separator />
          <div className="p-3 flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMsg()}
              placeholder={peerEntry ? 'پیام… (Enter برای ارسال)' : 'ابتدا نود مقصد را انتخاب کنید'}
              disabled={!peerEntry || !connected}
            />
            <Button onClick={sendMsg} disabled={!peerEntry || !connected || !text.trim()} aria-label="ارسال پیام">
              <SendHorizontal className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ==============================================================
// Broadcast board
// ==============================================================

function BoardPanel({
  session,
  connected,
  onSend,
}: {
  session: ConsoleSession
  connected: boolean
  onSend: (p: { to: { host: string; node: string }; module: string; type: string; payload: unknown }, cb?: (r: { ok: boolean; outcome: string }) => void) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [items, setItems] = useState<MailRow[]>([])
  const { toast } = useToast()

  const load = useCallback(() => {
    const s = (window as unknown as { __nhSocket?: Socket }).__nhSocket
    s?.emit('broadcast:history', {}, (res: { ok: boolean; items?: MailRow[] }) => {
      if (res.ok) setItems(res.items ?? [])
    })
  }, [])

  useEffect(() => {
    load()
    const s = (window as unknown as { __nhSocket?: Socket }).__nhSocket
    if (!s || !connected) return
    const h = (env: { type: string }) => env.type.startsWith('broadcast.') && setTimeout(load, 150)
    s.on('nhp:in', h)
    return () => {
      s.off('nhp:in', h)
    }
  }, [connected, load])

  const publish = () => {
    if (!title.trim()) return
    onSend(
      {
        to: { host: '*', node: '*' },
        module: 'broadcast',
        type: 'broadcast.publish',
        payload: { title: title.trim(), body: body.trim(), origin: `${session.nodeCode}@${session.hostCode}` },
      },
      (res) => {
        if (res.ok) {
          toast({ title: 'اعلان منتشر شد', description: `نتیجه: ${STATUS_FA[res.outcome] ?? res.outcome}` })
          setTitle('')
          setBody('')
          setTimeout(load, 300)
        }
      },
    )
  }

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Megaphone className="size-4 text-primary" /> انتشار اعلان همگانی
          </div>
          <p className="text-[11px] text-muted-foreground leading-5">
            اعلان با آدرس <code dir="ltr" className="ltr-block">(*,*)</code> منتشر می‌شود؛ هستهٔ شما به
            همهٔ میزبان‌های شناخته‌شده فوروارد می‌کند و هر هسته آن را به نودهایی که ماژول broadcast
            دارند می‌رساند.
          </p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان اعلان" disabled={!connected} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن اعلان (اختیاری)" rows={3} disabled={!connected} />
          <Button className="w-full" onClick={publish} disabled={!connected || !title.trim()}>
            <SendHorizontal className="size-4" /> انتشار در کل شبکه
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-3">اعلان‌های دریافت‌شده توسط این نود</div>
          {items.length === 0 ? (
            <EmptyHint>هنوز اعلانی دریافت نشده است.</EmptyHint>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto nh-scroll">
              {items.map((m) => {
                const p = safeParse<{ title?: string; body?: string; origin?: string }>(m.payload)
                return (
                  <div key={m.id} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm">{p.title}</div>
                      <StatusBadge status={m.status} label={STATUS_FA[m.status]} />
                    </div>
                    {p.body && <p className="text-xs text-muted-foreground leading-5 whitespace-pre-wrap">{p.body}</p>}
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <span dir="ltr" className="ltr-block">{p.origin ?? `${m.fromNode}@${m.fromHost}`}</span>
                      <span>·</span>
                      <span>{ago(m.createdAt)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ==============================================================
// Ping
// ==============================================================

function PingPanel({
  peers,
  connected,
  onSend,
}: {
  peers: DirectoryEntry[]
  connected: boolean
  onSend: (p: { to: { host: string; node: string }; module: string; type: string; payload: unknown }, cb?: (r: { ok: boolean; outcome: string }) => void) => void
}) {
  const pingPeers = peers.filter((p) => p.modules.includes('ping'))
  const [peer, setPeer] = useState('')
  const [results, setResults] = useState<PingResult[]>([])
  const [waiting, setWaiting] = useState(false)

  const peerEntry = pingPeers.find((p) => `${p.hostCode}:${p.nodeCode}` === peer)

  useEffect(() => {
    const s = (window as unknown as { __nhSocket?: Socket }).__nhSocket
    if (!s || !connected) return
    const h = (env: { type: string; replyTo?: string; payload?: { sentAt?: number; repliedAt?: number; served?: number; node?: { code: string; host: string } } }) => {
      if (env.type !== 'ping.reply' || !env.payload?.sentAt || !env.payload?.repliedAt) return
      setResults((prev) => [
        {
          peer: `${env.payload?.node?.code ?? '?'}@${env.payload?.node?.host ?? '?'}`,
          ms: Math.max(0, env.payload!.repliedAt! - env.payload!.sentAt!),
          at: new Date().toISOString(),
          served: env.payload?.served ?? 0,
        },
        ...prev.slice(0, 19),
      ])
      setWaiting(false)
    }
    s.on('nhp:in', h)
    return () => {
      s.off('nhp:in', h)
    }
  }, [connected])

  const ping = () => {
    if (!peerEntry || waiting) return
    setWaiting(true)
    onSend(
      {
        to: { host: peerEntry.hostCode, node: peerEntry.nodeCode },
        module: 'ping',
        type: 'ping.request',
        payload: { sentAt: Date.now() },
      },
      (res) => {
        if (!res.ok) setWaiting(false)
        else setTimeout(() => setWaiting(false), 6000)
      },
    )
  }

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Gauge className="size-4 text-primary" /> سنجش اتصال بین‌نودی
          </div>
          <p className="text-[11px] text-muted-foreground leading-5">
            پینگ یک پاکت <code dir="ltr" className="ltr-block">ping.request</code> است؛ ماژول نود مقصد
            بلافاصله <code dir="ltr" className="ltr-block">ping.reply</code> برمی‌گرداند — حتی اگر
            ادمین مقصد آفلاین باشد، چون ماژول روی خودِ نود اجرا می‌شود.
          </p>
          <Select value={peer} onValueChange={setPeer}>
            <SelectTrigger aria-label="نود مقصد"><SelectValue placeholder="انتخاب نود مقصد" /></SelectTrigger>
            <SelectContent>
              {pingPeers.map((p) => (
                <SelectItem key={`${p.hostCode}:${p.nodeCode}`} value={`${p.hostCode}:${p.nodeCode}`}>
                  {p.nodeName} ({p.nodeCode}@{p.hostCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="w-full" onClick={ping} disabled={!peerEntry || !connected || waiting}>
            {waiting ? 'در انتظار پاسخ…' : 'ارسال پینگ'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-3">نتایج تاخیر رفت‌وبرگشت</div>
          {results.length === 0 ? (
            <EmptyHint>هنوز پینگی ارسال نشده است.</EmptyHint>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto nh-scroll">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                  <span dir="ltr" className="ltr-block">{r.peer}</span>
                  <Badge variant="outline" className={r.ms < 50 ? 'border-emerald-500/30 text-emerald-600' : r.ms < 300 ? 'border-amber-500/30 text-amber-600' : 'border-rose-500/30 text-rose-600'}>
                    {r.ms} ms
                  </Badge>
                  <span className="text-muted-foreground tabular-nums">{clockOf(r.at)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ==============================================================
// Raw envelopes (developer view)
// ==============================================================

function RawPanel({
  mailbox,
  live,
  onRefresh,
  onClear,
}: {
  mailbox: MailRow[]
  live: Envelope[]
  onRefresh: () => void
  onClear: () => void
}) {
  const [show, setShow] = useState<string | null>(null)
  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">صندوق ورودی نود (ادمین آفلاین هم پیام می‌گیرد)</div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="size-8" onClick={onRefresh} aria-label="بازخوانی">
                <RefreshCw className="size-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8 text-rose-500" onClick={onClear} aria-label="خالی کردن صندوق">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          {mailbox.length === 0 ? (
            <EmptyHint>صندوق خالی است.</EmptyHint>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto nh-scroll">
              {mailbox.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setShow(show === m.id ? null : m.id)}
                  className="w-full text-right rounded-lg border px-3 py-2 hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <StatusBadge status={m.status} label={STATUS_FA[m.status]} />
                    <Badge variant="secondary" className="text-[10px] ltr-block" dir="ltr">{m.module}</Badge>
                    <span dir="ltr" className="ltr-block text-[10px] text-muted-foreground">{m.type}</span>
                    <span className="flex-1" />
                    <span className="text-[10px] text-muted-foreground tabular-nums">{clockOf(m.createdAt)}</span>
                  </div>
                  {show === m.id && (
                    <CodeBlock className="mt-2 max-h-56 overflow-y-auto">{JSON.stringify(rowToEnvelope(m), null, 2)}</CodeBlock>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-medium">پاکت‌های زندهٔ دریافتی (nhp:in)</div>
          {live.length === 0 ? (
            <EmptyHint>هنوز پاکت زنده‌ای نرسیده است — از نودی دیگر پیام بفرستید.</EmptyHint>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto nh-scroll">
              {live.map((env, i) => (
                <button
                  key={String(env.id ?? i) + i}
                  onClick={() => setShow(show === `live-${i}` ? null : `live-${i}`)}
                  className="w-full text-right rounded-lg border px-3 py-2 hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="text-[10px] ltr-block" dir="ltr">{String(env.module)}</Badge>
                    <span dir="ltr" className="ltr-block text-[10px]">{String(env.type)}</span>
                    <span dir="ltr" className="ltr-block text-[10px] text-muted-foreground">
                      {String(env.from?.node)}@{String(env.from?.host)} → {String(env.to?.node)}@{String(env.to?.host)}
                    </span>
                  </div>
                  {show === `live-${i}` && (
                    <CodeBlock className="mt-2 max-h-56 overflow-y-auto">{JSON.stringify(env, null, 2)}</CodeBlock>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// helpers
function safeParse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return {} as T
  }
}

function rowToEnvelope(m: MailRow) {
  try {
    return JSON.parse(m.envelope)
  } catch {
    return { envId: m.envId, payload: safeParse(m.payload) }
  }
}
