'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/** Live status dot. */
export function StatusDot({ tone, pulse }: { tone: 'green' | 'amber' | 'rose' | 'slate'; pulse?: boolean }) {
  const color = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
    slate: 'bg-slate-400',
  }[tone]
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 rounded-full shrink-0', color, pulse && 'nh-pulse')}
    />
  )
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = {
    online: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    delivered: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    forwarded: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30',
    queued: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    unreachable: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    unknown: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
    dead: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  }[status] ?? 'bg-slate-500/10 text-slate-600 border-slate-500/30'
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium', tone)}>
      {label ?? status}
    </Badge>
  )
}

export function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0 [&>svg]:size-5">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
        <div className="text-sm text-muted-foreground mt-1 truncate">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</div>}
      </div>
    </div>
  )
}

/** LTR code/JSON block with scroll. */
export function CodeBlock({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      dir="ltr"
      className={cn(
        'ltr-block text-[12px] leading-relaxed rounded-lg border bg-muted/50 p-3 overflow-x-auto nh-scroll whitespace-pre',
        className,
      )}
    >
      {children}
    </pre>
  )
}

export function SectionTitle({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-primary [&>svg]:size-4.5">{icon}</span>}
      <h3 className="font-semibold">{title}</h3>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
