'use client'

/**
 * AdminTab — instance administration (admin role only):
 *   1. Host settings: the node cap (maxNodes, default 50).
 *   2. User directory: suspend/activate, promote/demote.
 * The server re-checks the role on every call — this UI is convenience.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNh } from './store'
import { nhJson, ago } from './api'
import { SectionTitle, StatusBadge, EmptyHint } from './bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  Settings2,
  Users2,
  ShieldCheck,
  ShieldOff,
  PauseCircle,
  PlayCircle,
  Save,
  Boxes,
} from 'lucide-react'
import type { AdminUserDto, QuotaInfo } from './types'

export function AdminTab() {
  const { toast } = useToast()
  const { me, refresh, data } = useNh()

  const [users, setUsers] = useState<AdminUserDto[] | null>(null)
  const [maxNodes, setMaxNodes] = useState<number | null>(null)
  const [maxNodesInput, setMaxNodesInput] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([
        nhJson<{ users: AdminUserDto[] }>('/api/admin/users', 'GET'),
        nhJson<{ maxNodes: number }>('/api/admin/settings', 'GET'),
      ])
      setUsers(u.users)
      setMaxNodes(s.maxNodes)
      setMaxNodesInput(String(s.maxNodes))
    } catch (err) {
      toast({ title: 'خطا در دریافت اطلاعات ادمین', description: String(err), variant: 'destructive' })
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const saveMaxNodes = async () => {
    const n = Number(maxNodesInput)
    if (!Number.isInteger(n) || n < 0) {
      toast({ title: 'عدد نامعتبر است', variant: 'destructive' })
      return
    }
    try {
      const res = await nhJson<{ maxNodes: number }>('/api/admin/settings', 'PATCH', { maxNodes: n })
      setMaxNodes(res.maxNodes)
      setMaxNodesInput(String(res.maxNodes))
      toast({ title: 'سقف نودها به‌روزرسانی شد', description: `حداکثر ${res.maxNodes} نود` })
      await refresh()
    } catch (err) {
      toast({ title: 'ذخیره ناموفق بود', description: String(err), variant: 'destructive' })
    }
  }

  const patchUser = async (u: AdminUserDto, body: { status?: string; role?: string }) => {
    setBusyId(u.id)
    try {
      const res = await nhJson<{ user: AdminUserDto }>(`/api/admin/users/${u.id}`, 'PATCH', body)
      setUsers((prev) =>
        prev ? prev.map((x) => (x.id === u.id ? { ...x, ...res.user } : x)) : prev,
      )
      toast({ title: `کاربر «${u.name}» به‌روزرسانی شد` })
      await refresh()
    } catch (err) {
      toast({ title: 'تغییر ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const quota: QuotaInfo | null =
    data ? { maxNodes: maxNodes ?? data.quota.maxNodes, used: data.quota.used } : null

  return (
    <div className="space-y-6">
      {/* ---- instance settings ---- */}
      <section>
        <SectionTitle
          icon={<Settings2 />}
          title="تنظیمات میزبان"
          sub="سقف تعداد نودهای کاربران روی این میزبان"
        />
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">سقف نود (maxNodes)</label>
              <Input
                dir="ltr"
                inputMode="numeric"
                className="w-32"
                value={maxNodesInput}
                onChange={(e) => setMaxNodesInput(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && saveMaxNodes()}
              />
            </div>
            <Button onClick={saveMaxNodes} disabled={maxNodesInput === String(maxNodes)}>
              <Save className="size-4" /> ذخیره
            </Button>
            {quota && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mr-2">
                <Boxes className="size-3.5" />
                وضعیت فعلی: {quota.used} از {quota.maxNodes} نود
                {quota.used >= quota.maxNodes && (
                  <Badge variant="destructive" className="text-[10px]">پر شده</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ---- users ---- */}
      <section>
        <SectionTitle
          icon={<Users2 />}
          title="کاربران نمونه"
          sub="تعلیق/فعال‌سازی و ارتقا/سلب ادمین — حساب خودتان قابل تغییر نیست"
        />
        {users === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : users.length === 0 ? (
          <EmptyHint>هنوز کاربری ثبت‌نام نکرده است.</EmptyHint>
        ) : (
          <div className="rounded-xl border overflow-x-auto nh-scroll">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-right font-medium px-3 py-2">کاربر</th>
                  <th className="text-right font-medium px-3 py-2">نقش</th>
                  <th className="text-right font-medium px-3 py-2">وضعیت</th>
                  <th className="text-right font-medium px-3 py-2">نودها</th>
                  <th className="text-right font-medium px-3 py-2">عضویت</th>
                  <th className="text-right font-medium px-3 py-2">اقدامات</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => {
                  const isSelf = me?.id === u.id
                  return (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium text-xs">{u.name}</div>
                        <div dir="ltr" className="text-[10px] text-muted-foreground ltr-block">
                          {u.email}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {u.role === 'admin' ? (
                          <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                            <ShieldCheck className="size-3.5" /> ادمین
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">کاربر</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          status={u.status === 'active' ? 'online' : 'unreachable'}
                          label={u.status === 'active' ? 'فعال' : 'معلق'}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs">{u.nodeCount}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{ago(u.createdAt)}</td>
                      <td className="px-3 py-2">
                        {isSelf ? (
                          <span className="text-[10px] text-muted-foreground">حساب شما</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1"
                              disabled={busyId === u.id}
                              onClick={() =>
                                patchUser(u, {
                                  status: u.status === 'active' ? 'suspended' : 'active',
                                })
                              }
                            >
                              {u.status === 'active' ? (
                                <>
                                  <PauseCircle className="size-3" /> تعلیق
                                </>
                              ) : (
                                <>
                                  <PlayCircle className="size-3" /> فعال‌سازی
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1"
                              disabled={busyId === u.id}
                              onClick={() =>
                                patchUser(u, { role: u.role === 'admin' ? 'user' : 'admin' })
                              }
                            >
                              {u.role === 'admin' ? (
                                <>
                                  <ShieldOff className="size-3" /> سلب ادمین
                                </>
                              ) : (
                                <>
                                  <ShieldCheck className="size-3" /> ارتقا به ادمین
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
