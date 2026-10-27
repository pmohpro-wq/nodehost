'use client'

/**
 * NodeHost — federated node architecture control panel.
 * Single-page app: dashboard / nodes / admin console / network / protocol.
 */
import { useEffect } from 'react'
import { Header } from '@/components/nodehost/Header'
import { DashboardTab } from '@/components/nodehost/DashboardTab'
import { NodesTab } from '@/components/nodehost/NodesTab'
import { ConsoleTab } from '@/components/nodehost/ConsoleTab'
import { NetworkTab } from '@/components/nodehost/NetworkTab'
import { ProtocolTab } from '@/components/nodehost/ProtocolTab'
import { useNh, loadSession } from '@/components/nodehost/store'

export default function Home() {
  const { tab, setTab, refresh, session, setSession } = useNh()

  // Restore persisted console session + start live polling
  useEffect(() => {
    const s = loadSession()
    if (s) setSession(s)
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [])

  // Keep the live directory fresh while the console is connected
  useEffect(() => {
    if (!session) return
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [session, refresh])

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'nodes' && (
          <NodesTab
            onGoConsole={(code, token) => {
              // shortcut: connect console to a LOCAL node in one click
              const s = loadSession()
              void s
              useNh.getState().setSession({
                hostCode: useNh.getState().data?.host.code ?? '',
                hostName: useNh.getState().data?.host.name ?? '',
                gwPort: useNh.getState().data?.host.gwPort ?? null,
                nodeCode: code,
                nodeName: useNh.getState().data?.nodes.find((n) => n.code === code)?.name ?? code,
                token,
              })
              setTab('console')
            }}
          />
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
