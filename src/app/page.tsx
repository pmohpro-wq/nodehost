'use client'

/**
 * NodeHost — simple by design.
 * Each tab boots from its address bar (`?u=<id>`): identity → session →
 * panel. Guest tabs see the sign-in gate. Two tabs are two independent
 * users; logout in one never touches the other.
 */
import { useEffect } from 'react'
import { Header } from '@/components/nodehost/Header'
import { AuthGate } from '@/components/nodehost/AuthGate'
import { MyNode } from '@/components/nodehost/MyNode'
import { IntroduceHost } from '@/components/nodehost/IntroduceHost'
import { HostIdentity } from '@/components/nodehost/HostIdentity'
import { AdminUsers } from '@/components/nodehost/AdminUsers'
import { AdminNodes } from '@/components/nodehost/AdminNodes'
import { UI_POLL_MS, useNh } from '@/components/nodehost/store'
import { Network } from 'lucide-react'

export default function Home() {
  const { me, boot, refresh } = useNh()

  useEffect(() => {
    void boot()
    const t = setInterval(() => void refresh(), UI_POLL_MS)
    return () => clearInterval(t)
  }, [boot, refresh])

  // Viewer not resolved yet → tiny splash (avoids flashing the auth gate).
  if (me === undefined) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Network className="size-8 animate-pulse" />
          <span className="text-sm">در حال اتصال به نودهاست…</span>
        </div>
      </div>
    )
  }

  // Guest → auth only.
  if (!me) return <AuthGate />

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-6 space-y-6">
        <MyNode />
        <IntroduceHost />
        {me.role === 'admin' && <HostIdentity />}
        {me.role === 'admin' && <AdminUsers />}
        {me.role === 'admin' && <AdminNodes />}
      </main>

      <footer className="mt-auto border-t">
        <div className="mx-auto max-w-3xl px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div>نودهاست — سرور شخصیِ شما با ماژول‌های قابل فعال‌سازی</div>
          <div dir="ltr" className="ltr-block">
            NodeHost
          </div>
        </div>
      </footer>
    </div>
  )
}
