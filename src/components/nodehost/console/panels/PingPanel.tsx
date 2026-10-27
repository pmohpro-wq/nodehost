'use client'

/**
 * PingPanel — liveness & latency probe (ping module).
 * Sends ping.request; the target NODE (not its admin) replies
 * ping.reply echoing the original timestamp for RTT computation.
 */
import { useEffect, useState } from 'react'
import { clockOf } from '../../api'
import { EmptyHint } from '../../bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Gauge } from 'lucide-react'
import type { DirectoryEntry } from '../../types'
import { useConsoleSocket } from '../socket-context'

interface PingResult {
  peer: string
  ms: number
  at: string
  served: number
}

interface PingReplyPayload {
  sentAt?: number
  repliedAt?: number
  served?: number
  node?: { code: string; host: string }
}

export function PingPanel({ peers }: { peers: DirectoryEntry[] }) {
  const { conn, send, onNhpIn } = useConsoleSocket()
  const connected = conn === 'connected'

  const pingPeers = peers.filter((p) => p.modules.includes('ping'))
  const [peer, setPeer] = useState('')
  const [results, setResults] = useState<PingResult[]>([])
  const [waiting, setWaiting] = useState(false)

  const peerEntry = pingPeers.find((p) => `${p.hostCode}:${p.nodeCode}` === peer)

  useEffect(() => {
    if (!connected) return
    return onNhpIn((env) => {
      const p = env.payload as PingReplyPayload | undefined
      if (env.type !== 'ping.reply' || !p?.sentAt || !p?.repliedAt) return
      setResults((prev) => [
        {
          peer: `${p.node?.code ?? '?'}@${p.node?.host ?? '?'}`,
          ms: Math.max(0, p.repliedAt! - p.sentAt!),
          at: new Date().toISOString(),
          served: p.served ?? 0,
        },
        ...prev.slice(0, 19),
      ])
      setWaiting(false)
    })
  }, [connected, onNhpIn])

  const ping = () => {
    if (!peerEntry || waiting) return
    setWaiting(true)
    send(
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
