import React from 'react'
import { cn } from '@/lib/utils'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shape?: 'line' | 'circle' | 'card' | 'row' | 'kpi'
}

export function Skeleton({ className, shape = 'line', ...props }: SkeletonProps) {
  if (shape === 'circle') {
    return (
      <div
        className={cn('h-10 w-10 animate-pulse rounded-full bg-line/60 dark:bg-line/30', className)}
        {...props}
      />
    )
  }

  if (shape === 'card') {
    return (
      <div
        className={cn(
          'h-32 w-full animate-pulse rounded-lg border border-line bg-surface p-4 dark:bg-surface',
          className,
        )}
        {...props}
      >
        <div className="h-4 w-1/3 rounded bg-line/60 dark:bg-line/30 mb-3" />
        <div className="h-8 w-1/2 rounded bg-line/60 dark:bg-line/30 mb-2" />
        <div className="h-3 w-1/4 rounded bg-line/40 dark:bg-line/20" />
      </div>
    )
  }

  if (shape === 'kpi') {
    return (
      <div
        className={cn(
          'flex h-24 w-full animate-pulse items-center gap-4 rounded-lg border border-line bg-surface p-4 dark:bg-surface',
          className,
        )}
        {...props}
      >
        <div className="h-10 w-10 rounded-md bg-line/60 dark:bg-line/30 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-20 rounded bg-line/40 dark:bg-line/20" />
          <div className="h-6 w-28 rounded bg-line/60 dark:bg-line/30" />
        </div>
      </div>
    )
  }

  if (shape === 'row') {
    return (
      <div
        className={cn('flex h-12 w-full animate-pulse items-center gap-4 border-b border-line px-4', className)}
        {...props}
      >
        <div className="h-4 w-1/4 rounded bg-line/60 dark:bg-line/30" />
        <div className="h-4 w-1/4 rounded bg-line/40 dark:bg-line/20" />
        <div className="h-4 w-1/6 rounded bg-line/40 dark:bg-line/20 ml-auto" />
      </div>
    )
  }

  return (
    <div
      className={cn('h-4 w-full animate-pulse rounded bg-line/60 dark:bg-line/30', className)}
      {...props}
    />
  )
}
