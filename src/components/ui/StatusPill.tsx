import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const statusPillVariants = cva(
  'inline-flex items-center rounded-full font-body font-medium transition-colors',
  {
    variants: {
      tone: {
        success: 'bg-emerald-tint text-emerald-600',
        warning: 'bg-amber-tint text-amber',
        danger:  'bg-rose-tint text-rose',
        info:    'bg-blue-tint text-blue',
        violet:  'bg-violet-tint text-violet',
        neutral: 'bg-line/60 text-soft',
      },
      size: {
        sm: 'px-2 py-0.5 text-[11px] leading-4 gap-1',
        md: 'px-2.5 py-0.5 text-xs leading-5 gap-1.5',
        lg: 'px-3 py-1 text-sm leading-5 gap-2',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'md',
    },
  },
)

const dotColors = {
  success: 'bg-emerald-600',
  warning: 'bg-amber',
  danger:  'bg-rose',
  info:    'bg-blue',
  violet:  'bg-violet',
  neutral: 'bg-muted',
}

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {
  withDot?: boolean
}

export function StatusPill({
  className,
  tone = 'neutral',
  size = 'md',
  withDot = true,
  children,
  ...props
}: StatusPillProps) {
  const currentTone = tone || 'neutral'

  return (
    <span className={cn(statusPillVariants({ tone: currentTone, size, className }))} {...props}>
      {withDot && (
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotColors[currentTone])}
        />
      )}
      <span>{children}</span>
    </span>
  )
}

export function Badge({
  className,
  tone = 'neutral',
  size = 'sm',
  children,
  ...props
}: StatusPillProps) {
  return (
    <StatusPill tone={tone} size={size} withDot={false} className={className} {...props}>
      {children}
    </StatusPill>
  )
}
