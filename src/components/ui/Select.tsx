import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useOverlayPortalContainer } from './OverlayPortalContext'
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

const EMPTY_OPTION_SENTINEL = '__onehub_empty__'

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
  const portalContainer = useOverlayPortalContainer()
  const isError = Boolean(error)
  const hasEmptyOption = options.some((opt) => opt.value === '')
  const encodeValue = (raw: string | undefined) => {
    if (raw === undefined) return undefined
    if (raw === '' && hasEmptyOption) return EMPTY_OPTION_SENTINEL
    return raw
  }

  return (
    <RadixSelect.Root
      value={encodeValue(value)}
      defaultValue={encodeValue(defaultValue)}
      onValueChange={(nextValue) =>
        onValueChange?.(nextValue === EMPTY_OPTION_SENTINEL ? '' : nextValue)
      }
      disabled={disabled}
    >
      <RadixSelect.Trigger
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border bg-surface px-3 py-2 text-sm text-ink ring-offset-canvas transition-colors placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-emerald focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          isError ? 'border-rose focus:ring-rose' : 'border-line focus:border-emerald',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown className="h-4 w-4 text-muted opacity-70" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal container={portalContainer}>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-popover min-w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-line bg-surface text-ink shadow-md animate-in fade-in-80 slide-in-from-top-1"
        >
          <RadixSelect.ScrollUpButton className="flex h-6 items-center justify-center bg-surface text-muted">
            <ChevronUp className="h-4 w-4" />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className="p-1">
            {options.map((opt) => {
              const itemValue = opt.value === '' ? EMPTY_OPTION_SENTINEL : opt.value
              return (
                <RadixSelect.Item
                  key={itemValue}
                  value={itemValue}
                  disabled={opt.disabled}
                  className="relative flex cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-3 text-sm text-soft hover:bg-line/40 hover:text-ink focus:bg-line/40 focus:text-ink focus:outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="absolute left-2.5 inline-flex items-center justify-center text-emerald">
                    <Check className="h-4 w-4" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              )
            })}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex h-6 items-center justify-center bg-surface text-muted">
            <ChevronDown className="h-4 w-4" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
