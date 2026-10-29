'use client'

/**
 * AuthGate — the tenant door of NodeHost, passwordless + tab-isolated era.
 * ONE field: the username. It IS the account id, the personal node's id
 * and the network address — type it once and you are in (first time
 * creates the account + node, next times it just logs you in).
 * The session lives in THIS tab only and the id shows up in the address
 * bar; other tabs (other users) are never touched.
 */
import { useState } from 'react'
import { Network, LogIn, ShieldCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useNh } from './store'

export function AuthGate() {
  const { toast } = useToast()
  const { login, firstUserPending } = useNh()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')

  const enter = async () => {
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    setBusy(true)
    try {
      const res = await login(trimmed)
      if (res.ok) {
        toast({
          title:
            res.user.role === 'admin'
              ? 'خوش آمدید — شما ادمین این نودهاست هستید'
              : res.created
                ? 'خوش آمدید — حساب و نود شخصی شما آماده است'
                : 'خوش آمدید',
        })
      } else {
        toast({ title: 'ورود ناموفق بود', description: res.error, variant: 'destructive' })
      }
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
              یک نام کاربری بنویسید — همین نام <span className="font-medium text-foreground">آیدی شما، نود شما و آدرس شما در شبکه</span> است.
              بار اول حساب و نود شخصی‌تان ساخته می‌شود؛ دفعات بعد با همان نام وارد می‌شوید.
            </p>
            <p className="text-xs text-muted-foreground leading-5">
              آیدی جدید فقط حروف انگلیسی کوچک و عدد است (مثل <span dir="ltr" className="font-mono">ali22</span>)؛
              اگر نامی از قبل دارید — فارسی یا هر زبانی — همان را بنویسید تا وارد شوید.
            </p>
          </div>

          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="enter-name">نام کاربری (آیدی شما)</Label>
                <Input
                  id="enter-name"
                  dir="auto"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && enter()}
                  placeholder="مثلاً: ali22"
                  autoFocus
                  maxLength={40}
                />
              </div>
              <Button className="w-full" onClick={enter} disabled={busy || name.trim().length < 2}>
                <LogIn className="size-4" /> ورود / ثبت‌نام
              </Button>
              <p className="text-[11px] text-muted-foreground leading-5 text-center">
                بدون رمز و ایمیل. نشست فقط در <span className="font-medium">همین تب</span> ذخیره می‌شود
                و آیدی شما به آدرس‌بار اضافه می‌گردد (<span dir="ltr" className="font-mono">?u=آیدی</span>) —
                با خروج، از آدرس‌بار حذف می‌شود. هر تب می‌تواند کاربر جداگانه‌ای باشد و داده‌ای بین تب‌ها جابه‌جا نمی‌شود.
              </p>
            </CardContent>
          </Card>

          {/* First-admin hint — shown only while the instance has no admin */}
          {firstUserPending && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs leading-6 text-amber-700 dark:text-amber-400">
              <ShieldCheck className="size-4 mt-1 shrink-0" />
              <span>
                این نودهاست هنوز ادمین ندارد. <b>نخستین نامی که وارد شود</b> ادمین می‌شود.
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
