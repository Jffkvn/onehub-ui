import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const iconChipVariants = cva(
  'inline-flex items-center justify-center rounded-md transition-all duration-150',
  {
    variants: {
      tone: {
        emerald: 'bg-emerald-tint text-emerald-600 dark:bg-emerald-tint dark:text-emerald',
        violet:  'bg-violet-tint text-violet dark:bg-violet-tint dark:text-violet',
        blue:    'bg-blue-tint text-blue dark:bg-blue-tint dark:text-blue',
        amber:   'bg-amber-tint text-amber dark:bg-amber-tint dark:text-amber',
        rose:    'bg-rose-tint text-rose dark:bg-rose-tint dark:text-rose',
        cyan:    'bg-cyan-tint text-cyan dark:bg-cyan-tint dark:text-cyan',
        neutral: 'bg-line/40 text-soft dark:bg-line/20 dark:text-muted',
      },
      size: {
        sm: 'h-8 w-8 text-sm p-1.5',
        md: 'h-10 w-10 text-base p-2',
        lg: 'h-12 w-12 text-lg p-2.5',
      },
    },
    defaultVariants: {
      tone: 'emerald',
      size: 'md',
    },
  },
)

export interface IconChipProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof iconChipVariants> {
  icon?: React.ReactNode
}

export function IconChip({
  className,
  tone,
  size,
  icon,
  children,
  ...props
}: IconChipProps) {
  return (
    <div
      className={cn(iconChipVariants({ tone, size, className }))}
      {...props}
    >
      {icon || children}
    </div>
  )
}
