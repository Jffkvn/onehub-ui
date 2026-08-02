import React, { useState } from 'react'
import { Search, Bell, Menu, LogOut, Sun, Moon } from 'lucide-react'
import { Avatar } from '@/components/ui/Wrappers'
import { DropdownMenu } from '@/components/ui/DropdownMenu'
import { DevRoleSwitcher } from './DevRoleSwitcher'
import { cn } from '@/lib/utils'

export interface TopbarProps {
  onSearchChange?: (query: string) => void
  unreadNotifications?: number
  onNotificationClick?: () => void
  userName?: string
  userAvatar?: string
  onSignOut?: () => void
  actionSlot?: React.ReactNode
  onToggleMobileSidebar?: () => void
  className?: string
}

export function Topbar({
  onSearchChange,
  unreadNotifications = 0,
  onNotificationClick,
  userName = 'User',
  userAvatar,
  onSignOut,
  actionSlot,
  onToggleMobileSidebar,
  className,
}: TopbarProps) {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )

  const toggleDarkMode = () => {
    const isNowDark = document.documentElement.classList.toggle('dark')
    setIsDark(isNowDark)
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-topbar flex h-16 w-full items-center justify-between border-b border-line bg-surface/95 px-4 sm:px-6 backdrop-blur-md',
        className,
      )}
    >
      {/* Left Search & Mobile Menu Button */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="lg:hidden text-muted hover:text-ink p-1.5 rounded-md hover:bg-line/40"
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
            className="h-9 w-full rounded-md border border-line bg-canvas pl-9 pr-4 text-xs text-ink placeholder:text-muted focus:border-emerald focus:bg-surface focus:outline-none focus:ring-1 focus:ring-emerald"
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5">
        {/* Dev-only Role Switcher */}
        <DevRoleSwitcher />

        {actionSlot}

        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleDarkMode}
          className="rounded-md p-2 text-soft hover:bg-line/40 hover:text-ink focus:outline-none"
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDark ? <Sun className="h-4 w-4 text-amber" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Notifications */}
        <button
          type="button"
          onClick={onNotificationClick}
          className="relative rounded-md p-2 text-soft hover:bg-line/40 hover:text-ink focus:outline-none"
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadNotifications > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose font-mono text-[10px] font-bold text-white">
              {unreadNotifications}
            </span>
          )}
        </button>

        <div className="h-5 w-[1px] bg-line mx-1" />

        {/* User Dropdown Menu */}
        <DropdownMenu
          trigger={
            <button
              type="button"
              className="flex items-center gap-2 rounded-md p-1 hover:bg-line/40 focus:outline-none"
            >
              <Avatar name={userName} src={userAvatar} size="sm" />
              <span className="hidden md:inline-block font-body text-xs font-semibold text-ink">
                {userName}
              </span>
            </button>
          }
          items={[
            {
              key: 'profile',
              label: userName,
              disabled: true,
            },
            {
              key: 'signout',
              label: 'Sign out',
              icon: <LogOut className="h-4 w-4" />,
              danger: true,
              onClick: onSignOut,
            },
          ]}
          align="end"
        />
      </div>
    </header>
  )
}
