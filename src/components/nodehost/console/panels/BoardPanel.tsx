'use client'

/**
 * BoardPanel — broadcast board (broadcast module).
 * Publishing goes to (*,*); the sending kernel fans out per remote host
 * and per eligible local node. History = broadcast posts this node got.
 */
import { useCallback, useEffect, useState } from 'react'
import { ago } from '../../api'
import { StatusBadge, EmptyHint } from '../../bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { Megaphone, SendHorizontal } from 'lucide-react'
import type { ConsoleSession, MailRow } from '../../types'
import { STATUS_FA } from '../../types'
import { useConsoleSocket } from '../socket-context'
import { safeParse } from '../json'

export function BoardPanel({ session }: { session: ConsoleSession }) {
  const { conn, send, emit, onNhpIn } = useConsoleSocket()
  const connected = conn === 'connected'
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [items, setItems] = useState<MailRow[]>([])

  const load = useCallback(() => {
    emit('broadcast:history', {}, (res: { ok: boolean; items?: MailRow[] }) => {
      if (res.ok) setItems(res.items ?? [])
    })
  }, [emit])

  useEffect(() => {
    load()
    if (!connected) return
    return onNhpIn((env) => {
      if (env.type?.startsWith('broadcast.')) setTimeout(load, 150)
    })
  }, [connected, load, onNhpIn])

  const publish = () => {
    if (!title.trim()) return
    send(
      {
        to: { host: '*', node: '*' },
        module: 'broadcast',
        type: 'broadcast.publish',
        payload: { title: title.trim(), body: body.trim(), origin: `${session.nodeCode}@${session.hostCode}` },
      },
      (res) => {
        if (res.ok) {
          toast({ title: 'اعلان منتشر شد', description: `نتیجه: ${STATUS_FA[res.outcome] ?? res.outcome}` })
          setTitle('')
          setBody('')
          setTimeout(load, 300)
        }
      },
    )
  }

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Megaphone className="size-4 text-primary" /> انتشار اعلان همگانی
          </div>
          <p className="text-[11px] text-muted-foreground leading-5">
            اعلان با آدرس <code dir="ltr" className="ltr-block">(*,*)</code> منتشر می‌شود؛ هستهٔ شما به
            همهٔ میزبان‌های شناخته‌شده فوروارد می‌کند و هر هسته آن را به نودهایی که ماژول broadcast
            دارند می‌رساند.
          </p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان اعلان" disabled={!connected} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="متن اعلان (اختیاری)" rows={3} disabled={!connected} />
          <Button className="w-full" onClick={publish} disabled={!connected || !title.trim()}>
            <SendHorizontal className="size-4" /> انتشار در کل شبکه
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-3">اعلان‌های دریافت‌شده توسط این نود</div>
          {items.length === 0 ? (
            <EmptyHint>هنوز اعلانی دریافت نشده است.</EmptyHint>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto nh-scroll">
              {items.map((m) => {
                const p = safeParse<{ title?: string; body?: string; origin?: string }>(m.payload)
                return (
                  <div key={m.id} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm">{p.title}</div>
                      <StatusBadge status={m.status} label={STATUS_FA[m.status]} />
                    </div>
                    {p.body && <p className="text-xs text-muted-foreground leading-5 whitespace-pre-wrap">{p.body}</p>}
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <span dir="ltr" className="ltr-block">{p.origin ?? `${m.fromNode}@${m.fromHost}`}</span>
                      <span>·</span>
                      <span>{ago(m.createdAt)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
