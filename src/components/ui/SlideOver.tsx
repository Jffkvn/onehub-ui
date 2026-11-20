import React, { useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { OverlayPortalContext } from './OverlayPortalContext'
import { cn } from '@/lib/utils'

export interface SlideOverProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  statusPill?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  widthClass?: string
  trigger?: React.ReactNode
}

export function SlideOver({
  open,
  onOpenChange,
  title,
  subtitle,
  statusPill,
  children,
  footer,
  className,
  widthClass = 'max-w-xl',
  trigger,
}: SlideOverProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}

      <RadixDialog.Portal>
        {/* Scrim / Backdrop */}
        <RadixDialog.Overlay className="fixed inset-0 z-overlay bg-black/40 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in-0" />

        {/* Panel */}
        <RadixDialog.Content
          className={cn(
            'fixed bottom-0 right-0 top-0 z-sheet flex w-full flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-400 ease-[cubic-bezier(.32,.72,0,1)] animate-in slide-in-from-right',
            widthClass,
            className,
          )}
        >
          <OverlayPortalContext.Provider value={portalContainer}>
            {/* Header */}
            <div className="flex items-start justify-between border-b border-line p-6 pb-4">
              <div>
                {subtitle && <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-0.5">{subtitle}</p>}
                <div className="flex items-center gap-3">
                  {title && <RadixDialog.Title className="font-display text-xl font-bold text-ink">{title}</RadixDialog.Title>}
                  {statusPill}
                </div>
              </div>
              <RadixDialog.Close className="rounded-md p-1.5 text-muted hover:bg-line/50 hover:text-ink focus:outline-none focus:ring-2 focus:ring-emerald">
                <X className="h-5 w-5" />
                <span className="sr-only">Close drawer</span>
              </RadixDialog.Close>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">{children}</div>

            {/* Sticky Action Footer */}
            {footer && (
              <div className="sticky bottom-0 border-t border-line bg-surface/95 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-end gap-3">{footer}</div>
              </div>
            )}
          </OverlayPortalContext.Provider>
          <div ref={setPortalContainer} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
