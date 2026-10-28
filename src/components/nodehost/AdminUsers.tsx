'use client'

/**
 * AdminUsers — the admin's minimal view: who is on THIS NodeHost.
 * One admin per NodeHost (the first registrant). Suspend/activate a user
 * and promote to admin; nothing else — no quotas, no host tables.
 */
import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { nhJson } from './api'
import { useNh } from './store'
import type { AdminUserDto } from './types'

export function AdminUsers() {
  const { refresh } = useNh()
  const { toast } = useToast()
  const [users, setUsers] = useState<AdminUserDto[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await nhJson<{ ok: boolean; users: AdminUserDto[] }>(
        '/api/admin/users',
        'GET',
      )
      setUsers(res.users)
    } catch {
      setUsers([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (id: string, body: { status?: string; role?: string }) => {
    setBusy(id)
    try {
      await nhJson(`/api/admin/users/${id}`, 'PATCH', body)
      await load()
      await refresh()
    } catch (err) {
      toast({ title: 'عملیات ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-5" /> کاربران این نودهاست
          {users && (
            <Badge variant="outline" className="mr-1 font-normal">
              {users.length} کاربر
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {(users ?? []).map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                {u.name}
                {u.role === 'admin' && (
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-0">
                    ادمین
                  </Badge>
                )}
                {u.status === 'suspended' && (
                  <Badge variant="destructive">معلق</Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground ltr-block" dir="ltr">
                {u.email}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy === u.id}
                onClick={() =>
                  void patch(u.id, { status: u.status === 'suspended' ? 'active' : 'suspended' })
                }
              >
                {u.status === 'suspended' ? 'فعال‌سازی' : 'تعلیق'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === u.id}
                onClick={() => void patch(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}
              >
                {u.role === 'admin' ? 'سلب ادمین' : 'ارتقا به ادمین'}
              </Button>
            </div>
          </div>
        ))}
        {users?.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">هنوز کاربری نیست.</p>
        )}
      </CardContent>
    </Card>
  )
}
