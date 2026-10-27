'use client'

/**
 * ChatPanel — direct node-to-node messaging (chat module).
 * Delivery model: the kernel persists every envelope in the target
 * node's mailbox; if the peer admin is offline it waits there. History
 * is read through the session socket (chat:history).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { clockOf } from '../../api'
import { StatusDot, EmptyHint } from '../../bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { MessageSquare, SendHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DirectoryEntry, MailRow } from '../../types'
import { useConsoleSocket, type WireEnvelope } from '../socket-context'
import { safeParse } from '../json'

const CHAT_TYPE = 'chat.message'

export function ChatPanel({ peers }: { peers: DirectoryEntry[] }) {
  const { conn, send, emit, onNhpIn } = useConsoleSocket()
  const connected = conn === 'connected'

  const chatPeers = peers.filter((p) => p.modules.includes('chat'))
  // Selected peer stored as raw state (React-Compiler-friendly deps)
  const [peerHost, setPeerHost] = useState('')
  const [peerNode, setPeerNode] = useState('')
  const [text, setText] = useState('')
  const [items, setItems] = useState<MailRow[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const peerEntry = chatPeers.find((p) => p.hostCode === peerHost && p.nodeCode === peerNode)

  const loadHistory = useCallback(() => {
    if (!peerHost || !peerNode) return
    emit('chat:history', { peerHost, peerNode }, (res: { ok: boolean; items?: MailRow[] }) => {
      if (res.ok) setItems(res.items ?? [])
    })
  }, [emit, peerHost, peerNode])

  // refresh the conversation when an incoming chat envelope arrives
  useEffect(() => {
    if (!connected) return
    return onNhpIn((env: WireEnvelope) => {
      if (env.type !== CHAT_TYPE) return
      if (peerHost && env.fromHost === peerHost && env.fromNode === peerNode) {
        setTimeout(loadHistory, 150)
      }
    })
  }, [connected, peerHost, peerNode, loadHistory, onNhpIn])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [items])

  const sendMsg = () => {
    if (!peerEntry || !text.trim()) return
    send(
      {
        to: { host: peerEntry.hostCode, node: peerEntry.nodeCode },
        module: 'chat',
        type: CHAT_TYPE,
        payload: { text: text.trim() },
      },
      (res) => {
        if (res.ok) {
          setText('')
          setTimeout(loadHistory, 250)
        }
      },
    )
  }

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-3">
      {/* Peer list */}
      <Card>
        <CardContent className="p-2">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">نودهای قابل گفتگو (ماژول chat فعال دارند)</div>
          {chatPeers.length === 0 && <div className="p-3 text-xs text-muted-foreground">هنوز هیچ نودی در دایرکتوری نیست.</div>}
          <div className="space-y-1 max-h-72 overflow-y-auto nh-scroll">
            {chatPeers.map((p) => (
              <button
                key={`${p.hostCode}:${p.nodeCode}`}
                onClick={() => {
                  setPeerHost(p.hostCode)
                  setPeerNode(p.nodeCode)
                }}
                className={cn(
                  'w-full text-right rounded-lg px-2.5 py-2 transition-colors',
                  peerHost === p.hostCode && peerNode === p.nodeCode
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-muted border border-transparent',
                )}
              >
                <div className="text-xs font-medium flex items-center gap-1.5">
                  <StatusDot tone={p.adminOnline ? 'green' : 'slate'} pulse={p.adminOnline} />
                  <span className="truncate">{p.nodeName}</span>
                </div>
                <div className="text-[10px] text-muted-foreground ltr-block" dir="ltr">
                  {p.nodeCode}@{p.hostCode}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Conversation */}
      <Card className="flex flex-col min-h-[380px]">
        <CardContent className="p-0 flex flex-col flex-1">
          <div className="px-4 py-2.5 border-b text-sm font-medium flex items-center gap-2">
            {peerEntry ? (
              <>
                <MessageSquare className="size-4 text-primary" />
                گفتگو با {peerEntry.nodeName}
                <span className="text-[10px] text-muted-foreground ltr-block" dir="ltr">
                  {peerEntry.nodeCode}@{peerEntry.hostCode}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-xs">یک نود را از فهرست انتخاب کنید</span>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto nh-scroll p-4 space-y-2 min-h-[280px] max-h-[420px]">
            {items.length === 0 && (
              <EmptyHint>
                پیامی نیست. اولین پیام را بفرستید — اگر ادمین مقصد غایب باشد، پیام در صندوق نود او می‌ماند.
              </EmptyHint>
            )}
            {items.map((m) => {
              const mine = m.direction === 'out'
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-start' : 'justify-end')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                      mine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm',
                    )}
                  >
                    <div className="leading-6 whitespace-pre-wrap break-words">
                      {safeParse<{ text?: string }>(m.payload).text ?? '—'}
                    </div>
                    <div className={cn('text-[9px] mt-0.5 flex items-center gap-1', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                      <span className="tabular-nums">{clockOf(m.createdAt)}</span>
                      {m.status === 'queued' && <span>· در انتظار ادمین مقصد</span>}
                      {m.status === 'dead' && <span>· منقضی</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <Separator />
          <div className="p-3 flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMsg()}
              placeholder={peerEntry ? 'پیام… (Enter برای ارسال)' : 'ابتدا نود مقصد را انتخاب کنید'}
              disabled={!peerEntry || !connected}
            />
            <Button onClick={sendMsg} disabled={!peerEntry || !connected || !text.trim()} aria-label="ارسال پیام">
              <SendHorizontal className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
