import React, { useId } from 'react'
import { cn } from '@/lib/utils'

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block font-body text-xs font-semibold text-soft dark:text-soft', className)}
      {...props}
    >
      {children}
      {required && <span className="ml-1 text-rose">*</span>}
    </label>
  ),
)
Label.displayName = 'Label'

export interface FieldErrorProps extends React.HTMLAttributes<HTMLParagraphElement> {
  error?: string
}

export const FieldError = React.forwardRef<HTMLParagraphElement, FieldErrorProps>(
  ({ className, error, children, ...props }, ref) => {
    const content = error || children
    if (!content) return null

    return (
      <p
        ref={ref}
        role="alert"
        className={cn('font-body text-xs text-rose', className)}
        {...props}
      >
        {content}
      </p>
    )
  },
)
FieldError.displayName = 'FieldError'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean | string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, leftIcon, rightIcon, disabled, ...props }, ref) => {
    const isError = Boolean(error)

    return (
      <div className="relative flex w-full items-center">
        {leftIcon && (
          <span className="absolute left-3 text-muted pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          disabled={disabled}
          aria-invalid={isError ? 'true' : undefined}
          className={cn(
            'flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink ring-offset-canvas transition-colors placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
            isError
              ? 'border-rose focus-visible:ring-rose'
              : 'border-line focus-visible:border-emerald',
            leftIcon && 'pl-9',
            rightIcon && 'pr-9',
            className,
          )}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 text-muted">
            {rightIcon}
          </span>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean | string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, disabled, ...props }, ref) => {
    const isError = Boolean(error)

    return (
      <textarea
        ref={ref}
        disabled={disabled}
        aria-invalid={isError ? 'true' : undefined}
        className={cn(
          'flex min-h-[80px] w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink ring-offset-canvas transition-colors placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          isError ? 'border-rose focus-visible:ring-rose' : 'border-line focus-visible:border-emerald',
          className,
        )}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export interface FormGroupProps {
  label?: string
  htmlFor?: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}

export function FormGroup({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: FormGroupProps) {
  const generatedId = useId()
  const labelFor = htmlFor ?? generatedId

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={labelFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {hint && !error && (
        <p className="font-body text-xs text-muted">{hint}</p>
      )}
      <FieldError error={error} />
    </div>
  )
}
