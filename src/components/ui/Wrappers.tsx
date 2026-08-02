import React from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import * as RadixAvatar from '@radix-ui/react-avatar'
import * as RadixScrollArea from '@radix-ui/react-scroll-area'
import { cn } from '@/lib/utils'

/* ─── Tabs (In-content sub-sections only) ────────────────────────────────── */
export interface TabItem {
  value: string
  label: React.ReactNode
  badge?: React.ReactNode
  content: React.ReactNode
}

export interface TabsProps {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  tabs: TabItem[]
  className?: string
}

export function Tabs({ defaultValue, value, onValueChange, tabs, className }: TabsProps) {
  const initialValue = defaultValue || (tabs[0]?.value ?? '')

  return (
    <RadixTabs.Root
      defaultValue={initialValue}
      value={value}
      onValueChange={onValueChange}
      className={cn('w-full', className)}
    >
      <RadixTabs.List className="flex border-b border-line gap-4">
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            className="flex items-center gap-2 border-b-2 border-transparent pb-2.5 pt-1 text-sm font-medium text-muted transition-colors hover:text-ink data-[state=active]:border-emerald data-[state=active]:text-emerald-600 focus:outline-none"
          >
            <span>{tab.label}</span>
            {tab.badge}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.value} value={tab.value} className="pt-4 focus:outline-none">
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}

/* ─── Tooltip ─────────────────────────────────────────────────────────────── */
export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

export function Tooltip({ content, children, side = 'top', align = 'center' }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            sideOffset={4}
            className="z-overlay rounded bg-sidebar px-2.5 py-1 text-xs text-white shadow-md animate-in fade-in-80"
          >
            {content}
            <RadixTooltip.Arrow className="fill-sidebar" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}

/* ─── Avatar ─────────────────────────────────────────────────────────────── */
export interface AvatarProps {
  src?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const avatarSizes = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-11 w-11 text-base',
}

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <RadixAvatar.Root
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full font-body font-semibold ring-1 ring-line select-none',
        avatarSizes[size],
        className,
      )}
    >
      <RadixAvatar.Image src={src} alt={name} className="h-full w-full object-cover" />
      <RadixAvatar.Fallback className="flex h-full w-full items-center justify-center bg-violet-tint text-violet">
        {initials || '?'}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}

/* ─── ScrollArea ──────────────────────────────────────────────────────────── */
export interface ScrollAreaProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'dir'> {
  children: React.ReactNode
  dir?: 'ltr' | 'rtl'
}

export function ScrollArea({ children, className, ...props }: ScrollAreaProps) {
  return (
    <RadixScrollArea.Root className={cn('relative overflow-hidden', className)} {...props}>
      <RadixScrollArea.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none transition-colors p-0.5 bg-transparent hover:bg-line/20 w-2.5"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-line/60" />
      </RadixScrollArea.Scrollbar>
    </RadixScrollArea.Root>
  )
}
