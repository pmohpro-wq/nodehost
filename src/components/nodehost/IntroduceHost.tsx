'use client'

/**
 * IntroduceHost — "هر کاربر بتواند یک نودهاست را به نودهاست خودش معرفی کند".
 *
 * Federation peering is a VERIFIED MUTUAL handshake:
 *  1. the user pastes a peer's address (ingress URL or bare host URL)
 *  2. our kernel probes the peer's /.well-known/nhp — the peer must be a
 *     live NodeHost; dead addresses are rejected with a Persian message
 *  3. the peer's id (code) is DISCOVERED from the well-known doc, not
 *     typed by the user — so mislabeling is impossible
 *  4. after adopting the peer, our kernel POSTs its own descriptor to
 *     the peer's /internal/host/introduce-self — the peer probes us back
 *     and adopts us too. The recognition is MUTUAL: A→B also gives B→A
 *     in the same handshake.
 *
 * No admin gate on INTRODUCING: an address costs nothing and the peer
 * must verify itself before any row is stored; removing a host stays
 * admin-only.
 */
import { useState } from 'react'
import { Globe, Plus, CheckCircle2, AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { nhPost } from './api'
import { useNh } from './store'
import { StatusDot } from './bits'

interface IntroduceResult {
  ok: boolean
  host?: { id: string; code: string; name: string; address: string; status?: string }
  mutual?: boolean
  peer?: { code: string; name: string; ingress: string }
  error?: string
}

export function IntroduceHost() {
  const { data, refresh } = useNh()
  const { toast } = useToast()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<IntroduceResult | null>(null)

  const peers = data?.hosts ?? []

  const introduce = async () => {
    const addr = address.trim()
    if (!addr) {
      toast({ title: 'آدرس نودهاست را وارد کنید', variant: 'destructive' })
      return
    }
    setBusy(true)
    setLastResult(null)
    try {
      const res = (await nhPost('hosts', { address: addr })) as IntroduceResult
      if (res.ok) {
        setLastResult(res)
        toast({
          title: 'نودهاست معرفی شد',
          description: res.mutual
            ? `شناسایی متقابل برقرار شد — «${res.peer?.code}» هم ما را شناخت`
            : `«${res.peer?.code}» معرفی شد — شناسایی متقابل در تماس بعدی تکمیل می‌شود`,
        })
        setAddress('')
        await refresh()
      } else {
        throw new Error(res.error || 'معرفی ناموفق بود')
      }
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, '')
      toast({ title: 'معرفی ناموفق بود', description: msg, variant: 'destructive' })
      setLastResult({ ok: false, error: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="size-5" /> معرفی نودهاست به نودهاست
          <Badge variant="outline" className="mr-1 font-normal">
            {peers.length} نودهاستِ دیگر
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground leading-6">
          آدرس نودهاست مقصد را وارد کنید — خودش را به ما معرفی می‌کند و آیدی‌اش به‌صورت
          خودکار از سرور مقصد خوانده می‌شود. سپس ما هم خودمان را به او معرفی می‌کنیم
          تا شناخت دو سرور متقابل شود.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            dir="ltr"
            className="h-9 flex-1 min-w-[260px] font-mono"
            placeholder="آدرس نودهاست مقصد (مثلاً https://chat.example.com/ingress)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void introduce()}
            aria-label="آدرس نودهاست مقصد"
            disabled={busy}
          />
          <Button onClick={() => void introduce()} disabled={busy || !address.trim()} size="sm">
            <Plus className="size-4" /> {busy ? 'در حال بررسی...' : 'معرفی'}
          </Button>
        </div>

        {lastResult && (
          <div
            className={`rounded-md border p-3 text-sm leading-6 ${
              lastResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                : 'border-destructive/30 bg-destructive/5 text-destructive'
            }`}
          >
            {lastResult.ok ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="size-4" />
                  نودهاست «{lastResult.peer?.code}» شناسایی و معرفی شد
                </div>
                <div className="text-xs text-muted-foreground" dir="ltr">
                  {lastResult.peer?.ingress}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <ArrowRightLeft className="size-4" />
                  {lastResult.mutual
                    ? 'شناسایی متقابل برقرار شد — هر دو سرور هم را می‌شناسند'
                    : 'شناسایی متقابل در تماس بعدی (heartbeat) تکمیل می‌شود'}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 font-medium">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <span>{lastResult.error}</span>
              </div>
            )}
          </div>
        )}

        {peers.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {peers.map((h) => (
              <span
                key={h.id}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
                title={h.address}
              >
                <StatusDot tone={h.status === 'online' ? 'green' : h.status === 'unreachable' ? 'amber' : 'slate'} />
                <span className="font-medium" dir="ltr">{h.code}</span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
