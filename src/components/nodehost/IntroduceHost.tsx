'use client'

/**
 * IntroduceHost — "هر کاربر بتواند یک نودهاست را به نودهاست خودش معرفی کند".
 *
 * A NodeHost meets another NodeHost by ADDRESS: whoever knows a peer's
 * ingress URL can introduce it to THIS instance — a host-level address
 * book. The kernel then heartbeats (sys.hello) the peer, learns its
 * roster, and mail starts flowing both ways (store-and-forward covers
 * the offline side). No admin gate on INTRODUCING: an address costs
 * nothing and hurts nobody; removing a host stays admin-only.
 *
 * The peer id follows the identity law's SHAPE leg only (2..40, no `|`,
 * no control chars) — remote ids may be domain-shaped (chat.example.com),
 * so the English-only leg deliberately does NOT apply here.
 */
import { useState } from 'react'
import { Globe, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { checkIdShape } from '@/lib/identity'
import { nhPost } from './api'
import { useNh } from './store'
import { StatusDot } from './bits'

export function IntroduceHost() {
  const { data, refresh } = useNh()
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)

  const peers = data?.hosts ?? []

  const introduce = async () => {
    const id = code.trim()
    const addr = address.trim()
    if (id) {
      const gate = checkIdShape(id)
      if (!gate.ok) {
        toast({ title: 'آیدی نودهاست نامعتبر است', description: gate.error, variant: 'destructive' })
        return
      }
    }
    if (!addr) {
      toast({ title: 'آدرس نودهاست را وارد کنید', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      await nhPost('hosts', { code: id || undefined, address: addr })
      toast({ title: 'نودهاست معرفی شد', description: 'با نخستین تماس، نودهایش وارد دفترچهٔ شبکه می‌شوند' })
      setCode('')
      setAddress('')
      await refresh()
    } catch (err) {
      toast({ title: 'معرفی ناموفق بود', description: String(err), variant: 'destructive' })
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
          هر کاربر می‌تواند نودهاستی را که آدرسش را می‌داند به همین نودهاست معرفی کند — مثل دادن
          شمارهٔ تلفن. بعد از معرفی، دو سرور با هم صحبت می‌کنند و کاربران آن نودهاست در دفترچهٔ شبکه
          دیده می‌شوند.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            dir="ltr"
            className="h-9 w-36 font-mono"
            placeholder="آیدی نودهاست (اختیاری)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={40}
            aria-label="آیدی نودهاست مقصد"
          />
          <Input
            dir="ltr"
            className="h-9 flex-1 min-w-[220px] font-mono"
            placeholder="آدرس ingress (مثلاً https://chat.example.com/ingress)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void introduce()}
            aria-label="آدرس نودهاست مقصد"
          />
          <Button onClick={() => void introduce()} disabled={busy || !address.trim()} size="sm">
            <Plus className="size-4" /> معرفی
          </Button>
        </div>
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
