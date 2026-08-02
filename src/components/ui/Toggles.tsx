import React from 'react'
import * as RadixCheckbox from '@radix-ui/react-checkbox'
import * as RadixRadioGroup from '@radix-ui/react-radio-group'
import * as RadixSwitch from '@radix-ui/react-switch'
import { Check, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ─── Checkbox ───────────────────────────────────────────────────────────── */
export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root> {
  label?: string
}

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof RadixCheckbox.Root>,
  CheckboxProps
>(({ className, label, ...props }, ref) => (
  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-soft select-none">
    <RadixCheckbox.Root
      ref={ref}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded border border-line bg-surface ring-offset-canvas transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-1 data-[state=checked]:border-emerald data-[state=checked]:bg-emerald data-[state=checked]:text-white disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3 w-3 stroke-[3]" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
    {label && <span>{label}</span>}
  </label>
))
Checkbox.displayName = 'Checkbox'

/* ─── Switch ─────────────────────────────────────────────────────────────── */
export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof RadixSwitch.Root> {
  label?: string
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof RadixSwitch.Root>,
  SwitchProps
>(({ className, label, ...props }, ref) => (
  <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-soft select-none">
    <RadixSwitch.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-line transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-1 data-[state=checked]:bg-emerald disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </RadixSwitch.Root>
    {label && <span>{label}</span>}
  </label>
))
Switch.displayName = 'Switch'

/* ─── Radio Group ───────────────────────────────────────────────────────── */
export interface RadioGroupOption {
  value: string
  label: string
  hint?: string
}

export interface RadioGroupProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  options: RadioGroupOption[]
  className?: string
  disabled?: boolean
}

export function RadioGroup({
  value,
  defaultValue,
  onValueChange,
  options,
  className,
  disabled,
}: RadioGroupProps) {
  return (
    <RadixRadioGroup.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      className={cn('space-y-2', className)}
    >
      {options.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 hover:bg-line/20 select-none"
        >
          <RadixRadioGroup.Item
            value={opt.value}
            className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-line bg-surface text-emerald ring-offset-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald focus-visible:ring-offset-1 data-[state=checked]:border-emerald data-[state=checked]:bg-emerald data-[state=checked]:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RadixRadioGroup.Indicator className="flex items-center justify-center text-current">
              <Circle className="h-2 w-2 fill-current" />
            </RadixRadioGroup.Indicator>
          </RadixRadioGroup.Item>
          <div>
            <span className="font-body text-xs font-medium text-ink">{opt.label}</span>
            {opt.hint && <p className="text-[11px] text-muted">{opt.hint}</p>}
          </div>
        </label>
      ))}
    </RadixRadioGroup.Root>
  )
}
