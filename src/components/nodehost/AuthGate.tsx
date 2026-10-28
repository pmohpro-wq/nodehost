'use client'

/**
 * AuthGate — the tenant door of NodeHost, built for FAST testing.
 * Default tab: quick entry — just a username, account + personal node ready
 * in one click. A full account (email + password) stays available for people
 * who want to log back in later. First registrant = instance admin.
 */
import { useState } from 'react'
import { Network, LogIn, UserPlus, ShieldCheck, Zap } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { nhJson } from './api'
import { useNh } from './store'
import type { ViewerInfo } from './types'

interface AuthOk {
  ok: boolean
  user: ViewerInfo
  nodeCreated?: boolean
  mode?: 'quick' | 'full'
}

export function AuthGate() {
  const { toast } = useToast()
  const { loadMe, refresh, firstUserPending } = useNh()
  const [busy, setBusy] = useState(false)

  const [quickName, setQuickName] = useState('')

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPw, setLoginPw] = useState('')

  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPw, setRegPw] = useState('')

  const done = async (msg: string) => {
    toast({ title: msg })
    await loadMe()
    await refresh()
  }

  const welcome = (res: AuthOk) =>
    res.user.role === 'admin'
      ? 'ثبت‌نام شدید — شما ادمین این نودهاست هستید'
      : res.nodeCreated === false
        ? 'ثبت‌نام انجام شد — نود شما را می‌توانید از پنل بسازید'
        : 'خوش آمدید — نود شخصی شما آماده است'

  const quickStart = async () => {
    if (!quickName.trim()) return
    setBusy(true)
    try {
      const res = await nhJson<AuthOk>('/api/auth/register', 'POST', { name: quickName.trim() })
      await done(welcome(res))
    } catch (err) {
      toast({ title: 'ورود سریع ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const login = async () => {
    if (!loginEmail.trim() || !loginPw) return
    setBusy(true)
    try {
      await nhJson<AuthOk>('/api/auth/login', 'POST', {
        email: loginEmail.trim(),
        password: loginPw,
      })
      await done('خوش آمدید')
    } catch (err) {
      toast({ title: 'ورود ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    if (!regEmail.trim() || !regName.trim() || regPw.length < 8) return
    setBusy(true)
    try {
      const res = await nhJson<AuthOk>('/api/auth/register', 'POST', {
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPw,
      })
      await done(welcome(res))
    } catch (err) {
      toast({ title: 'ثبت‌نام ناموفق بود', description: String(err), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <main className="flex-1 grid place-items-center px-4 py-10">
        <div className="w-full max-w-md space-y-5">
          {/* Brand hero */}
          <div className="text-center space-y-2">
            <div className="mx-auto size-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow-sm">
              <Network className="size-7" />
            </div>
            <h1 className="text-2xl font-extrabold">نودهاست</h1>
            <p className="text-sm text-muted-foreground leading-6">
              فقط یک نام کاربری بنویسید — <span className="font-medium text-foreground">نود شخصی شما فوراً آماده می‌شود</span>{" "}
              با چند ماژول تستی که هر لحظه فعال یا غیرفعالشان می‌کنید.
            </p>
          </div>

          <Card>
            <CardContent className="p-6">
              <Tabs defaultValue="quick" dir="rtl">
                <TabsList className="grid grid-cols-3 w-full mb-4">
                  <TabsTrigger value="quick" className="gap-1.5">
                    <Zap className="size-3.5" /> سریع
                  </TabsTrigger>
                  <TabsTrigger value="register" className="gap-1.5">
                    <UserPlus className="size-3.5" /> حساب کامل
                  </TabsTrigger>
                  <TabsTrigger value="login" className="gap-1.5">
                    <LogIn className="size-3.5" /> ورود
                  </TabsTrigger>
                </TabsList>

                {/* ---- quick: username only ---- */}
                <TabsContent value="quick" className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="quick-name">نام کاربری</Label>
                    <Input
                      id="quick-name"
                      dir="auto"
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && quickStart()}
                      placeholder="مثلاً: سارا"
                      autoFocus
                    />
                  </div>
                  <Button className="w-full" onClick={quickStart} disabled={busy || quickName.trim().length < 2}>
                    <Zap className="size-4" /> شروع سریع — ساخت نود من
                  </Button>
                  <p className="text-[11px] text-muted-foreground leading-5 text-center">
                    حسابِ تست بدون ایمیل و رمز؛ نشست شما با کوکی نگه داشته می‌شود. برای ورود دوباره
                    بعد از خروج، از «حساب کامل» استفاده کنید.
                  </p>
                </TabsContent>

                {/* ---- full account ---- */}
                <TabsContent value="register" className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-name">نام نمایشی</Label>
                    <Input
                      id="reg-name"
                      dir="auto"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="مثلاً: سارا محمدی"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-email">ایمیل</Label>
                    <Input
                      id="reg-email"
                      dir="ltr"
                      type="email"
                      autoComplete="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-pw">رمز عبور (حداقل ۸ نویسه)</Label>
                    <Input
                      id="reg-pw"
                      dir="ltr"
                      type="password"
                      autoComplete="new-password"
                      value={regPw}
                      onChange={(e) => setRegPw(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && register()}
                      placeholder="••••••••"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={register}
                    disabled={busy || !regName.trim() || !regEmail.trim() || regPw.length < 8}
                  >
                    <UserPlus className="size-4" /> ساخت حساب و ورود
                  </Button>
                </TabsContent>

                {/* ---- login ---- */}
                <TabsContent value="login" className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email">ایمیل</Label>
                    <Input
                      id="login-email"
                      dir="ltr"
                      type="email"
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && login()}
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="login-pw">رمز عبور</Label>
                    <Input
                      id="login-pw"
                      dir="ltr"
                      type="password"
                      autoComplete="current-password"
                      value={loginPw}
                      onChange={(e) => setLoginPw(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && login()}
                      placeholder="••••••••"
                    />
                  </div>
                  <Button className="w-full" onClick={login} disabled={busy || !loginEmail.trim() || !loginPw}>
                    <LogIn className="size-4" /> ورود به پنل
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* First-admin hint — shown only while the instance has no admin */}
          {firstUserPending && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs leading-6 text-amber-700 dark:text-amber-400">
              <ShieldCheck className="size-4 mt-1 shrink-0" />
              <span>
                این نودهاست هنوز ادمین ندارد. <b>نخستین کاربری که وارد شود</b> ادمین می‌شود.
              </span>
            </div>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-3 text-center text-[11px] text-muted-foreground">
          نودهاست — سرور شخصیِ شما با ماژول‌های قابل فعال‌سازی
        </div>
      </footer>
    </div>
  )
}
