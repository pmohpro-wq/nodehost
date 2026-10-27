'use client'

/**
 * NetworkTab — federation view: hosts, topology, live directory.
 */
import { useState } from 'react'
import { useNh } from './store'
import { nhPost, nhDelete, ago } from './api'
import { SectionTitle, StatusBadge, StatusDot, EmptyHint } from './bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  Map as MapIcon,
  Contact,
  ServerOff,
} from 'lucide-react'
import { STATUS_FA } from './types'

export function NetworkTab() {
  const { data, refresh } = useNh()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [gwPort, setGwPort] = useState('')
  const [busy, setBusy] = useState(false)

  const addHost = async () => {
    if (!name.trim() || !address.trim()) return
    setBusy(true)
    try {
      await nhPost('hosts', {
        name: name.trim(),
        address: address.trim(),
        gwPort: gwPort ? Number(gwPort) : undefined,
      })
      setName('')
      setAddress('')
      setGwPort('')
      await refresh()
      toast({ title: 'میزبان افزوده شد', description: 'هارت‌بیت NHP بلافاصله آغاز می‌شود' })
    } catch (err) {
      toast({ title: 'افزودن ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const removeHost = async (id: string, code: string) => {
    try {
      await nhDelete(`hosts/${id}`)
      await refresh()
      toast({ title: 'میزبان حذف شد', description: code })
    } catch (err) {
      toast({ title: 'حذف ناموفق بود', description: String(err), variant: 'destructive' })
    }
  }

  const recheck = async () => {
    try {
      await nhPost('refresh')
      await refresh()
      toast({ title: 'هارت‌بیت انجام شد' })
    } catch (err) {
      toast({ title: 'خطا', description: String(err), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Topology */}
      <section>
        <SectionTitle icon={<MapIcon />} title="توپولوژی زندهٔ شبکه" sub="میزبان‌ها = سرورهای مستقل؛ نقطه‌ها = نودها" />
        <Topology />
      </section>

      {/* Host registry */}
      <section>
        <SectionTitle
          icon={<Server />}
          title="دفتر میزبان‌ها"
          sub={`${data?.hosts.length ?? 0} میزبان راه‌دور شناخته‌شده`}
        />
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Button variant="outline" size="sm" onClick={recheck}>
            <RefreshCw className="size-3.5" /> هارت‌بیت فوری
          </Button>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.host && (
            <Card className="border-emerald-500/30">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <Server className="size-4 text-emerald-600" />
                    {data.host.name}
                  </div>
                  <StatusBadge status="online" label="این میزبان (محلی)" />
                </div>
                <div dir="ltr" className="text-[11px] text-muted-foreground ltr-block truncate">
                  {data.host.address}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {data.nodes.length} نود میزبانی‌شده · کد: <span dir="ltr" className="ltr-block inline">{data.host.code}</span>
                </div>
              </CardContent>
            </Card>
          )}
          {data?.hosts.map((h) => (
            <Card key={h.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-bold min-w-0">
                    {h.status === 'online' ? (
                      <Server className="size-4 text-emerald-600 shrink-0" />
                    ) : (
                      <ServerOff className="size-4 text-amber-500 shrink-0" />
                    )}
                    <span className="truncate">{h.name}</span>
                  </div>
                  <StatusBadge status={h.status} label={STATUS_FA[h.status]} />
                </div>
                <div dir="ltr" className="text-[11px] text-muted-foreground ltr-block truncate">
                  {h.address}
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>آخرین تماس: {ago(h.lastSeen)}</span>
                  <div className="flex items-center gap-1">
                    {h.gwPort && <Badge variant="secondary" className="text-[10px]">ws:{h.gwPort}</Badge>}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-rose-500"
                      aria-label={`حذف ${h.name}`}
                      onClick={() => removeHost(h.id, h.code)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Add host */}
        <Card className="mt-3">
          <CardContent className="p-4 grid gap-3 md:grid-cols-[1fr_2fr_120px_auto] items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">نام میزبان</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً نودهاست دلتا" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">آدرس ingress میزبان (URL کامل)</label>
              <Input
                dir="ltr"
                className="ltr-block"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="https://server.example.com/ingress"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">پورت ws (اختیاری)</label>
              <Input dir="ltr" value={gwPort} onChange={(e) => setGwPort(e.target.value.replace(/\D/g, ''))} placeholder="3003" />
            </div>
            <Button onClick={addHost} disabled={busy || !name.trim() || !address.trim()}>
              <Plus className="size-4" /> افزودن
            </Button>
          </CardContent>
        </Card>
        <p className="text-[11px] text-muted-foreground mt-2 leading-5">
          برای اتصال دو سرور واقعی: روی سرور دوم یک نمونهٔ هسته با HOST_CODE/HOST_ADDRESS متفاوت اجرا
          کنید و آدرس ingress آن را اینجا ثبت کنید. قطعی میزبان فقط پیام‌ها را صف می‌کند — هیچ پیامی
          گم نمی‌شود (اصول «نود هرگز آفلاین نمی‌شود»).
        </p>
      </section>

      {/* Directory */}
      <section>
        <SectionTitle icon={<Contact />} title="دایرکتوری حضور شبکه" sub="ترکیب نودهای محلی + رستر دریافتی از میزبان‌ها" />
        {data && data.directory.length > 0 ? (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-right font-medium px-3 py-2">میزبان</th>
                  <th className="text-right font-medium px-3 py-2">نود</th>
                  <th className="text-right font-medium px-3 py-2">ماژول‌های فعال</th>
                  <th className="text-right font-medium px-3 py-2">ادمین</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.directory.map((d) => (
                  <tr key={`${d.hostCode}:${d.nodeCode}`} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <span dir="ltr" className="ltr-block text-xs">{d.hostCode}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium">{d.nodeName}</div>
                      <div dir="ltr" className="text-[10px] text-muted-foreground ltr-block">{d.nodeCode}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {d.modules.length ? (
                          d.modules.map((m) => (
                            <Badge key={m} variant="secondary" className="text-[10px] ltr-block" dir="ltr">{m}</Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 text-xs">
                        <StatusDot tone={d.adminOnline ? 'green' : 'slate'} pulse={d.adminOnline} />
                        {d.adminOnline ? 'آنلاین' : 'آفلاین (نود فعال)'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyHint>دایرکتوری خالی است.</EmptyHint>
        )}
      </section>
    </div>
  )
}

/** Simple, clean topology: host cards with node dots + dashed federation links. */
function Topology() {
  const { data } = useNh()
  if (!data) return null
  const remotes = data.hosts

  return (
    <div className="rounded-2xl border p-4 sm:p-6 overflow-x-auto nh-scroll">
      <div className="min-w-[640px] flex items-stretch gap-6">
        {/* Self host */}
        <div className="flex-1 space-y-3">
          <HostNode name={data.host.name} code={data.host.code} online count={data.nodes.length} />
          <div className="grid grid-cols-3 gap-2 pr-4">
            {data.nodes.slice(0, 9).map((n) => (
              <div key={n.id} className="rounded-lg border bg-card px-2 py-2 text-center">
                <div className="text-[10px] font-medium truncate">{n.name}</div>
                <div dir="ltr" className="text-[9px] text-muted-foreground ltr-block">{n.code}</div>
                <div className="mt-1 flex justify-center gap-0.5">
                  {n.moduleStates.filter((s) => s.enabled).map((s) => (
                    <span key={s.moduleId} className="size-1.5 rounded-full bg-emerald-500" title={s.moduleId} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Links */}
        <div className="w-24 relative hidden md:block" aria-hidden>
          <svg className="absolute inset-0 size-full" preserveAspectRatio="none">
            {remotes.map((h, i) => (
              <line
                key={h.id}
                x1="0"
                y1="28%"
                x2="100%"
                y2={`${30 + i * 18}%`}
                className={h.status === 'online' ? 'nh-link nh-link-online' : 'nh-link'}
              />
            ))}
            {remotes.length === 0 && <line x1="0" y1="28%" x2="100%" y2="50%" className="nh-link" />}
          </svg>
        </div>

        {/* Remote hosts */}
        <div className="flex-1 space-y-3">
          {remotes.length === 0 && (
            <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
              میزبان راه‌دوری ثبت نشده است.
            </div>
          )}
          {remotes.map((h) => (
            <div key={h.id} className="space-y-2">
              <HostNode name={h.name} code={h.code} online={h.status === 'online'} remote />
              {h.status === 'online' && (
                <div className="flex flex-wrap gap-1.5 pr-4">
                  {data.directory
                    .filter((d) => d.hostCode === h.code)
                    .map((d) => (
                      <span
                        key={d.nodeCode}
                        dir="ltr"
                        className="ltr-block rounded-full border bg-card px-2 py-0.5 text-[10px] flex items-center gap-1"
                      >
                        <StatusDot tone={d.adminOnline ? 'green' : 'slate'} pulse={d.adminOnline} />
                        {d.nodeCode}
                      </span>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function HostNode({
  name,
  code,
  online,
  remote,
  count,
}: {
  name: string
  code: string
  online: boolean
  remote?: boolean
  count?: number
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 flex items-center gap-2.5 ${
        online ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'
      }`}
    >
      <div className="size-8 rounded-lg bg-background border grid place-items-center shrink-0">
        {online ? <Server className="size-4 text-emerald-600" /> : <ServerOff className="size-4 text-amber-500" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold truncate">{name}</div>
        <div dir="ltr" className="text-[10px] text-muted-foreground ltr-block">
          {remote ? 'remote host' : 'this host'} · {code}
          {count != null && ` · ${count} nodes`}
        </div>
      </div>
      <div className="flex-1" />
      <StatusDot tone={online ? 'green' : 'amber'} pulse={online} />
    </div>
  )
}
