'use client'

/**
 * ConsoleTab — the admin console entry.
 * An admin binds to EXACTLY ONE node (per the architecture law) using
 * its token, over socket.io. The node stays online; the admin may leave.
 *
 * This file is the connect form; the live session lives in
 * ConsoleSessionView and its panels under ./panels.
 */
import { useMemo, useState } from 'react'
import { useNh, connectableHosts } from '../store'
import { SectionTitle } from '../bits'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlugZap } from 'lucide-react'
import type { ConsoleSession } from '../types'
import { ConsoleSessionView } from './ConsoleSessionView'

export function ConsoleTab() {
  const { data, session, setSession } = useNh()

  // ---- connect form state ----
  const [hostCode, setHostCode] = useState('')
  const [nodeCode, setNodeCode] = useState('')
  const [token, setToken] = useState('')

  const connectable = useMemo(() => connectableHosts(data), [data])

  // Effective host = user choice, else first connectable (derived state — no effect needed)
  const effHostCode = hostCode || connectable[0]?.code || ''

  const nodeListForHost = useMemo(() => {
    if (!data || !effHostCode) return []
    if (effHostCode === data.host.code) {
      return data.nodes.map((n) => ({ code: n.code, name: n.name, demoToken: n.isDemo ? n.token : undefined }))
    }
    return data.directory
      .filter((d) => d.hostCode === effHostCode)
      .map((d) => ({
        code: d.nodeCode,
        name: d.nodeName,
        demoToken: d.demoToken,
      }))
  }, [data, effHostCode])

  const connect = () => {
    const host = connectable.find((h) => h.code === effHostCode)
    if (!host || !nodeCode.trim() || !token.trim()) return
    const session: ConsoleSession = {
      hostCode: host.code,
      hostName: host.name,
      gwPort: host.gwPort,
      nodeCode: nodeCode.trim(),
      nodeName: nodeListForHost.find((n) => n.code === nodeCode)?.name ?? nodeCode.trim(),
      token: token.trim(),
    }
    setSession(session)
  }

  return (
    <div className="space-y-5">
      {!session ? (
        <section>
          <SectionTitle
            icon={<PlugZap />}
            title="اتصال ادمین به نود"
            sub="هر ادمین فقط و فقط به نود خودش وصل می‌شود"
          />
          <Card>
            <CardContent className="p-4 grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">میزبان</label>
                <Select
                  value={effHostCode}
                  onValueChange={(v) => {
                    setHostCode(v)
                    setNodeCode('')
                    setToken('')
                  }}
                >
                  <SelectTrigger aria-label="انتخاب میزبان"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {connectable.map((h) => (
                      <SelectItem key={h.code} value={h.code}>
                        {h.name} {h.kind === 'remote' && '(راه‌دور)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">نود</label>
                <Select value={nodeCode} onValueChange={(v) => {
                  setNodeCode(v)
                  const demo = nodeListForHost.find((n) => n.code === v)?.demoToken
                  if (demo) setToken(demo)
                }}>
                  <SelectTrigger aria-label="انتخاب نود"><SelectValue placeholder="انتخاب نود" /></SelectTrigger>
                  <SelectContent>
                    {nodeListForHost.map((n) => (
                      <SelectItem key={n.code} value={n.code}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">توکن ادمین</label>
                <Input
                  dir="ltr"
                  className="ltr-block"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="nh_… یا demo-token-…"
                />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={connect} disabled={!nodeCode || !token}>
                  <PlugZap className="size-4" /> اتصال به نود
                </Button>
              </div>
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground mt-2">
            نودهای دمو توکن ازپیش‌شناس دارند و با انتخاب، خودکار پر می‌شوند. توکن نودهای تازه‌سازی‌شده
            را از تب «نودها» بردارید.
          </p>
        </section>
      ) : (
        <ConsoleSessionView
          key={`${session.hostCode}:${session.nodeCode}`}
          session={session}
          onDisconnect={() => setSession(null)}
        />
      )}
    </div>
  )
}
