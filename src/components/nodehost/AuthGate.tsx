'use client'

/**
 * AuthGate — the tenant door of NodeHost.
 * Guests see ONLY this screen: sign in or register. The first registrant
 * of a fresh instance becomes its admin (hinted when pending).
 */
import { useState } from 'react'
import { Network, LogIn, UserPlus, ShieldCheck, Info } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { nhJson } from './api'
import { useNh } from './store'
import type { ViewerInfo } from './types'

interface AuthOk {
  ok: boolean
  user: ViewerInfo
  nodeCreated?: boolean
}

export function AuthGate() {
  const { toast } = useToast()
  const { loadMe, refresh, firstUserPending } = useNh()
  const [busy, setBusy] = useState(false)

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
      await done(
        res.user.role === 'admin'
          ? 'ثبت‌نام شدید — شما ادمین این نودهاست هستید'
          : res.nodeCreated === false
            ? 'ثبت‌نام انجام شد — نود شما را می‌توانید از پنل بسازید'
            : 'خوش آمدید — نود شخصی شما آماده است',
      )
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
              با ثبت‌نام، <span className="font-medium text-foreground">نود شخصی شما خودکار ساخته می‌شود</span>{" "}
              — همان سرور اشتراکیِ خودتان — و چند ماژول تستی خواهد داشت که هر لحظه فعال یا غیرفعالشان می‌کنید.
            </p>
          </div>

          <Card>
            <CardContent className="p-6">
              <Tabs defaultValue="login" dir="rtl">
                <TabsList className="grid grid-cols-2 w-full mb-4">
                  <TabsTrigger value="login" className="gap-1.5">
                    <LogIn className="size-3.5" /> ورود
                  </TabsTrigger>
                  <TabsTrigger value="register" className="gap-1.5">
                    <UserPlus className="size-3.5" /> ثبت‌نام
                  </TabsTrigger>
                </TabsList>

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

                {/* ---- register ---- */}
                <TabsContent value="register" className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-name">نام نمایشی</Label>
                    <Input
                      id="reg-name"
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
              </Tabs>
            </CardContent>
          </Card>

          {/* First-admin hint — shown only while the instance has no admin */}
          {firstUserPending && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs leading-6 text-amber-700 dark:text-amber-400">
              <ShieldCheck className="size-4 mt-1 shrink-0" />
              <span>
                این نمونه هنوز ادمین ندارد. <b>نخستین کاربری که ثبت‌نام کند</b> ادمین می‌شود و
                مدیریت کاربران، سقف نودها و شبکهٔ فدرال را در دست می‌گیرد.
              </span>
            </div>
          )}

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="size-3" />
            نودها روی همین میزبان اجرا می‌شوند؛ برای میزبان جداگانه، NodeHost را مستقل نصب کنید و
            به فدراسیون وصل شوید.
          </p>
        </div>
      </main>

      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-6xl px-4 py-3 text-center text-[11px] text-muted-foreground">
          نودهاست — معماری فدرال نودها · پروتکل NHP v1 · متن‌باز برای توسعهٔ آزاد
        </div>
      </footer>
    </div>
  )
}
