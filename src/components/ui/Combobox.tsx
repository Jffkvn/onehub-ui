import { useState, useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
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

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
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

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-overlay w-[var(--radix-popover-trigger-width)] min-w-[200px] overflow-hidden rounded-md border border-line bg-surface p-1 shadow-md animate-in fade-in-80 slide-in-from-top-1"
        >
          {/* Search Header */}
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

          {/* Option list */}
          <div className="max-h-60 overflow-y-auto pt-1">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">{emptyText}</p>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onValueChange?.(opt.value)
                      setOpen(false)
                      setQuery('')
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-line/40 focus:bg-line/40 focus:outline-none',
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
