'use client'

/**
 * NodeHost — federated node architecture control panel.
 * Single-page app: dashboard / nodes / admin console / network / protocol.
 */
import { useEffect } from 'react'
import { Header } from '@/components/nodehost/Header'
import { DashboardTab } from '@/components/nodehost/DashboardTab'
import { NodesTab } from '@/components/nodehost/NodesTab'
import { ConsoleTab } from '@/components/nodehost/console/ConsoleTab'
import { NetworkTab } from '@/components/nodehost/NetworkTab'
import { ProtocolTab } from '@/components/nodehost/ProtocolTab'
import { UI_POLL_MS, loadSession, openConsoleForLocalNode, useNh } from '@/components/nodehost/store'

export default function Home() {
  const { tab, setTab, refresh, setSession } = useNh()

  // Restore persisted console session + ONE live poll (bootstrap refresh
  // also keeps the directory fresh while a console session is active).
  useEffect(() => {
    const s = loadSession()
    if (s) setSession(s)
    void refresh()
    const t = setInterval(() => void refresh(), UI_POLL_MS)
    return () => clearInterval(t)
  }, [setSession, refresh])

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
