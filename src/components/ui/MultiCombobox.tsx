import React, { useState, useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { useOverlayPortalContainer } from './OverlayPortalContext'
import { cn } from '@/lib/utils'

export interface MultiComboboxOption {
  value: string
  label: string
}

export interface MultiComboboxProps {
  values?: string[]
  onValuesChange?: (values: string[]) => void
  options: MultiComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  error?: boolean | string
  className?: string
}

export function MultiCombobox({
  values = [],
  onValuesChange,
  options,
  placeholder = 'Select items...',
  searchPlaceholder = 'Search...',
  disabled,
  error,
  className,
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const portalContainer = useOverlayPortalContainer()

  const selectedSet = useMemo(() => new Set(values), [values])

  const toggleValue = (val: string) => {
    const next = new Set(selectedSet)
    if (next.has(val)) {
      next.delete(val)
    } else {
      next.add(val)
    }
    onValuesChange?.(Array.from(next))
  }

  const removeValue = (val: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(selectedSet)
    next.delete(val)
    onValuesChange?.(Array.from(next))
  }

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter((opt) => opt.label.toLowerCase().includes(q))
  }, [options, query])

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <div
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          aria-expanded={open}
          className={cn(
            'flex min-h-[40px] w-full cursor-pointer flex-wrap items-center justify-between gap-1.5 rounded-md border bg-surface p-1.5 text-sm text-ink ring-offset-canvas transition-colors focus-within:ring-2 focus-within:ring-emerald focus-within:ring-offset-1',
            error ? 'border-rose focus-within:ring-rose' : 'border-line focus-within:border-emerald',
            disabled && 'cursor-not-allowed opacity-50',
            className,
          )}
        >
          <div className="flex flex-wrap items-center gap-1">
            {values.length === 0 ? (
              <span className="px-1 text-xs text-muted">{placeholder}</span>
            ) : (
              values.map((val) => {
                const option = options.find((o) => o.value === val)
                return (
                  <span
                    key={val}
                    className="inline-flex items-center gap-1 rounded bg-emerald-tint px-2 py-0.5 text-xs font-medium text-emerald-600"
                  >
                    <span>{option ? option.label : val}</span>
                    <button
                      type="button"
                      onClick={(e) => removeValue(val, e)}
                      className="rounded hover:bg-emerald/20 p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-1.5 pr-1">
            {values.length > 0 && (
              <span className="text-[11px] font-mono text-muted">
                {values.length}/{options.length}
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted opacity-70" />
          </div>
        </div>
      </Popover.Trigger>

      <Popover.Portal container={portalContainer}>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-popover w-[var(--radix-popover-trigger-width)] min-w-[200px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-line bg-surface p-1 shadow-md animate-in fade-in-80 slide-in-from-top-1"
        >
          <div className="flex items-center border-b border-line px-2 pb-1.5 pt-1">
            <Search className="mr-2 h-4 w-4 text-muted shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-xs text-ink placeholder:text-muted focus:outline-none"
            />
          </div>

          <div className="max-h-60 overflow-y-auto pt-1">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">No items found.</p>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selectedSet.has(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleValue(opt.value)}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-line/40 focus:bg-line/40 focus:outline-none',
                      isSelected ? 'font-medium text-emerald-600' : 'text-soft',
                    )}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-emerald" />}
                  </button>
                )
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
