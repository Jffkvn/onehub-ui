import React from 'react'
import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export interface DropdownMenuItem {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
}

export interface DropdownMenuProps {
  trigger: React.ReactNode
  items: DropdownMenuItem[]
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function DropdownMenu({
  trigger,
  items,
  align = 'end',
  className,
}: DropdownMenuProps) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>

      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align={align}
          sideOffset={4}
          className={cn(
            'z-overlay min-w-[160px] overflow-hidden rounded-md border border-line bg-surface p-1 shadow-md animate-in fade-in-80 slide-in-from-top-1',
            className,
          )}
        >
          {items.map((item) => (
            <RadixDropdown.Item
              key={item.key}
              disabled={item.disabled}
              onClick={item.onClick}
              className={cn(
                'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs transition-colors focus:bg-line/40 focus:outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                item.danger
                  ? 'text-rose hover:bg-rose-tint'
                  : 'text-soft hover:text-ink hover:bg-line/40',
              )}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  )
}
