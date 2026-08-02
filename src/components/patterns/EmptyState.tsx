import React from 'react'
import { IconChip } from '@/components/ui/IconChip'
import { FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  title?: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  tone?: 'emerald' | 'violet' | 'blue' | 'amber' | 'rose' | 'cyan' | 'neutral'
  className?: string
}

export function EmptyState({
  title = 'No items found',
  description = 'There are no entries in this list yet.',
  icon = <FolderOpen className="h-6 w-6" />,
  action,
  tone = 'neutral',
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center p-8 text-center', className)}>
      <IconChip tone={tone} size="lg" icon={icon} className="mb-3" />
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      <p className="mt-1 font-body text-xs text-muted max-w-sm">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
