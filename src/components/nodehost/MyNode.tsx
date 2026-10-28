'use client'

/**
 * MyNode — the WHOLE product in one screen.
 *
 * The user's node is their personal shared server. This view shows:
 *   1. the node (name, code, status) — created automatically at sign-up
 *   2. the test modules with plain on/off switches
 *   3. a tiny live test: send a chat message to the node and watch the feed
 *
 * No tabs, no federation clutter, no console — everything else lives in
 * the kernel where it belongs.
 */
import { useEffect, useMemo, useState } from 'react'
import { Server, RefreshCw, SendHorizontal, Power, MessageSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { nhGet, nhPost, ago } from './api'
import { useNh } from './store'
import { StatusDot } from './bits'
import type { MailRow, NodeDto } from './types'

export function MyNode() {
  const { me, data, refresh } = useNh()
  const { toast } = useToast()

  // My node = the one I own. Registration auto-creates it; the create card
  // below is the fallback (e.g. the kernel was down at sign-up).
  const myNode = useMemo<NodeDto | null>(
    () => data?.nodes.find((n) => n.ownerId === me?.id) ?? null,
    [data, me],
  )

  const [nodeName, setNodeName] = useState('')
  const [creating, setCreating] = useState(false)

  const createMyNode = async () => {
    setCreating(true)
    try {
      await nhPost('nodes', { name: nodeName.trim() || `نود ${me?.name ?? ''}` })
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
          <NodeHeader node={myNode} hostName={data.host.name} />
          <ModuleSwitches node={myNode} modules={data.modules} />
          <LiveTest node={myNode} />
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
              نود شما سرور اشتراکیِ شخصی خودتان است. یک نام برایش انتخاب کنید — با ثبت‌نام معمولاً
              خودکار ساخته می‌شود؛ اگر به هر دلیلی ساخته نشده، همین‌جا یک‌کلیکی بسازید.
            </p>
            <div className="flex gap-2">
              <Input
                dir="auto"
                placeholder={`نود ${me?.name ?? ''}`}
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                className="max-w-xs"
              />
              <Button onClick={() => void createMyNode()} disabled={creating}>
                {creating ? 'در حال ساخت…' : 'ساخت نود من'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Node header — identity + status. Nothing else.
// ------------------------------------------------------------------
function NodeHeader({ node, hostName }: { node: NodeDto; hostName: string }) {
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
              {node.code}@{hostName}
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
// Live test — send a chat message to MY node and watch the feed.
// Proves the node (and its chat module) actually works.
// ------------------------------------------------------------------
function LiveTest({ node }: { node: NodeDto }) {
  const { data, refresh } = useNh()
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const chatOn = node.moduleStates.find((s) => s.moduleId === 'chat')?.enabled ?? false

  // Feed refreshes with the panel's 5s poll — no extra timers.
  const [rows, setRows] = useState<MailRow[]>([])
  useEffect(() => {
    if (!chatOn) return
    let alive = true
    nhGet<{ ok: boolean; items: MailRow[] }>(`mailbox/${node.code}?status=delivered`)
      .then((res) => {
        if (!alive) return
        setRows(
          res.items
            .filter((r) => r.module === 'chat')
            .slice(-8)
            .reverse(),
        )
      })
      .catch(() => {
        /* temporary — next poll retries */
      })
    return () => {
      alive = false
    }
  }, [data, chatOn, node.code])

  const loadFeedNow = async () => {
    try {
      const res = await nhGet<{ ok: boolean; items: MailRow[] }>(
        `mailbox/${node.code}?status=delivered`,
      )
      setRows(
        res.items
          .filter((r) => r.module === 'chat')
          .slice(-8)
          .reverse(),
      )
    } catch {
      /* temporary — next poll retries */
    }
  }

  const send = async () => {
    if (!text.trim()) return
    setSending(true)
    try {
      await nhPost(`nodes/${node.id}/send`, {
        module: 'chat',
        type: 'msg.post',
        payload: { text: text.trim() },
      })
      setText('')
      toast({ title: 'پیام آزمایشی ارسال شد' })
      await refresh()
      await loadFeedNow()
    } catch (err) {
      toast({ title: 'ارسال ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-5" /> آزمایش زندهٔ نود
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {chatOn ? (
          <>
            <div className="flex gap-2">
              <Input
                dir="auto"
                placeholder="یک پیام برای نود خودتان بنویسید…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
              />
              <Button onClick={() => void send()} disabled={sending || !text.trim()}>
                <SendHorizontal className="size-4" /> ارسال
              </Button>
            </div>
            <Separator />
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
                هنوز پیامی نیست — یکی بفرستید تا تحویل نودتان را ببینید.
              </p>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border px-3 py-2 flex items-start gap-3 text-sm"
                  >
                    <Badge variant={r.direction === 'in' ? 'secondary' : 'outline'} className="shrink-0">
                      {r.direction === 'in' ? 'دریافتی' : 'ارسالی'}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{safeText(r.payload)}</div>
                      <div className="text-[10px] text-muted-foreground ltr-block" dir="ltr">
                        {r.fromNode} · {ago(r.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground leading-6">
            برای آزمایش زنده، اول ماژول <span className="font-medium">چت</span> را از فهرست بالا
            فعال کنید — پیام شما به نود خودتان ارسال و در همین‌جا نمایش داده می‌شود.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function safeText(payloadJson: string): string {
  try {
    const p = JSON.parse(payloadJson) as { text?: string }
    return p.text ?? payloadJson
  } catch {
    return payloadJson
  }
}
