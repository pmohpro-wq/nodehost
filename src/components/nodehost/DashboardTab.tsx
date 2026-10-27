'use client'

import { useNh } from './store'
import { StatCard, StatusDot, SectionTitle, EmptyHint } from './bits'
import { Card, CardContent } from '@/components/ui/card'
import { ago, clockOf } from './api'
import {
  Boxes,
  Blocks,
  MailCheck,
  Hourglass,
  Globe2,
  Network,
  ShieldCheck,
  Radio,
  UserCog,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const AXIOMS = [
  {
    icon: Network,
    title: 'ارتباط صرفاً شبکه‌ای',
    body: 'هر نود با آدرس کامل (میزبان، نود) شناخته می‌شود؛ نود روی همین سرور و نود روی سرور دیگر هیچ تفاوت معنایی ندارند.',
  },
  {
    icon: ShieldCheck,
    title: 'نودِ ایزوله برای هر کاربر',
    body: 'هر کاربر (ادمین) فقط به نود خودش متصل می‌شود و ماژول‌ها، حافظه و صندوق هر نود کاملاً جدا است.',
  },
  {
    icon: Radio,
    title: 'نود هرگز آفلاین نمی‌شود',
    body: 'قطعی موقت فقط یک مسئلهٔ مسیریابی است: پیام‌ها صف می‌شوند و با بازگشت میزبان، خودکار تحویل می‌گردند.',
  },
  {
    icon: UserCog,
    title: 'ادمین ممکن است آفلاین باشد',
    body: 'نود برای ادمینِ غایب پیام نگه می‌دارد (صندوق ورودی) و به‌محض اتصال مجدد، همه‌چیز را تحویل می‌دهد.',
  },
]

export function DashboardTab() {
  const { data, loading, refresh } = useNh()
  const stats = data?.stats

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border bg-gradient-to-bl from-emerald-500/10 via-transparent to-transparent p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-extrabold">
            {data ? `به ${data.host.name} خوش آمدید` : 'در حال اتصال به هسته…'}
          </h1>
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="بازخوانی"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            بازخوانی زنده (هر ۵ ثانیه)
          </button>
        </div>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-6">
          این کنترل‌پنل، میزبانِ «آلفا» را مدیریت می‌کند؛ میزبان «بتا» روی سرور دیگری اجرا می‌شود و
          دو میزبان با پروتکل NHP از طریق HTTP با هم صحبت می‌کنند. یک نودهاست سوم (گاما) به‌صورت
          عمدی از دسترس خارج است تا صف‌بندی و تحویلِ پس از رفع قطعی را ببینید.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={<Boxes />} label="نودهای این میزبان" value={stats?.nodes ?? '…'} />
        <StatCard icon={<Blocks />} label="ماژول‌های فعال" value={stats?.modulesEnabled ?? '…'} hint={stats ? `${stats.modulesLoaded.length} ماژول نصب‌شده` : undefined} />
        <StatCard icon={<MailCheck />} label="پیام‌های تحویل‌شده" value={stats ? stats.msgsDelivered + stats.msgsForwarded : '…'} hint={stats ? `${stats.msgsForwarded} مورد بین‌میزبانی` : undefined} />
        <StatCard icon={<Hourglass />} label="در صف انتظار" value={stats?.msgsQueued ?? '…'} hint="نود هرگز آفلاین نمی‌شود" />
        <StatCard icon={<Globe2 />} label="میزبان‌های آنلاین" value={stats ? `${stats.hostsOnline}/${data?.hosts.length ?? 0}` : '…'} />
      </div>

      {/* Axioms */}
      <section>
        <SectionTitle icon={<ShieldCheck />} title="اصول معماری نودهاست" sub="قواعد تغییرناپذیر شبکه" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {AXIOMS.map((a) => (
            <Card key={a.title} className="border/60">
              <CardContent className="p-4 space-y-2">
                <div className="size-9 rounded-lg bg-primary/10 text-primary grid place-items-center [&>svg]:size-4.5">
                  <a.icon />
                </div>
                <div className="font-semibold text-sm">{a.title}</div>
                <p className="text-xs text-muted-foreground leading-5">{a.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Activity feed */}
      <section>
        <SectionTitle icon={<Radio />} title="رویدادهای زندهٔ هسته" sub="آخرین فعالیت‌های روتر و میزبان‌ها" />
        {data && data.logs.length > 0 ? (
          <div className="rounded-xl border divide-y max-h-80 overflow-y-auto nh-scroll">
            {data.logs.map((l) => (
              <div key={l.id} className="flex items-start gap-2.5 px-3 py-2 text-xs">
                <StatusDot
                  tone={l.level === 'error' ? 'rose' : l.level === 'warn' ? 'amber' : 'green'}
                />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{l.message}</span>
                  <span className="text-muted-foreground mr-2 ltr-block inline-block" dir="ltr">
                    [{l.scope}]
                  </span>
                </div>
                <time className="text-[10px] text-muted-foreground shrink-0 tabular-nums" title={ago(l.createdAt)}>
                  {clockOf(l.createdAt)}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyHint>هنوز رویدادی ثبت نشده است.</EmptyHint>
        )}
      </section>
    </div>
  )
}
