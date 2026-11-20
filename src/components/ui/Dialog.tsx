import React, { useEffect, useId, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from './Button'
import { OverlayPortalContext } from './OverlayPortalContext'
import { cn } from '@/lib/utils'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hasUnsavedChanges?: boolean
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  trigger?: React.ReactNode
}

export const DialogClose = RadixDialog.Close

export function Dialog({
  open,
  onOpenChange,
  hasUnsavedChanges = false,
  title,
  description,
  children,
  footer,
  className,
  trigger,
}: DialogProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)
  const discardTitleId = useId()

  useEffect(() => {
    if (!open || !hasUnsavedChanges) {
      setConfirmingDiscard(false)
    }
  }, [open, hasUnsavedChanges])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && hasUnsavedChanges) {
      setConfirmingDiscard(true)
      return
    }
    setConfirmingDiscard(false)
    onOpenChange?.(nextOpen)
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={handleOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}

      <RadixDialog.Portal>
        {/* Overlay backdrop */}
        <RadixDialog.Overlay className="fixed inset-0 z-overlay bg-black/40 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in-0" />

        {/* Flex centering wrapper avoids persistent CSS transforms that offset fixed child popovers */}
        <div className="fixed inset-0 z-sheet flex items-center justify-center p-3 sm:p-4 pointer-events-none">
          <RadixDialog.Content
            onEscapeKeyDown={(event) => {
              if (!hasUnsavedChanges) return
              event.preventDefault()
              setConfirmingDiscard((current) => !current)
            }}
            onInteractOutside={(event) => {
              if (!hasUnsavedChanges) return
              event.preventDefault()
              setConfirmingDiscard(true)
            }}
            className={cn(
              'pointer-events-auto relative flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-lg border border-line bg-surface p-4 sm:p-6 shadow-xl transition-opacity duration-200 animate-in fade-in-0',
              className,
            )}
          >
            <OverlayPortalContext.Provider value={portalContainer}>
              {/* Header */}
              {(title || description) && (
                <div className="mb-4 shrink-0 pr-8">
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

              {confirmingDiscard && hasUnsavedChanges && (
                <div
                  role="alertdialog"
                  aria-labelledby={discardTitleId}
                  className="mb-4 shrink-0 flex flex-col gap-3 rounded-md border border-amber/40 bg-amber-tint/70 p-3 text-xs text-ink sm:flex-row sm:items-center sm:justify-between"
                >
                  <p id={discardTitleId} className="font-medium">
                    You have unsaved changes. Discard your edits and close?
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingDiscard(false)}
                    >
                      Keep editing
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setConfirmingDiscard(false)
                        onOpenChange?.(false)
                      }}
                    >
                      Discard changes
                    </Button>
                  </div>
                </div>
              )}

              {/* Scrollable Body */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 -m-1 text-sm">
                {children}
              </div>

              {/* Footer */}
              {footer && (
                <div className="mt-4 shrink-0 flex flex-wrap items-center justify-end gap-2.5 border-t border-line pt-4">
                  {footer}
                </div>
              )}
            </OverlayPortalContext.Provider>

            {/* Close button */}
            <RadixDialog.Close className="absolute right-3.5 top-3.5 sm:right-4 sm:top-4 z-10 rounded-md p-1 text-muted hover:bg-line/50 hover:text-ink focus:outline-none focus:ring-2 focus:ring-emerald">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </RadixDialog.Close>

            {/* Portal host for nested popovers/selects inside this dialog */}
            <div ref={setPortalContainer} />
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
