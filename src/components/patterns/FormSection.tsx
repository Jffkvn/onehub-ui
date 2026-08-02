import React from 'react'
import { cn } from '@/lib/utils'

export interface FormSectionProps {
  title: string
  description?: string
  children: React.ReactNode
  columns?: 1 | 2 | 3 | 4
  className?: string
}

const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}

export function FormSection({
  title,
  description,
  children,
  columns = 2,
  className,
}: FormSectionProps) {
  return (
    <div className={cn('space-y-4 rounded-lg border border-line bg-surface p-6 shadow-xs dark:bg-surface dark:text-ink', className)}>
      <div className="border-b border-line pb-3">
        <h3 className="font-display text-sm font-bold text-ink">{title}</h3>
        {description && (
          <p className="mt-0.5 font-body text-xs text-muted">{description}</p>
        )}
      </div>

      <div className={cn('grid gap-4', columnClasses[columns])}>
        {children}
      </div>
    </div>
  )
}
