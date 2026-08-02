import React from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  trigger?: React.ReactNode
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  trigger,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}

      <RadixDialog.Portal>
        {/* Overlay backdrop */}
        <RadixDialog.Overlay className="fixed inset-0 z-overlay bg-black/40 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in-0" />

        {/* Modal Content */}
        <RadixDialog.Content
          className={cn(
            'fixed left-[50%] top-[50%] z-sheet w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-lg border border-line bg-surface p-6 shadow-xl transition-all duration-200 animate-in fade-in-0 zoom-in-95 dark:bg-surface dark:text-ink',
            className,
          )}
        >
          {/* Header */}
          {(title || description) && (
            <div className="mb-4 pr-6">
              {title && (
                <RadixDialog.Title className="font-display text-lg font-bold text-ink">
                  {title}
                </RadixDialog.Title>
              )}
              {description && (
                <RadixDialog.Description className="mt-1 font-body text-xs text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
          )}

          {/* Body */}
          <div className="text-sm">{children}</div>

          {/* Footer */}
          {footer && <div className="mt-6 flex justify-end gap-2.5">{footer}</div>}

          {/* Close button */}
          <RadixDialog.Close className="absolute right-4 top-4 rounded-md p-1 text-muted hover:bg-line/50 hover:text-ink focus:outline-none focus:ring-2 focus:ring-emerald">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
