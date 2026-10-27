'use client'

/**
 * RawPanel — developer view over the wire.
 * Left: the node's inbound mailbox (delivered + queued rows).
 * Right: live nhp:in envelopes pushed by the kernel while connected.
 * Self-sufficient: loads, refreshes and clears through the session socket.
 */
import { useCallback, useEffect, useState } from 'react'
import { clockOf } from '../../api'
import { StatusBadge, EmptyHint, CodeBlock } from '../../bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { MailRow } from '../../types'
import { STATUS_FA } from '../../types'
import { useConsoleSocket, type WireEnvelope } from '../socket-context'
import { rowToEnvelope } from '../json'

const LIVE_FEED_MAX = 60

export function RawPanel() {
  const { conn, emit, onNhpIn } = useConsoleSocket()
  const connected = conn === 'connected'
  const { toast } = useToast()
  const [mailbox, setMailbox] = useState<MailRow[]>([])
  const [live, setLive] = useState<WireEnvelope[]>([])
  const [show, setShow] = useState<string | null>(null)

  const refresh = useCallback(() => {
    emit('mailbox:list', {}, (res: { ok: boolean; items?: MailRow[] }) => {
      if (res.ok && res.items) setMailbox(res.items)
    })
  }, [emit])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Live feed + mailbox auto-refresh on any incoming envelope
  useEffect(() => {
    if (!connected) return
    return onNhpIn((env) => {
      setLive((prev) => [env, ...prev].slice(0, LIVE_FEED_MAX))
      setTimeout(refresh, 150)
    })
  }, [connected, refresh, onNhpIn])

  const clear = () => {
    emit('mailbox:clear', {}, () => {
      toast({ title: 'صندوق خالی شد' })
      refresh()
    })
  }

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">صندوق ورودی نود (ادمین آفلاین هم پیام می‌گیرد)</div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="size-8" onClick={refresh} aria-label="بازخوانی">
                <RefreshCw className="size-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8 text-rose-500" onClick={clear} aria-label="خالی کردن صندوق">
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
