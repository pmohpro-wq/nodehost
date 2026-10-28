'use client'

/**
 * MyNode — the WHOLE product in one screen.
 *
 * The user's node is their personal shared server. This view shows:
 *   1. the node (name, code, status) — created automatically at sign-up
 *   2. its apps (modules) with plain on/off switches
 *   3. each ENABLED app mounted right below its switch — the messenger
 *      opens as a full two-way chat with recipients from the directory
 *
 * No tabs, no federation clutter, no console — everything else lives in
 * the kernel where it belongs.
 */
import { useMemo, useState } from 'react'
import { Server, RefreshCw, Power, MessageCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { nhPost, ago } from './api'
import { useNh } from './store'
import { StatusDot } from './bits'
import { ChatApp } from './ChatApp'
import type { NodeDto } from './types'

export function MyNode() {
  const { me, data, refresh } = useNh()
  const { toast } = useToast()

  // My node = the one I own. Registration auto-creates it; the create card
  // below is the fallback (e.g. the kernel was down at sign-up).
  const myNode = useMemo<NodeDto | null>(
    () => data?.nodes.find((n) => n.ownerId === me?.id) ?? null,
    [data, me],
  )

  const [creating, setCreating] = useState(false)

  const createMyNode = async () => {
    setCreating(true)
    try {
      // id = name: the proxy stamps the node's code from the username.
      await nhPost('nodes', {})
      toast({ title: 'نود شما ساخته شد' })
      await refresh()
    } catch (err) {
      toast({ title: 'ساخت نود ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  if (!data) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <RefreshCw className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {myNode ? (
        <>
          <NodeHeader node={myNode} hostCode={data.host.code} />
          <ModuleSwitches node={myNode} modules={data.modules} />
          <AppMount node={myNode} />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-5" /> نود شخصی شما هنوز ساخته نشده
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground leading-6">
              نود شما سرور اشتراکیِ شخصی خودتان است و با ثبت‌نام معمولاً خودکار ساخته می‌شود؛
              اگر به هر دلیلی ساخته نشده بود (مثلاً قطعی موقت سرور)، همین‌جا یک‌کلیکی بسازید.
              کد نود شما همان نام کاربری‌تان است — آیدی و آدرس شبکه‌ای یکی می‌مانند.
            </p>
            <Button onClick={() => void createMyNode()} disabled={creating}>
              {creating ? 'در حال ساخت…' : 'ساخت نود من'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Node header — identity + status. Nothing else.
// ------------------------------------------------------------------
function NodeHeader({ node, hostCode }: { node: NodeDto; hostCode: string }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center">
            <Server className="size-5.5" />
          </div>
          <div>
            <div className="font-bold text-[15px] leading-6">{node.name}</div>
            <div className="text-[11px] text-muted-foreground ltr-block" dir="ltr">
              {node.code}@{hostCode}
            </div>
          </div>
        </div>
        <div className="h-8 w-px bg-border hidden sm:block" />
        <div className="flex items-center gap-2 text-sm">
          <StatusDot tone={node.status === 'active' ? 'green' : 'amber'} pulse />
          <span className="font-medium">
            {node.status === 'active' ? 'فعال و در حال اجرا' : 'معلق'}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">ساخته‌شده {ago(node.createdAt)}</div>
        <div className="flex-1" />
        <Badge variant="secondary">سرور شخصی شما</Badge>
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------------
// Modules — the test modules of the node with plain on/off switches.
// ------------------------------------------------------------------
function ModuleSwitches({
  node,
  modules,
}: {
  node: NodeDto
  modules: { id: string; name: string; description: string }[]
}) {
  const { refresh } = useNh()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (moduleId: string, enabled: boolean) => {
    setBusy(moduleId)
    try {
      await nhPost(`nodes/${node.id}/modules`, { moduleId, enabled })
      await refresh()
    } catch (err) {
      toast({ title: 'تغییر وضعیت ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const enabledCount = node.moduleStates.filter((s) => s.enabled).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Power className="size-5" /> ماژول‌های نود
          <Badge variant="outline" className="mr-1 font-normal">
            {enabledCount} از {modules.length} فعال
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {modules.map((m) => {
          const st = node.moduleStates.find((s) => s.moduleId === m.id)
          const on = !!st?.enabled
          return (
            <div key={m.id} className="flex items-center gap-4 py-3.5">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  {m.name}
                  <span className="text-[10px] text-muted-foreground ltr-block" dir="ltr">
                    {m.id}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-5">
                  {m.description}
                </div>
              </div>
              <Switch
                checked={on}
                disabled={busy === m.id}
                onCheckedChange={(v) => void toggle(m.id, v)}
                aria-label={`${on ? 'غیرفعال‌سازی' : 'فعال‌سازی'} ${m.name}`}
              />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------------
// App mount — every ENABLED module opens its own real app below the
// switches. The messenger (chat) is the built-in app of every node.
// ------------------------------------------------------------------
function AppMount({ node }: { node: NodeDto }) {
  const chatOn = node.moduleStates.find((s) => s.moduleId === 'chat')?.enabled ?? false
  if (chatOn) return <ChatApp node={node} />
  return (
    <Card>
      <CardContent className="py-8 text-center space-y-2">
        <MessageCircle className="size-7 mx-auto text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground leading-6">
          پیام‌رسان خاموش است — کلید آن را روشن کنید تا اپ کامل آن همین‌جا باز شود:
          گفتگو با هر نود شبکه، دفترچه گیرنده‌ها، تاریخچه و خوانده‌نشده‌ها.
        </p>
      </CardContent>
    </Card>
  )
}
