import React, { useState } from 'react'
import { Sidebar, type NavGroup, type NavItem as SidebarNavItem } from './Sidebar'
import { Topbar } from './Topbar'
import { SlideOver } from '@/components/ui/SlideOver'
import { getPermittedNav } from '@/config/navigation'
import { useAuth } from '@/modules/auth/AuthProvider'
import { NotificationBell } from '@/modules/notifications/NotificationBell'
import { MOCK_ROLE_PERMISSIONS } from './DevRoleSwitcher'
import { cn } from '@/lib/utils'

export interface AppShellProps {
  groups?: NavGroup[]
  activePath?: string
  onNavigate?: (path: string) => void
  orgName?: string
  orgSubtitle?: string
  userName?: string
  userRole?: string
  userAvatar?: string
  children: React.ReactNode
  unreadNotifications?: number
  topbarActionSlot?: React.ReactNode
  className?: string
}

export function AppShell({
  groups: suppliedGroups,
  activePath: suppliedActivePath,
  onNavigate,
  orgName: suppliedOrgName,
  orgSubtitle: suppliedOrgSubtitle,
  userName: suppliedUserName,
  userRole: suppliedUserRole,
  userAvatar: suppliedUserAvatar,
  children,
  unreadNotifications,
  topbarActionSlot,
  className,
}: AppShellProps) {
  const auth = useAuth()
  const access = auth.access
  const session = auth.session
  const devPreviewRole = auth.devPreviewRole
  const [mobileOpen, setMobileOpen] = useState(false)

  // Use dev preview role permissions if selected in DEV mode, otherwise live session permissions
  const activePermissions =
    import.meta.env.DEV && devPreviewRole
      ? MOCK_ROLE_PERMISSIONS[devPreviewRole]
      : access?.permissionKeys ?? []

  const activeRoles =
    import.meta.env.DEV && devPreviewRole ? [devPreviewRole] : access?.roleKeys ?? []

  const activeRoleName =
    suppliedUserRole ||
    (import.meta.env.DEV && devPreviewRole
      ? devPreviewRole
      : access?.roleKeys[0] ?? 'employee')

  const userName =
    suppliedUserName || access?.profile?.displayName || session?.email?.split('@')[0] || 'User'
  const userAvatar = suppliedUserAvatar || access?.profile?.avatarPath
  const orgName = suppliedOrgName || 'Egypro Uganda'
  const orgSubtitle = suppliedOrgSubtitle || 'UGX · Kampala Headquarters'

  // Filter navigation dynamically based on active permissions and roles if groups not explicitly passed
  const groupedSections = getPermittedNav(activePermissions, activeRoles)

  const sidebarGroups: NavGroup[] =
    suppliedGroups ||
    groupedSections.map((sec) => ({
      title: sec.section,
      items: sec.items.map(
        (item): SidebarNavItem => ({
          id: item.key,
          label: item.label,
          path: item.path,
          icon: <item.icon className="h-4 w-4" />,
        }),
      ),
    }))

  const activePath = suppliedActivePath || window.location.pathname

  const handleNavigate = (path: string) => {
    if (onNavigate) {
      onNavigate(path)
    } else {
      window.location.href = path
    }
    setMobileOpen(false)
  }

  return (
    <div className={cn('flex h-screen w-full overflow-hidden bg-canvas text-ink', className)}>
      {/* Desktop Sidebar (lg and up) */}
      <div className="hidden lg:block h-full">
        <Sidebar
          groups={sidebarGroups}
          activePath={activePath}
          onNavigate={handleNavigate}
          orgName={orgName}
          orgSubtitle={orgSubtitle}
          userName={userName}
          userRole={activeRoleName}
          userAvatar={userAvatar}
          onSignOut={() => void auth.signOut()}
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
          groups={sidebarGroups}
          activePath={activePath}
          onNavigate={handleNavigate}
          orgName={orgName}
          orgSubtitle={orgSubtitle}
          userName={userName}
          userRole={activeRoleName}
          userAvatar={userAvatar}
          onSignOut={() => void auth.signOut()}
          className="w-full h-full border-r-0"
        />
      </SlideOver>

      {/* Main Canvas Region */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          onToggleMobileSidebar={() => setMobileOpen(true)}
          userName={userName}
          userAvatar={userAvatar}
          onSignOut={() => void auth.signOut()}
          unreadNotifications={unreadNotifications}
          notificationSlot={
            unreadNotifications === undefined ? (
              <NotificationBell onNavigate={handleNavigate} />
            ) : undefined
          }
          actionSlot={topbarActionSlot}
        />

        {/* Scrollable Content Region */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          <div className="mx-auto max-w-7xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
