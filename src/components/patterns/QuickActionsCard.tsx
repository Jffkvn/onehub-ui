import React from 'react'
import { IconChip } from '@/components/ui/IconChip'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface QuickActionItem {
  id: string
  label: string
  subtitle: string
  icon: React.ReactNode
  tone?: 'emerald' | 'violet' | 'blue' | 'amber' | 'rose' | 'cyan' | 'neutral'
  onClick?: () => void
}

export interface QuickActionsCardProps {
  title?: string
  actions: QuickActionItem[]
  className?: string
}

export function QuickActionsCard({
  title = 'Quick Actions',
  actions,
  className,
}: QuickActionsCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-surface p-5 shadow-xs dark:bg-surface dark:text-ink',
        className,
      )}
    >
      <h3 className="font-display text-sm font-bold text-ink mb-4 pb-3 border-b border-line">
        {title}
      </h3>

      <div className="space-y-2">
        {actions.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className="flex w-full items-center justify-between gap-3 rounded-md p-2 text-left transition-all duration-150 hover:bg-line/30 group"
          >
            <div className="flex items-center gap-3">
              <IconChip tone={item.tone || 'emerald'} size="sm" icon={item.icon} />
              <div>
                <p className="font-body text-xs font-semibold text-ink group-hover:text-emerald-600 dark:group-hover:text-emerald transition-colors">
                  {item.label}
                </p>
                <p className="font-body text-[11px] text-muted">{item.subtitle}</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted group-hover:translate-x-0.5 transition-transform" />
          </button>
        ))}
      </div>
    </div>
  )
}
