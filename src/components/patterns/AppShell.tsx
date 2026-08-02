import React, { useState } from 'react'
import { Sidebar, type NavGroup } from './Sidebar'
import { Topbar } from './Topbar'
import { SlideOver } from '@/components/ui/SlideOver'
import { cn } from '@/lib/utils'

export interface AppShellProps {
  groups: NavGroup[]
  activePath: string
  onNavigate?: (path: string) => void
  children: React.ReactNode
  orgName?: string
  orgSubtitle?: string
  userName?: string
  userRole?: string
  userAvatar?: string
  unreadNotifications?: number
  topbarActionSlot?: React.ReactNode
  className?: string
}

export function AppShell({
  groups,
  activePath,
  onNavigate,
  children,
  orgName,
  orgSubtitle,
  userName,
  userRole,
  userAvatar,
  unreadNotifications,
  topbarActionSlot,
  className,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleNav = (path: string) => {
    onNavigate?.(path)
    setMobileOpen(false)
  }

  return (
    <div className={cn('flex h-screen w-full overflow-hidden bg-canvas text-ink', className)}>
      {/* Desktop Sidebar (visible lg and up) */}
      <div className="hidden lg:block h-full">
        <Sidebar
          groups={groups}
          activePath={activePath}
          onNavigate={handleNav}
          orgName={orgName}
          orgSubtitle={orgSubtitle}
          userName={userName}
          userRole={userRole}
          userAvatar={userAvatar}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      <SlideOver
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        widthClass="max-w-[280px]"
        className="p-0 border-r-0"
      >
        <Sidebar
          groups={groups}
          activePath={activePath}
          onNavigate={handleNav}
          orgName={orgName}
          orgSubtitle={orgSubtitle}
          userName={userName}
          userRole={userRole}
          userAvatar={userAvatar}
          className="w-full h-full border-r-0"
        />
      </SlideOver>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          onToggleMobileSidebar={() => setMobileOpen(true)}
          userName={userName}
          userAvatar={userAvatar}
          unreadNotifications={unreadNotifications}
          actionSlot={topbarActionSlot}
        />

        {/* Scrollable Canvas */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="mx-auto max-w-7xl space-y-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
