'use client'

/**
 * ConsoleSessionView — the ACTIVE admin session.
 *
 * Owns the socket.io lifecycle for the bound node and exposes it to
 * panels as BEHAVIOR (send / emit / onNhpIn) through ConsoleSocketContext.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useNh } from '../store'
import { StatusDot } from '../bits'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { Unplug, Megaphone, Gauge, FileJson2, MessageSquare } from 'lucide-react'
import type { ConsoleSession, DirectoryEntry, MailRow, SendFn, SendResult } from '../types'
import { ConsoleSocketProvider, type ConnState, type WireEnvelope } from './socket-context'
import { ChatPanel } from './panels/ChatPanel'
import { BoardPanel } from './panels/BoardPanel'
import { PingPanel } from './panels/PingPanel'
import { RawPanel } from './panels/RawPanel'

interface HelloAck {
  ok: boolean
  error?: string
  mailbox?: MailRow[]
}

export function ConsoleSessionView({
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

  // peers = every other node in the directory
  const peers = useMemo(() => {
    if (!data) return []
    return data.directory.filter(
      (d) => !(d.hostCode === session.hostCode && d.nodeCode === session.nodeCode),
    )
  }, [data, session])

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

    s.on('connect', () => {
      s.emit(
        'admin:hello',
        { nodeCode: session.nodeCode, token: session.token },
        (res: HelloAck) => {
          if (res.ok) {
            setConn('connected')
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

    return () => {
      s.disconnect()
      socketRef.current = null
    }
  }, [session.hostCode, session.nodeCode, session.token, toast])

  const send = useCallback<SendFn>(
    (p, cb) => {
      const s = socketRef.current
      if (!s || conn !== 'connected') {
        toast({ title: 'ادمین متصل نیست', variant: 'destructive' })
        return
      }
      s.emit('nhp:send', p, (res: SendResult) => {
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

  /** Emit on the session socket — no-op while offline. */
  const emit = useCallback((event: string, ...args: unknown[]) => {
    socketRef.current?.emit(event, ...args)
  }, [])

  /** Subscribe to kernel pushes; safe to call from panel effects. */
  const onNhpIn = useCallback((handler: (env: WireEnvelope) => void) => {
    const s = socketRef.current
    if (!s) return () => {}
    s.on('nhp:in', handler)
    return () => {
      s.off('nhp:in', handler)
    }
  }, [])

  const socketValue = useMemo(
    () => ({ conn, send, emit, onNhpIn }),
    [conn, send, emit, onNhpIn],
  )

  return (
    <ConsoleSocketProvider value={socketValue}>
      <div className="space-y-4">
        {/* Session header */}
        <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <StatusDot
              tone={conn === 'connected' ? 'green' : conn === 'error' ? 'rose' : 'amber'}
              pulse={conn === 'connected'}
            />
            <div>
              <div className="font-bold text-sm">
                {session.nodeName}{' '}
                <span className="text-muted-foreground ltr-block inline" dir="ltr">
                  @{session.hostCode}
                </span>
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
            <ChatPanel peers={peers} />
          </TabsContent>
          <TabsContent value="board" className="mt-4">
            <BoardPanel session={session} />
          </TabsContent>
          <TabsContent value="ping" className="mt-4">
            <PingPanel peers={peers} />
          </TabsContent>
          <TabsContent value="raw" className="mt-4">
            <RawPanel />
          </TabsContent>
        </Tabs>
      </div>
    </ConsoleSocketProvider>
  )
}
