import { useState, useMemo, useRef } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { OverlayPortalContext, useOverlayPortalContainer } from './OverlayPortalContext'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
  subtitle?: string
}

export interface ComboboxProps {
  value?: string
  onValueChange?: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  error?: boolean | string
  className?: string
}

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = 'Select item...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  disabled,
  error,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const portalContainer = useOverlayPortalContainer()
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value],
  )

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.subtitle && opt.subtitle.toLowerCase().includes(q)),
    )
  }, [options, query])

  const selectOption = (optValue: string) => {
    onValueChange?.(optValue)
    setOpen(false)
    setQuery('')
    setHighlightedIndex(0)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
      setHighlightedIndex(0)
    } else {
      const selectedIdx = options.findIndex((opt) => opt.value === value)
      setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0)
    }
  }

  const safeHighlight =
    filteredOptions.length === 0 ? -1 : Math.min(highlightedIndex, filteredOptions.length - 1)

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (filteredOptions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((prev) => (prev + 1) % filteredOptions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((prev) => (prev <= 0 ? filteredOptions.length - 1 : prev - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setHighlightedIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setHighlightedIndex(filteredOptions.length - 1)
    } else if (event.key === 'Enter' && safeHighlight >= 0) {
      event.preventDefault()
      selectOption(filteredOptions[safeHighlight].value)
      triggerRef.current?.focus()
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border bg-surface px-3 py-2 text-sm text-ink ring-offset-canvas transition-colors focus:outline-none focus:ring-2 focus:ring-emerald focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-rose focus:ring-rose' : 'border-line focus:border-emerald',
            className,
          )}
        >
          <span className={cn('truncate', !selectedOption && 'text-muted')}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted opacity-70" />
        </button>
      </Popover.Trigger>

      <Popover.Portal container={portalContainer}>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={handleKeyDown}
          onCloseAutoFocus={(event) => {
            if (!triggerRef.current) return
            event.preventDefault()
            triggerRef.current.focus()
          }}
          className="z-popover w-[var(--radix-popover-trigger-width)] min-w-[200px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-line bg-surface p-1 shadow-md animate-in fade-in-80 slide-in-from-top-1"
        >
          {/* Avoid nested portal context leaking past this popover */}
          <OverlayPortalContext.Provider value={null}>
            {/* Search Header */}
            <div className="flex items-center border-b border-line px-2 pb-1.5 pt-1">
              <Search className="mr-2 h-4 w-4 text-muted shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setHighlightedIndex(0)
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full bg-transparent text-xs text-ink placeholder:text-muted focus:outline-none"
              />
            </div>

            {/* Option list */}
            <div className="max-h-60 overflow-y-auto pt-1" role="listbox">
              {filteredOptions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted">{emptyText}</p>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value
                  const isHighlighted = idx === safeHighlight
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => selectOption(opt.value)}
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-line/40 focus:bg-line/40 focus:outline-none',
                        isHighlighted && 'bg-line/40',
                        isSelected ? 'font-medium text-emerald-600' : 'text-soft',
                      )}
                    >
                      <div>
                        <div>{opt.label}</div>
                        {opt.subtitle && (
                          <div className="text-[11px] text-muted">{opt.subtitle}</div>
                        )}
                      </div>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-emerald" />}
                    </button>
                  )
                })
              )}
            </div>
          </OverlayPortalContext.Provider>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
