import React from 'react'
import { Search, Bell, Menu } from 'lucide-react'
import { Avatar } from '@/components/ui/Wrappers'
import { cn } from '@/lib/utils'

export interface TopbarProps {
  onSearchChange?: (query: string) => void
  unreadNotifications?: number
  onNotificationClick?: () => void
  userName?: string
  userAvatar?: string
  actionSlot?: React.ReactNode
  onToggleMobileSidebar?: () => void
  className?: string
}

export function Topbar({
  onSearchChange,
  unreadNotifications = 3,
  onNotificationClick,
  userName = 'Dora Agai',
  userAvatar,
  actionSlot,
  onToggleMobileSidebar,
  className,
}: TopbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-topbar flex h-16 w-full items-center justify-between border-b border-line bg-surface/95 px-6 backdrop-blur-md dark:bg-surface/95 dark:text-ink',
        className,
      )}
    >
      {/* Left Search & Mobile Menu Button */}
      <div className="flex items-center gap-4 flex-1 max-w-md">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="lg:hidden text-muted hover:text-ink p-1 rounded-md"
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle Sidebar</span>
        </button>

        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search employees, payroll runs, inventory..."
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="h-9 w-full rounded-md border border-line bg-canvas pl-9 pr-4 text-xs text-ink placeholder:text-muted focus:border-emerald focus:bg-surface focus:outline-none focus:ring-1 focus:ring-emerald dark:bg-canvas dark:text-ink"
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {actionSlot}

        {/* Notifications */}
        <button
          type="button"
          onClick={onNotificationClick}
          className="relative rounded-md p-2 text-soft hover:bg-line/40 hover:text-ink focus:outline-none"
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadNotifications > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose font-mono text-[10px] font-bold text-white">
              {unreadNotifications}
            </span>
          )}
        </button>

        <div className="h-5 w-[1px] bg-line" />

        {/* Avatar */}
        <div className="flex items-center gap-2">
          <Avatar name={userName} src={userAvatar} size="sm" />
          <span className="hidden sm:inline-block font-body text-xs font-semibold text-ink">
            {userName}
          </span>
        </div>
      </div>
    </header>
  )
}
