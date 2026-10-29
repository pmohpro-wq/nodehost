'use client'

/**
 * AdminNodes — the admin's handle on EVERY node of this NodeHost.
 *
 * The kernel and proxy already had DELETE nodes/<id>; what was missing is
 * the admin-facing surface. Deleting a node is total: the node, its
 * module data, its mailbox history AND the account behind it (a node
 * without its owner is a login-with-nothing zombie) — so the action sits
 * behind an explicit confirm dialog and never targets the admin's own
 * node (lockout guard, mirrored server-side in the proxy).
 */
import { useState } from 'react'
import { Server, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { nhDelete } from './api'
import { useNh } from './store'
import { StatusDot } from './bits'
import type { NodeDto } from './types'

export function AdminNodes() {
  const { me, data, refresh } = useNh()
  const { toast } = useToast()
  const [target, setTarget] = useState<NodeDto | null>(null)
  const [busy, setBusy] = useState(false)

  if (!data) return null
  const hostCode = data.host.code

  const remove = async () => {
    if (!target) return
    setBusy(true)
    try {
      const res = await nhDelete<{ ok: boolean; accountRemoved?: string }>(`nodes/${target.id}`)
      toast({
        title: `نود «${target.code}» حذف شد`,
        description: res.accountRemoved
          ? `حساب «${res.accountRemoved}» و همهٔ داده‌هایش هم پاک شد`
          : 'داده‌های نود پاک شد',
      })
      setTarget(null)
      await refresh()
    } catch (err) {
      toast({ title: 'حذف ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-5" /> نودهای این نودهاست
          <Badge variant="outline" className="mr-1 font-normal">
            {data.nodes.length} نود
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {data.nodes.map((n) => {
          const mine = !!me && n.ownerId === me.id
          const enabled = n.moduleStates.filter((s) => s.enabled).length
          return (
            <div key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium flex flex-wrap items-center gap-2">
                  <StatusDot tone={n.status === 'active' ? 'green' : 'amber'} />
                  {n.name}
                  <span className="text-[11px] text-muted-foreground ltr-block" dir="ltr">
                    {n.code}@{hostCode}
                  </span>
                  {n.isDemo && (
                    <Badge variant="outline" className="font-normal">
                      دمو
                    </Badge>
                  )}
                  {mine && (
                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-0">
                      نود شما
                    </Badge>
                  )}
                  {n.status === 'suspended' && <Badge variant="destructive">معلق</Badge>}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {n.ownerName ? `مالک: ${n.ownerName}` : 'بدون مالک (نود سیستمی/دمو)'}
                  {' · '}
                  {enabled} ماژول فعال
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={mine}
                title={mine ? 'حذف نود خودتان مجاز نیست' : 'حذف نود'}
                onClick={() => setTarget(n)}
              >
                <Trash2 className="size-4" /> حذف
              </Button>
            </div>
          )
        })}
        {data.nodes.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">هنوز نودی نیست.</p>
        )}
      </CardContent>

      {/* The one confirm between the admin and an irreversible wipe. */}
      <AlertDialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نود «{target?.code}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              این عمل قابل بازگشت نیست. نود به‌همراه همهٔ داده‌هایش (ماژول‌ها، حافظهٔ اپ‌ها،
              صندوق پیام) پاک می‌شود
              {target?.ownerName ? (
                <>
                  {' '}و حساب کاربری «<b>{target.ownerName}</b>» نیز حذف می‌شود
                </>
              ) : null}
              . اگر این آیدی دوباره ثبت‌نام کند، حسابی تازه و خالی می‌گیرد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                void remove()
              }}
            >
              {busy ? 'در حال حذف…' : 'حذف قطعی'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
