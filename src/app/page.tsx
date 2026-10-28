'use client'

/**
 * NodeHost — simple by design.
 * Guest → sign in / sign up. Member → MY node (one per user) with its
 * test modules. Admin additionally sees the user list. That's the whole app.
 */
import { useEffect } from 'react'
import { Header } from '@/components/nodehost/Header'
import { AuthGate } from '@/components/nodehost/AuthGate'
import { MyNode } from '@/components/nodehost/MyNode'
import { AdminUsers } from '@/components/nodehost/AdminUsers'
import { UI_POLL_MS, useNh } from '@/components/nodehost/store'
import { Network } from 'lucide-react'

export default function Home() {
  const { me, refresh, loadMe } = useNh()

  useEffect(() => {
    void loadMe()
    void refresh()
    const t = setInterval(() => void refresh(), UI_POLL_MS)
    return () => clearInterval(t)
  }, [loadMe, refresh])

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
        {me.role === 'admin' && <AdminUsers />}
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
