import React from 'react'
import { IconChip } from '@/components/ui/IconChip'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AlertItem {
  id: string
  title: string
  subtitle: string
  timestamp: string
  tone?: 'emerald' | 'violet' | 'blue' | 'amber' | 'rose' | 'cyan' | 'neutral'
  urgent?: boolean
  icon?: React.ReactNode
}

export interface AlertsCardProps {
  title?: string
  subtitle?: string
  alerts: AlertItem[]
  onAlertClick?: (item: AlertItem) => void
  className?: string
}

export function AlertsCard({
  title = 'Alerts & Events',
  subtitle = 'Next 30 days',
  alerts,
  onAlertClick,
  className,
}: AlertsCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-surface p-5 shadow-xs',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <h3 className="font-display text-sm font-bold text-ink">{title}</h3>
        {subtitle && <span className="font-body text-xs text-muted font-medium">{subtitle}</span>}
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {alerts.length === 0 ? (
          <p className="text-xs text-muted py-2 text-center">No active alerts.</p>
        ) : (
          alerts.map((item) => (
            <div
              key={item.id}
              onClick={() => onAlertClick?.(item)}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md p-2 transition-colors hover:bg-line/30',
                onAlertClick && 'cursor-pointer',
              )}
            >
              <div className="flex items-center gap-3">
                <IconChip
                  tone={item.urgent ? 'rose' : item.tone || 'neutral'}
                  size="sm"
                  icon={item.icon || <Bell className="h-4 w-4" />}
                />
                <div>
                  <p
                    className={cn(
                      'font-body text-xs font-semibold leading-snug',
                      item.urgent ? 'text-rose' : 'text-ink',
                    )}
                  >
                    {item.title}
                  </p>
                  <p className="font-body text-[11px] text-muted">{item.subtitle}</p>
                </div>
              </div>
              <span
                className={cn(
                  'font-body text-[11px] font-mono shrink-0',
                  item.urgent ? 'font-bold text-rose' : 'text-muted',
                )}
              >
                {item.timestamp}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
