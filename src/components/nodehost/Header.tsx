'use client'

/** Header — brand, host chip, user chip, logout, theme. No tabs anymore. */
import { useNh } from './store'
import { StatusDot } from './bits'
import { Button } from '@/components/ui/button'
import { useTheme } from 'next-themes'
import { Moon, Sun, Network, LogOut } from 'lucide-react'

export function Header() {
  const { data, me, logout } = useNh()
  const { resolvedTheme, setTheme } = useTheme()

  const host = data?.host

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto max-w-3xl px-4">
        <div className="flex h-14 items-center gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center">
              <Network className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="font-extrabold text-[15px]">نودهاست</div>
              <div className="text-[10px] text-muted-foreground hidden sm:block">
                سرور شخصی شما
              </div>
            </div>
          </div>

          {/* Host identity chip */}
          {host && (
            <div className="hidden md:flex items-center gap-2 rounded-full border px-3 py-1 text-xs mr-2">
              <StatusDot tone="green" pulse />
              <span className="font-medium">{host.name}</span>
              <span className="text-muted-foreground ltr-block" dir="ltr">
                {host.code}
              </span>
            </div>
          )}

          <div className="flex-1" />

          {/* Signed-in user chip */}
          {me && (
            <div className="hidden sm:flex items-center gap-2 rounded-full border px-3 py-1 text-[11px]">
              <span className="font-medium">{me.name}</span>
              <span className="text-muted-foreground">
                {me.role === 'admin' ? 'ادمین' : 'کاربر'}
              </span>
            </div>
          )}

          {/* Logout */}
          {me && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="خروج از حساب"
              title="خروج از حساب"
              onClick={() => void logout()}
              className="size-9 text-muted-foreground hover:text-rose-600"
            >
              <LogOut className="size-4.5" />
            </Button>
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
      </div>
    </header>
  )
}
