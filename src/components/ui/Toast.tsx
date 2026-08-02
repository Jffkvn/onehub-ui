import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastTone = 'success' | 'danger' | 'info'

export interface ToastMessage {
  id: string
  title: string
  description?: string
  tone?: ToastTone
}

interface ToastContextType {
  toast: (title: string, options?: { description?: string; tone?: ToastTone }) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (title: string, options?: { description?: string; tone?: ToastTone }) => {
      const id = Math.random().toString(36).substring(2, 9)
      const newToast: ToastMessage = {
        id,
        title,
        description: options?.description,
        tone: options?.tone || 'success',
      }

      setToasts((prev) => [...prev, newToast])

      // Auto dismiss in 2600ms
      setTimeout(() => {
        removeToast(id)
      }, 2600)
    },
    [removeToast],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Bottom-center toast viewport */}
      <div className="fixed bottom-6 left-1/2 z-toast flex -translate-x-1/2 flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-line bg-surface p-3.5 shadow-xl transition-all duration-300 animate-in fade-in-0 slide-in-from-bottom-5',
            )}
          >
            {t.tone === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald shrink-0 mt-0.5" />}
            {t.tone === 'danger' && <AlertCircle className="h-5 w-5 text-rose shrink-0 mt-0.5" />}
            {t.tone === 'info' && <Info className="h-5 w-5 text-blue shrink-0 mt-0.5" />}

            <div className="flex-1">
              <h4 className="font-body text-xs font-semibold text-ink">{t.title}</h4>
              {t.description && (
                <p className="mt-0.5 font-body text-xs text-muted">{t.description}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="text-muted hover:text-ink p-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
