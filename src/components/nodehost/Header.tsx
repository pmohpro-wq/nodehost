'use client'

import { useNh } from './store'
import { StatusDot } from './bits'
import { Button } from '@/components/ui/button'
import { useTheme } from 'next-themes'
import { Moon, Sun, Network, Monitor, Boxes, TerminalSquare, Globe2, BookOpenText } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'dashboard', label: 'داشبورد', icon: Monitor },
  { id: 'nodes', label: 'نودها', icon: Boxes },
  { id: 'console', label: 'کنسول ادمین', icon: TerminalSquare },
  { id: 'network', label: 'شبکه', icon: Globe2 },
  { id: 'protocol', label: 'پروتکل', icon: BookOpenText },
]

export function Header() {
  const { data, tab, setTab, session } = useNh()
  const { resolvedTheme, setTheme } = useTheme()

  const host = data?.host

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center">
              <Network className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="font-extrabold text-[15px]">نودهاست</div>
              <div className="text-[10px] text-muted-foreground hidden sm:block">
                معماری فدرال نودها — NHP v1
              </div>
            </div>
          </div>

          {/* Host identity chip */}
          {host && (
            <div className="hidden md:flex items-center gap-2 rounded-full border px-3 py-1 text-xs mr-2">
              <StatusDot tone={host.status === 'online' ? 'green' : 'amber'} pulse />
              <span className="font-medium">{host.name}</span>
              <span className="text-muted-foreground ltr-block" dir="ltr">
                {host.code}
              </span>
            </div>
          )}

          <div className="flex-1" />

          {/* Console session indicator */}
          {session && (
            <div className="hidden lg:flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              <StatusDot tone="green" pulse />
              ادمینِ <span className="font-medium ltr-block" dir="ltr">{session.nodeCode}</span>
            </div>
          )}

          {/* Theme toggle (CSS-only swap — no hydration mismatch) */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="تغییر پوسته"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="size-9"
          >
            <Sun className="hidden dark:size-4.5 dark:block" />
            <Moon className="size-4.5 dark:hidden" />
          </Button>
        </div>

        {/* Tabs */}
        <nav aria-label="بخش‌ها" className="flex gap-1 overflow-x-auto nh-scroll pb-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
