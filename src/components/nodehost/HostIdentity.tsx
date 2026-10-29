'use client'

/**
 * HostIdentity — the admin's card for THIS NodeHost's public id.
 *
 * This software IS a NodeHost; whoever runs it on their own server owns
 * its id. The id is the routing code of every address on the instance
 * (`id@hostId`) — admin sets it once and every consumer (header chip,
 * node header, contacts form's server box) follows reactively via the
 * bootstrap poll. The identity law is enforced client- and server-side
 * (src/lib/identity.ts): English-only lowercase, 2..40, unique.
 */
import { useEffect, useState } from 'react'
import { ServerCog } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { checkIdShape, ENGLISH_ID_ERROR, ID_RE } from '@/lib/identity'
import { nhJson } from './api'
import { useNh } from './store'

export function HostIdentity() {
  const { data, refresh } = useNh()
  const { toast } = useToast()
  const current = data?.host.code ?? ''

  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Follow the live host id until the admin starts typing.
  useEffect(() => {
    if (!dirty) setDraft(current)
  }, [current, dirty])

  const edit = (v: string) => {
    setDraft(v)
    setDirty(true)
  }

  const save = async () => {
    const gate = checkIdShape(draft)
    if (!gate.ok) {
      toast({ title: 'آیدی نامعتبر است', description: gate.error, variant: 'destructive' })
      return
    }
    if (!ID_RE.test(gate.id)) {
      toast({ title: 'آیدی نامعتبر است', description: ENGLISH_ID_ERROR, variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      await nhJson('/api/admin/host-identity', 'PATCH', { code: gate.id })
      toast({ title: 'آیدی نودهاست تغییر کرد', description: `id@${gate.id} — همه‌جا به‌روز می‌شود` })
      setDirty(false)
      await refresh()
    } catch (err) {
      toast({ title: 'تغییر آیدی ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ServerCog className="size-5" /> آیدی این نودهاست
          <Badge variant="outline" className="mr-1 font-normal" dir="ltr">
            id@{current}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground leading-6">
          این نرم‌افزار یک نودهاست است و هرکس آن را روی سرور خودش اجرا می‌کند. آیدی نودهاست، کدِ
          مسیریابی همهٔ آدرس‌های این سرور است — هر کاربر اینجا <span dir="ltr" className="font-mono">id@{current}</span> می‌شود.
          آیدی جدید فقط حروف انگلیسی کوچک و عدد است و باید با حرف شروع شود.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            dir="ltr"
            className="h-9 w-44 font-mono"
            placeholder={current || 'hostid'}
            value={draft}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            maxLength={40}
            aria-label="آیدی نودهاست"
          />
          <Button onClick={() => void save()} disabled={saving || !dirty || draft.trim() === current} size="sm">
            {saving ? 'در حال ثبت…' : 'ثبت آیدی'}
          </Button>
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => { setDirty(false); setDraft(current) }}>
              انصراف
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-5">
          پس از تغییر، آدرس همهٔ کاربران همین سرور به‌صورت خودکار روی آیدی تازه می‌رود (بدون جابه‌جایی
          داده — فایل دیتابیس مستقل از آیدی است). سرورهای دیگر تا سیک کشف بعدی، آیدی قبلی را هم می‌شناسند.
        </p>
      </CardContent>
    </Card>
  )
}
