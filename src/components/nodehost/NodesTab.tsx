'use client'

import { useState } from 'react'
import { useNh } from './store'
import { nhPost, nhDelete } from './api'
import { SectionTitle, StatusDot, EmptyHint, StatusBadge } from './bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Plus, Copy, Trash2, TerminalSquare, KeyRound, Boxes } from 'lucide-react'
import type { ModuleDto, NodeDto } from './types'

export function NodesTab({ onGoConsole }: { onGoConsole: (code: string, token: string) => void }) {
  const { data, refresh } = useNh()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // A freshly created node ALWAYS returns its one-time token.
  const [created, setCreated] = useState<(NodeDto & { token: string }) | null>(null)

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const res = await nhPost<{ ok: boolean; node: NodeDto & { token: string } }>('nodes', { name: name.trim() })
      setCreated(res.node)
      setName('')
      await refresh()
      toast({ title: 'نود ساخته شد', description: `کد نود: ${res.node.code}` })
    } catch (err) {
      toast({ title: 'خطا در ساخت نود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (node: NodeDto, moduleId: string, enabled: boolean) => {
    try {
      await nhPost(`nodes/${node.id}/modules`, { moduleId, enabled })
      await refresh()
    } catch (err) {
      toast({ title: 'تغییر ماژول ناموفق بود', description: String(err), variant: 'destructive' })
    }
  }

  const remove = async (node: NodeDto) => {
    try {
      await nhDelete(`nodes/${node.id}`)
      await refresh()
      toast({ title: 'نود حذف شد', description: node.code })
    } catch (err) {
      toast({ title: 'حذف ناموفق بود', description: String(err), variant: 'destructive' })
    }
  }

  const copyToken = (token: string) => {
    void navigator.clipboard.writeText(token)
    toast({ title: 'توکن کپی شد' })
  }

  return (
    <div className="space-y-6">
      {/* Create node */}
      <section>
        <SectionTitle icon={<Plus />} title="ایجاد نود جدید" sub="هر نود یک جزیرهٔ ایزوله برای یک ادمین است" />
        <div className="flex gap-2 max-w-xl">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="نام نود (مثلاً: نود پشتیبانی)"
            aria-label="نام نود"
          />
          <Button onClick={create} disabled={busy || !name.trim()}>
            <Plus className="size-4" /> ساخت نود
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          توکن ادمین فقط یک‌بار پس از ساخت نمایش داده می‌شود — ادمین فقط با همین توکن به نودِ خودش
          وصل می‌شود.
          {data && ` · سهمیهٔ نود این میزبان: ${data.quota.used} از ${data.quota.maxNodes}`}
        </p>
      </section>

      {/* Node list */}
      <section>
        <SectionTitle
          icon={<Boxes />}
          title={`نودهای ${data?.host.name ?? ''}`}
          sub="فعال/غیرفعال‌سازی ماژول‌ها به‌صورت زنده"
        />
        {data && data.nodes.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-3">
            {data.nodes.map((n) => (
              <NodeCard
                key={n.id}
                node={n}
                modules={data.modules}
                onToggle={toggle}
                onDelete={remove}
                onCopyToken={copyToken}
                onGoConsole={onGoConsole}
              />
            ))}
          </div>
        ) : (
          <EmptyHint>هنوز نودی ساخته نشده است.</EmptyHint>
        )}
      </section>

      {/* Created dialog (token shown once) */}
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" /> نود ساخته شد
            </DialogTitle>
            <DialogDescription>
              این توکن را امن نگه دارید؛ فقط یک‌بار نمایش داده می‌شود.
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-xs text-muted-foreground">کد نود</div>
                  <div className="font-mono text-sm ltr-block" dir="ltr">{created.code}</div>
                </div>
                <Badge variant="secondary">نام: {created.name}</Badge>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground mb-1">توکن ادمین</div>
                <div className="flex items-center gap-2">
                  <code dir="ltr" className="ltr-block text-xs flex-1 truncate">{created.token}</code>
                  <Button size="icon" variant="outline" className="size-8" onClick={() => copyToken(created.token)} aria-label="کپی توکن">
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  onGoConsole(created.code, created.token)
                  setCreated(null)
                }}
              >
                <TerminalSquare className="size-4" /> رفتن به کنسول این نود
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function NodeCard({
  node,
  modules,
  onToggle,
  onDelete,
  onCopyToken,
  onGoConsole,
}: {
  node: NodeDto
  modules: ModuleDto[]
  onToggle: (n: NodeDto, moduleId: string, enabled: boolean) => void
  onDelete: (n: NodeDto) => void
  onCopyToken: (t: string) => void
  onGoConsole: (code: string, token: string) => void
}) {
  const enabledCount = node.moduleStates.filter((s) => s.enabled).length
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm flex items-center gap-2">
              <StatusDot tone="green" pulse />
              <span className="truncate">{node.name}</span>
              {node.isDemo && <Badge variant="secondary" className="text-[10px]">دمو</Badge>}
              {!node.isDemo && node.ownerName && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  مالک: {node.ownerName}
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 ltr-block" dir="ltr">
              {node.code}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="کپی توکن ادمین"
              onClick={() => node.token && onCopyToken(node.token)}
            >
              <KeyRound className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-emerald-600 hover:text-emerald-700"
              aria-label="اتصال کنسول"
              onClick={() => node.token && onGoConsole(node.code, node.token)}
            >
              <TerminalSquare className="size-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="size-8 text-rose-500 hover:text-rose-600" aria-label="حذف نود">
                  <Trash2 className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>حذف نود «{node.name}»؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    صندوق، حافظهٔ ماژول‌ها و سشن ادمین این نود برای همیشه حذف می‌شود.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2">
                  <AlertDialogCancel>انصراف</AlertDialogCancel>
                  <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => onDelete(node)}>
                    حذف قطعی
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status="online" label={`${enabledCount} ماژول فعال`} />
          <StatusBadge status="delivered" label="نود: همیشه آنلاین" />
        </div>

        <div className="rounded-lg border divide-y">
          {modules.map((m) => {
            const on = node.moduleStates.find((s) => s.moduleId === m.id)?.enabled ?? false
            return (
              <label key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer">
                <div className="min-w-0">
                  <div className="text-xs font-medium">{m.name}</div>
                  <div className="text-[10px] text-muted-foreground ltr-block" dir="ltr">
                    {m.id} · v{m.version}
                  </div>
                </div>
                <Switch checked={on} onCheckedChange={(v) => onToggle(node, m.id, v)} aria-label={`${m.name} در ${node.code}`} />
              </label>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
