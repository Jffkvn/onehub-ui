import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  error?: boolean | string
  className?: string
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = 'Select an option',
  disabled,
  error,
  className,
}: SelectProps) {
  const isError = Boolean(error)

  return (
    <RadixSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border bg-surface px-3 py-2 text-sm text-ink ring-offset-canvas transition-colors placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-emerald focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-surface dark:text-ink',
          isError ? 'border-rose focus:ring-rose' : 'border-line focus:border-emerald',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown className="h-4 w-4 text-muted opacity-70" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content className="z-overlay min-w-[8rem] overflow-hidden rounded-md border border-line bg-surface text-ink shadow-md animate-in fade-in-80 slide-in-from-top-1 dark:bg-surface dark:text-ink">
          <RadixSelect.ScrollUpButton className="flex h-6 items-center justify-center bg-surface text-muted">
            <ChevronUp className="h-4 w-4" />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className="p-1">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className="relative flex cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-3 text-sm text-soft hover:bg-line/40 hover:text-ink focus:bg-line/40 focus:text-ink focus:outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute left-2.5 inline-flex items-center justify-center text-emerald">
                  <Check className="h-4 w-4" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex h-6 items-center justify-center bg-surface text-muted">
            <ChevronDown className="h-4 w-4" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
