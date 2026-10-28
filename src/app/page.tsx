'use client'

/**
 * NodeHost — federated node architecture control panel.
 * Tenant gate first: guests get the auth screen, members get the panel.
 * Single-page app: dashboard / nodes / admin console / network / protocol / admin.
 */
import { useEffect } from 'react'
import { Header } from '@/components/nodehost/Header'
import { AuthGate } from '@/components/nodehost/AuthGate'
import { DashboardTab } from '@/components/nodehost/DashboardTab'
import { NodesTab } from '@/components/nodehost/NodesTab'
import { ConsoleTab } from '@/components/nodehost/console/ConsoleTab'
import { NetworkTab } from '@/components/nodehost/NetworkTab'
import { ProtocolTab } from '@/components/nodehost/ProtocolTab'
import { AdminTab } from '@/components/nodehost/AdminTab'
import { UI_POLL_MS, loadSession, openConsoleForLocalNode, useNh } from '@/components/nodehost/store'
import { Network } from 'lucide-react'

export default function Home() {
  const { me, tab, setTab, refresh, loadMe, setSession } = useNh()

  // Resolve the viewer, restore persisted console session + ONE live poll
  // (bootstrap refresh also re-evaluates the session on every tick).
  useEffect(() => {
    const s = loadSession()
    if (s) setSession(s)
    void loadMe()
    void refresh()
    const t = setInterval(() => void refresh(), UI_POLL_MS)
    return () => clearInterval(t)
  }, [setSession, loadMe, refresh])

  // Viewer not resolved yet → tiny splash (avoids flashing the auth gate).
  if (me === undefined) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Network className="size-8 animate-pulse" />
          <span className="text-sm">در حال اتصال به میزبان…</span>
        </div>
      </div>
    )
  }

  // Guest → auth only.
  if (!me) return <AuthGate />

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'nodes' && (
          <NodesTab onGoConsole={(code, token) => openConsoleForLocalNode(code, token)} />
        )}
        {tab === 'console' && <ConsoleTab />}
        {tab === 'network' && <NetworkTab />}
        {tab === 'protocol' && <ProtocolTab />}
        {tab === 'admin' && me.role === 'admin' && <AdminTab />}
      </main>

      <footer className="mt-auto border-t">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div>
            نودهاست — معماری فدرال نودها · پروتکل NHP v1 · متن‌باز برای توسعهٔ آزاد
          </div>
          <div dir="ltr" className="ltr-block">
            NodeHost Kernel + Next.js Control Panel
          </div>
        </div>
      </footer>
    </div>
  )
}
