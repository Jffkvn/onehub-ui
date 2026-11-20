import React from 'react'
import { IconChip } from '@/components/ui/IconChip'
import { Skeleton } from '@/components/ui/Skeleton'
import { CountUp } from '@/lib/motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface KpiCardProps {
  title: string
  value: number | string
  prefix?: string
  suffix?: string
  icon: React.ReactNode
  tone?: 'emerald' | 'violet' | 'blue' | 'amber' | 'rose' | 'cyan' | 'neutral'
  delta?: {
    value: string
    direction: 'up' | 'down' | 'flat'
    isPositive?: boolean
  }
  subline?: string
  loading?: boolean
  onClick?: () => void
  className?: string
}

export function KpiCard({
  title,
  value,
  prefix = '',
  suffix = '',
  icon,
  tone = 'emerald',
  delta,
  subline,
  loading = false,
  onClick,
  className,
}: KpiCardProps) {
  if (loading) {
    return <Skeleton shape="kpi" className={className} />
  }

  const isNumeric = typeof value === 'number'

  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-xs transition-all duration-200 hover:-translate-y-[3px] hover:shadow-md',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {/* Top Row: Icon chip + Title */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <IconChip tone={tone} size="md" icon={icon} />
        {delta && (
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
              delta.isPositive ?? delta.direction === 'up'
                ? 'bg-emerald-tint text-emerald-600 dark:bg-emerald-tint dark:text-emerald'
                : delta.direction === 'down'
                ? 'bg-rose-tint text-rose dark:bg-rose-tint dark:text-rose'
                : 'bg-line/40 text-muted',
            )}
          >
            {delta.direction === 'up' && <TrendingUp className="h-3 w-3" />}
            {delta.direction === 'down' && <TrendingDown className="h-3 w-3" />}
            {delta.direction === 'flat' && <Minus className="h-3 w-3" />}
            <span>{delta.value}</span>
          </div>
        )}
      </div>

      {/* Main Figure */}
      <div className="min-w-0">
        <p className="font-body text-xs font-medium text-muted">{title}</p>
        <p className="font-display text-xl xl:text-2xl font-bold tracking-tight text-ink tabular-nums whitespace-nowrap mt-0.5">
          {isNumeric && typeof value === 'number' ? (
            <CountUp end={value} prefix={prefix} suffix={suffix} />
          ) : (
            `${prefix}${value}${suffix}`
          )}
        </p>
        {subline && (
          <p className="mt-1 font-body text-[11px] text-soft">{subline}</p>
        )}
      </div>
    </div>
  )
}
