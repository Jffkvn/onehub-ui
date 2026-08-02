import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center font-body text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[.97]',
  {
    variants: {
      variant: {
        primary:
          'bg-emerald text-white hover:-translate-y-[1px] hover:bg-emerald-600 hover:shadow-md',
        secondary:
          'bg-surface text-ink ring-1 ring-line hover:-translate-y-[1px] hover:bg-canvas hover:shadow-sm',
        ghost:
          'text-soft hover:bg-line/50 hover:text-ink',
        danger:
          'bg-rose text-white hover:-translate-y-[1px] hover:bg-rose/90 hover:shadow-md',
        outline:
          'border border-line bg-transparent text-ink hover:-translate-y-[1px] hover:bg-line/30',
      },
      size: {
        sm: 'h-8 rounded-sm px-3 text-xs gap-1.5',
        md: 'h-10 rounded-md px-4 text-sm gap-2',
        lg: 'h-11 rounded-lg px-5 text-base gap-2.5',
        icon: 'h-9 w-9 rounded-md p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-current" />
        ) : (
          leftIcon
        )}
        <span>{children}</span>
        {!loading && rightIcon}
      </button>
    )
  },
)

Button.displayName = 'Button'
