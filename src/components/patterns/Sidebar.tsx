import React from 'react'
import { ChevronRight, Sparkles, Building2, LogOut } from 'lucide-react'
import { Avatar } from '@/components/ui/Wrappers'
import { Badge } from '@/components/ui/StatusPill'
import { cn } from '@/lib/utils'

export type BadgeTone = 'emerald' | 'amber' | 'violet' | 'blue' | 'rose' | 'cyan' | 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneMap: Record<BadgeTone, 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'neutral'> = {
  emerald: 'success',
  amber: 'warning',
  rose: 'danger',
  blue: 'info',
  cyan: 'info',
  violet: 'violet',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
}

export interface NavItem {
  id: string
  label: string
  path: string
  icon: React.ReactNode
  badgeCount?: number
  badgeTone?: BadgeTone
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export interface SidebarProps {
  groups: NavGroup[]
  activePath: string
  onNavigate?: (path: string) => void
  orgName?: string
  orgSubtitle?: string
  userName?: string
  userRole?: string
  userAvatar?: string
  className?: string
}

export function Sidebar({
  groups,
  activePath,
  onNavigate,
  orgName = 'Egypro Uganda',
  orgSubtitle = 'UGX · UG',
  userName = 'Dora Agai',
  userRole = 'HR Administrator',
  userAvatar,
  className,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-full w-64 flex-col bg-sidebar text-white shrink-0 select-none border-r border-sidebar/20',
        className,
      )}
    >
      {/* Org Chip Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald/20 text-emerald">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold text-white leading-tight">{orgName}</h2>
            <p className="font-body text-[11px] text-white/50">{orgSubtitle}</p>
          </div>
        </div>
      </div>

      {/* Navigation Group Items */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 text-[10px] font-bold tracking-wider text-white/40 uppercase mb-2">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = activePath === item.path

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate?.(item.path)}
                    className={cn(
                      'relative flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 group',
                      isActive
                        ? 'bg-white/10 text-white font-semibold'
                        : 'text-white/70 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    {/* Sliding active indicator */}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-emerald transition-all duration-300 ease-exp"
                      />
                    )}

                    <div className="flex items-center gap-2.5">
                      <span className={cn('text-white/60 group-hover:text-white', isActive && 'text-emerald')}>
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </div>

                    {item.badgeCount !== undefined && item.badgeCount > 0 && (
                      <Badge tone={toneMap[item.badgeTone || 'emerald']} size="sm">
                        {item.badgeCount}
                      </Badge>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* AI Assistant Affordance */}
        <div className="px-1 pt-2">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg bg-gradient-to-r from-emerald/20 to-cyan/20 border border-emerald/30 px-3 py-2.5 text-xs text-white transition-all hover:border-emerald/50"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald animate-pulse" />
              <span className="font-medium">Ask AI Assistant</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-white/60" />
          </button>
        </div>
      </div>

      {/* User Block Footer */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center justify-between rounded-md p-2 hover:bg-white/5">
          <div className="flex items-center gap-2.5">
            <Avatar name={userName} src={userAvatar} size="sm" />
            <div className="text-left">
              <p className="font-body text-xs font-semibold text-white leading-tight">{userName}</p>
              <p className="font-body text-[10px] text-white/50">{userRole}</p>
            </div>
          </div>
          <button
            type="button"
            title="Log out"
            className="text-white/40 hover:text-white p-1 rounded"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
