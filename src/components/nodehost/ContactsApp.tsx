'use client'

/**
 * ContactsApp — the node's personal address book, mounted when the owner
 * enables the contacts module.
 *
 * What it is NOT: the network directory. The directory is what the network
 * knows (ephemeral, shared, unbounded). Contacts are what THIS user knows:
 * persistent, curated, bounded — served by the module's own app API at
 * nodes/<id>/apps/contacts/*.
 *
 *  - Add from the network directory (one click)…
 *  - …or by raw address: a user on THIS host (`علی`) or on any federated
 *    host (`علی@بتا`) — even hosts this server has never heard of. The
 *    phone-book model: saving an address costs nothing, resolution happens
 *    at send time, and the row survives peers leaving the network forever.
 *  - Presence (online / in-network / saved-only) is computed by the kernel
 *    at read time — never stored, never stale.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookUser,
  Check,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { nhGet, nhPost } from './api'
import { useNh } from './store'
import type { NodeDto } from './types'

interface Peer {
  host: string
  node: string
}

interface Presence {
  known: boolean
  online: boolean
  hasChat: boolean
  hostName: string
}

interface ContactRow {
  host: string
  node: string
  name: string
  note: string
  pinned: boolean
  addedAt: number
  presence: Presence
}

interface ListReply {
  ok: boolean
  me: { host: string; node: string; name: string }
  total: number
  contacts: ContactRow[]
}

const peerKey = (p: Peer) => `${p.host}|${p.node}`

export function ContactsApp({ node }: { node: NodeDto }) {
  const { toast } = useToast()
  const base = `nodes/${node.id}/apps/contacts`
  const directory = useNh((s) => s.data?.directory ?? [])
  const focusChat = useNh((s) => s.focusChat)
  const chatOn = node.moduleStates.some((s) => s.moduleId === 'chat' && s.enabled)

  const [rows, setRows] = useState<ContactRow[]>([])
  const [me, setMe] = useState<ListReply['me'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  // add-by-address form
  const [addNode, setAddNode] = useState('')
  const [addHost, setAddHost] = useState('')
  const [adding, setAdding] = useState(false)

  // add-from-directory picker
  const [picker, setPicker] = useState('')

  // inline editor
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editNote, setEditNote] = useState('')

  // two-click delete confirm
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const qRef = useRef(q)
  qRef.current = q

  const load = useCallback(async () => {
    try {
      const res = await nhGet<ListReply>(`${base}/list`)
      setRows(res.contacts ?? [])
      setMe(res.me ?? null)
    } catch {
      /* kernel hiccup — next tick retries */
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  const addByAddress = async () => {
    const id = addNode.trim()
    const host = addHost.trim() || me?.host || ''
    if (!id || !host) {
      toast({ title: 'شناسهٔ مخاطب را وارد کنید', variant: 'destructive' })
      return
    }
    setAdding(true)
    try {
      const res = await nhPost<{ ok: boolean; alreadyExisted: boolean }>(`${base}/add`, {
        host,
        node: id,
      })
      setAddNode('')
      setAddHost('')
      toast({
        title: res.alreadyExisted ? 'از قبل در مخاطبین شما بود — به‌روزرسانی شد' : 'به مخاطبین اضافه شد',
      })
      await load()
    } catch (err) {
      toast({ title: 'افزودن ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  const addFromPicker = async () => {
    if (!picker) return
    const [host, nodeId] = picker.split('|')
    if (!host || !nodeId) return
    const d = directory.find((x) => x.hostCode === host && x.nodeCode === nodeId)
    setAdding(true)
    try {
      await nhPost(`${base}/add`, {
        host,
        node: nodeId,
        name: d?.nodeName ?? '',
      })
      setPicker('')
      toast({ title: 'به مخاطبین اضافه شد' })
      await load()
    } catch (err) {
      toast({ title: 'افزودن ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  const patch = async (row: ContactRow, body: Record<string, unknown>, okMsg: string) => {
    try {
      await nhPost(`${base}/update`, { host: row.host, node: row.node, ...body })
      toast({ title: okMsg })
      await load()
    } catch (err) {
      toast({ title: 'تغییر ناموفق بود', description: String(err), variant: 'destructive' })
    }
  }

  const remove = async (row: ContactRow) => {
    try {
      await nhPost(`${base}/remove`, { host: row.host, node: row.node })
      setConfirmDel(null)
      await load()
    } catch (err) {
      toast({ title: 'حذف ناموفق بود', description: String(err), variant: 'destructive' })
    }
  }

  const startEdit = (row: ContactRow) => {
    setEditing(peerKey(row))
    setEditName(row.name)
    setEditNote(row.note)
  }

  // Directory picker options: everyone in the live network who is not
  // already saved (and not me).
  const knownKeys = new Set(rows.map((r) => peerKey(r)))
  const pickerOptions = directory.filter(
    (d) =>
      !(d.hostCode === me?.host && d.nodeCode === me?.node) && !knownKeys.has(`${d.hostCode}|${d.nodeCode}`),
  )

  // Client-side search on a bounded list (≤500 — the kernel enforces the cap).
  const needle = q.trim().toLowerCase()
  const visible = needle
    ? rows.filter((r) => `${r.name} ${r.node} ${r.host}`.toLowerCase().includes(needle))
    : rows
  const pinnedCount = rows.filter((r) => r.pinned).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookUser className="size-5" /> مخاطبین
          <Badge variant="outline" className="mr-1 font-normal">
            {rows.length} مخاطب{pinnedCount > 0 ? ` · ${pinnedCount} نشانک` : ''}
          </Badge>
          {loading && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ---- add: from the live directory ---- */}
        <div className="rounded-xl border p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <UserPlus className="size-3.5" /> افزودن مخاطب
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={picker}
              onChange={(e) => setPicker(e.target.value)}
              className="h-9 flex-1 min-w-[180px] rounded-md border bg-background px-3 text-sm"
              aria-label="انتخاب از دفترچهٔ شبکه"
            >
              <option value="">از دفترچهٔ شبکه انتخاب کنید…</option>
              {pickerOptions.map((d) => (
                <option key={`${d.hostCode}|${d.nodeCode}`} value={`${d.hostCode}|${d.nodeCode}`}>
                  {d.nodeName} — {d.nodeCode}
                  {d.hostCode !== me?.host ? `@${d.hostCode}` : ''}
                </option>
              ))}
            </select>
            <Button onClick={() => void addFromPicker()} disabled={!picker || adding} size="sm">
              افزودن
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              dir="auto"
              className="h-9 flex-1 min-w-[140px]"
              placeholder="شناسهٔ کاربر (مثلاً علی)"
              value={addNode}
              onChange={(e) => setAddNode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addByAddress()}
            />
            <span className="text-muted-foreground text-sm" dir="ltr">
              @
            </span>
            <Input
              dir="ltr"
              className="h-9 w-40"
              placeholder={`میزبان (${me?.host ?? 'همین سرور'})`}
              value={addHost}
              onChange={(e) => setAddHost(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addByAddress()}
            />
            <Button onClick={() => void addByAddress()} disabled={adding || !addNode.trim()} size="sm" variant="secondary">
              ذخیرهٔ آدرس
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-5">
            می‌توانید آدرس کاربری را ذخیره کنید که هنوز در شبکه نیست؛ مخاطبین شما دائمی می‌مانند و
            حضورشان به‌محض دیده‌شدن در شبکه نمایش داده می‌شود. میزبان را خالی بگذارید یعنی همین سرور.
          </p>
        </div>

        {/* ---- search ---- */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            dir="auto"
            className="pr-9"
            placeholder="جستجو در مخاطبین…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {/* ---- the book ---- */}
        <div className="rounded-xl border overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground leading-6 px-4 py-8 text-center">
                {rows.length === 0
                  ? 'دفترچهٔ شما خالی است — از دفترچهٔ شبکه اضافه کنید یا آدرس یک کاربر را ذخیره کنید. مخاطبین حتی اگر نودشان از شبکه خارج شود باقی می‌مانند.'
                  : 'موردی مطابق جستجو پیدا نشد.'}
              </p>
            ) : (
              visible.map((r) => {
                const k = peerKey(r)
                const display = r.name || r.node
                const isEditing = editing === k
                const presenceTone = r.presence.online
                  ? 'bg-emerald-500'
                  : r.presence.known
                    ? 'bg-zinc-400'
                    : 'bg-amber-400'
                const presenceLabel = r.presence.online
                  ? 'آنلاین'
                  : r.presence.known
                    ? 'در شبکه'
                    : 'آدرس ذخیره‌شده'
                return (
                  <div key={k} className="px-3 py-2.5">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            dir="auto"
                            className="h-8 text-sm"
                            placeholder="نام مستعار (اختیاری)"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <Input
                            dir="auto"
                            className="h-8 text-sm"
                            placeholder="یادداشت (اختیاری)"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() => {
                              void patch(r, { name: editName, note: editNote }, 'مخاطب به‌روزرسانی شد')
                              setEditing(null)
                            }}
                          >
                            <Check className="size-4" /> ذخیره
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}>
                            <X className="size-4" /> انصراف
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                          <div className="size-9 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-bold">
                            {display.slice(0, 1)}
                          </div>
                          <span
                            className={`absolute -bottom-0.5 -left-0.5 size-3 rounded-full border-2 border-background ${presenceTone}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {r.pinned && <Pin className="size-3 text-primary shrink-0" />}
                            <span className="font-medium text-sm truncate">{r.name || r.node}</span>
                            {r.name && (
                              <span className="text-[10px] text-muted-foreground truncate" dir="ltr">
                                {r.node}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate" dir="ltr">
                            {r.node}@{r.presence.hostName || r.host}
                            {r.presence.hostName && r.presence.hostName !== r.host ? ` (${r.host})` : ''}
                          </div>
                          {r.note && <div className="text-[11px] italic text-muted-foreground mt-0.5 truncate">{r.note}</div>}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">
                          {presenceLabel}
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            title={r.pinned ? 'برداشتن نشانک' : 'نشانک‌گذاری (بالای فهرست)'}
                            onClick={() =>
                              void patch(
                                r,
                                { pinned: !r.pinned },
                                r.pinned ? 'نشانک برداشته شد' : 'نشانک گذاشته شد',
                              )
                            }
                          >
                            {r.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                          </Button>
                          {chatOn && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              title="گفتگو"
                              onClick={() => {
                                if (r.presence.known) focusChat({ host: r.host, node: r.node })
                                else
                                  toast({
                                    title: 'این مخاطب هنوز در شبکه دیده نشده',
                                    description: 'به‌محض آنکه نودش در شبکه ظاهر شود، گفتگو ممکن می‌شود.',
                                  })
                              }}
                            >
                              <MessageCircle className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            title="ویرایش نام و یادداشت"
                            onClick={() => startEdit(r)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant={confirmDel === k ? 'destructive' : 'ghost'}
                            className="size-7"
                            title={confirmDel === k ? 'برای تأیید کلیک کنید' : 'حذف مخاطب'}
                            onClick={() => {
                              if (confirmDel === k) void remove(r)
                              else {
                                setConfirmDel(k)
                                setTimeout(() => setConfirmDel((c) => (c === k ? null : c)), 3000)
                              }
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
