import { useMemo, useState } from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Lock,
  Mail,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import { isMonitorOnlyAccount } from '@/config/navigation'
import { useAuth } from '@/modules/auth/AuthProvider'
import { Switch } from '@/components/ui/Toggles'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  isSafeNotificationPath,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationBellState,
  useNotificationPreferences,
  useSetNotificationEmailPreference,
  type NotificationBellFilter,
  type NotificationCategory,
  type NotificationItem,
} from './api/notifications'

export interface NotificationBellProps {
  onNavigate?: (path: string) => void
}

type BellTab = 'inbox' | 'preferences'

const BELL_PAGE_SIZE = 20

function formatNotificationTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-UG', {
    timeZone: 'Africa/Kampala',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function extractErrMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message
  }
  return 'Could not update notification state.'
}

export function NotificationBell({ onNavigate }: NotificationBellProps) {
  const auth = useAuth()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<BellTab>('inbox')
  const [filter, setFilter] = useState<NotificationBellFilter>('all')
  const [page, setPage] = useState(1)

  const roles =
    import.meta.env.DEV && auth.devPreviewRole
      ? [auth.devPreviewRole]
      : auth.access?.roleKeys ?? []
  const isMonitorOnly = isMonitorOnlyAccount(roles)

  const offset = (page - 1) * BELL_PAGE_SIZE
  const bellQuery = useNotificationBellState({
    filter,
    limit: BELL_PAGE_SIZE,
    offset,
  })
  const preferencesQuery = useNotificationPreferences()
  const markReadMutation = useMarkNotificationRead()
  const markAllReadMutation = useMarkAllNotificationsRead()
  const setPreferenceMutation = useSetNotificationEmailPreference()

  const prefMap = useMemo(() => {
    const map = new Map<NotificationCategory, boolean>()
    for (const row of preferencesQuery.data ?? []) {
      map.set(row.category, row.email_enabled)
    }
    return map
  }, [preferencesQuery.data])

  // Monitor display accounts never receive or manage personal alerts.
  if (isMonitorOnly) {
    return null
  }

  const bellState = bellQuery.data
  // Complete recipient totals come strictly from the server-wide summary (never derived from current page rows).
  const hasCompleteCounts = Boolean(bellState)
  const totalCount = bellState?.total_count ?? 0
  const unreadCount = bellState?.unread_count ?? 0
  const unreadUrgentCount = bellState?.unread_urgent_count ?? 0
  const filteredCount = bellState?.filtered_count ?? 0
  const notifications = bellState?.rows ?? []
  const totalPages = Math.max(1, Math.ceil(filteredCount / BELL_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  const switchFilter = (nextFilter: NotificationBellFilter) => {
    setFilter(nextFilter)
    setPage(1)
  }

  const handleNotificationClick = async (item: NotificationItem) => {
    if (!item.is_read) {
      try {
        await markReadMutation.mutateAsync(item.id)
      } catch (err) {
        toast(extractErrMessage(err), { tone: 'danger' })
      }
    }
    if (isSafeNotificationPath(item.action_path) && onNavigate) {
      setOpen(false)
      onNavigate(item.action_path)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await markAllReadMutation.mutateAsync()
      setPage(1)
      toast('All notifications marked read', { tone: 'success' })
    } catch (err) {
      toast(extractErrMessage(err), { tone: 'danger' })
    }
  }

  const handleTogglePreference = async (category: NotificationCategory, nextValue: boolean) => {
    if (category === 'service_urgent') return
    try {
      await setPreferenceMutation.mutateAsync({ category, enabled: nextValue })
      toast(
        `${NOTIFICATION_CATEGORY_META[category].label} emails ${nextValue ? 'enabled' : 'muted'}`,
        { tone: 'success' },
      )
    } catch (err) {
      toast(extractErrMessage(err), { tone: 'danger' })
    }
  }

  const triggerLabel = bellQuery.isError
    ? 'Notifications (unavailable)'
    : hasCompleteCounts && unreadCount > 0
      ? `Notifications (${unreadCount} unread${unreadUrgentCount > 0 ? `, ${unreadUrgentCount} urgent` : ''})`
      : 'Notifications'

  const startRow = filteredCount === 0 ? 0 : offset + 1
  const endRow = Math.min(offset + notifications.length, filteredCount)

  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          title="Notifications"
          className={cn(
            'relative rounded-md p-2 text-soft hover:bg-line/40 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald',
            unreadUrgentCount > 0 && 'text-rose hover:text-rose',
          )}
        >
          <Bell className="h-4 w-4" />
          {bellQuery.isError ? (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-amber font-mono text-[10px] font-bold text-ink ring-2 ring-surface"
            >
              !
            </span>
          ) : (
            hasCompleteCounts &&
            unreadCount > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -right-0.5 -top-0.5 flex min-w-4 h-4 px-1 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white',
                  unreadUrgentCount > 0 ? 'bg-rose ring-2 ring-surface' : 'bg-emerald',
                )}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )
          )}
        </button>
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="end"
          sideOffset={8}
          aria-label="Notification Center"
          className="z-popover w-[min(26rem,calc(100vw-1rem))] rounded-lg border border-line bg-surface shadow-xl focus:outline-none"
        >
          {/* Header & Tab Switcher */}
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-1 rounded-md bg-canvas p-0.5 border border-line">
              <button
                type="button"
                onClick={() => setActiveTab('inbox')}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-semibold transition-colors',
                  activeTab === 'inbox'
                    ? 'bg-surface text-ink shadow-xs'
                    : 'text-muted hover:text-ink',
                )}
              >
                Inbox {hasCompleteCounts && unreadCount > 0 ? `(${unreadCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preferences')}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-colors',
                  activeTab === 'preferences'
                    ? 'bg-surface text-ink shadow-xs'
                    : 'text-muted hover:text-ink',
                )}
              >
                <Settings2 className="h-3 w-3" />
                Email Prefs
              </button>
            </div>

            {activeTab === 'inbox' && hasCompleteCounts && unreadCount > 0 && (
              <button
                type="button"
                disabled={markAllReadMutation.isPending}
                onClick={() => void handleMarkAllRead()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald hover:underline disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {activeTab === 'inbox' ? (
            <div className="flex flex-col">
              {/* Filter Bar over Full Recipient History */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-canvas/60 px-4 py-2">
                {(
                  [
                    ['all', `All${hasCompleteCounts ? ` (${totalCount})` : ''}`],
                    ['unread', `Unread${hasCompleteCounts ? ` (${unreadCount})` : ''}`],
                    [
                      'urgent_unread',
                      `Urgent Unread${hasCompleteCounts ? ` (${unreadUrgentCount})` : ''}`,
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => switchFilter(key)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px] font-semibold transition-colors',
                      filter === key
                        ? key === 'urgent_unread'
                          ? 'bg-rose text-white'
                          : 'bg-emerald text-white'
                        : 'bg-surface text-soft border border-line hover:text-ink',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Sticky Escalation Strip if older unread urgent alerts sit beyond current page */}
              {hasCompleteCounts && unreadUrgentCount > 0 && filter !== 'urgent_unread' && (
                <button
                  type="button"
                  onClick={() => switchFilter('urgent_unread')}
                  className="flex items-center justify-between gap-2 border-b border-rose/30 bg-rose-tint/35 px-4 py-2 text-left text-xs font-semibold text-rose hover:bg-rose-tint/50"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {unreadUrgentCount} unread urgent alert{unreadUrgentCount === 1 ? '' : 's'}
                  </span>
                  <span className="underline">View urgent →</span>
                </button>
              )}

              <div className="max-h-[21rem] overflow-y-auto divide-y divide-line">
                {bellQuery.isError ? (
                  <div className="p-4 text-center space-y-2">
                    <p className="text-xs font-semibold text-rose">
                      Could not load notification counts or history right now.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      leftIcon={<RefreshCw className="h-3 w-3" />}
                      onClick={() => void bellQuery.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : bellQuery.isLoading ? (
                  <div className="p-6 text-center text-xs text-muted">Loading notifications…</div>
                ) : notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted">
                    {filter === 'all'
                      ? "You're all caught up. No notifications yet."
                      : filter === 'urgent_unread'
                        ? 'No unread urgent alerts.'
                        : 'No unread notifications.'}
                  </div>
                ) : (
                  notifications.map((item) => {
                    const isUrgent = item.category === 'service_urgent'
                    const meta = NOTIFICATION_CATEGORY_META[item.category]
                    const hasTarget = isSafeNotificationPath(item.action_path)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleNotificationClick(item)}
                        className={cn(
                          'w-full text-left px-4 py-3 transition-colors hover:bg-canvas/70 focus:outline-none focus-visible:bg-canvas',
                          !item.is_read && (isUrgent ? 'bg-rose-tint/25' : 'bg-emerald-tint/15'),
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {!item.is_read && (
                              <span
                                aria-label="Unread"
                                className={cn(
                                  'inline-block h-2 w-2 rounded-full',
                                  isUrgent ? 'bg-rose' : 'bg-emerald',
                                )}
                              />
                            )}
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                isUrgent
                                  ? 'bg-rose-tint text-rose border border-rose/30'
                                  : 'bg-canvas text-soft border border-line',
                              )}
                            >
                              {isUrgent && <AlertTriangle className="h-2.5 w-2.5" />}
                              {meta.label}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-muted tabular-nums">
                            {formatNotificationTimestamp(item.created_at)}
                          </span>
                        </div>

                        <p className="mt-1 text-xs font-semibold text-ink">{item.title}</p>
                        <p className="mt-0.5 text-xs text-soft line-clamp-3">{item.message}</p>
                        {hasTarget && (
                          <p className="mt-1 text-[11px] font-semibold text-emerald">
                            Open linked record →
                          </p>
                        )}
                      </button>
                    )
                  })
                )}
              </div>

              {hasCompleteCounts && filteredCount > BELL_PAGE_SIZE && (
                <div className="flex items-center justify-between gap-2 border-t border-line bg-canvas/50 px-4 py-2 text-[11px] text-muted">
                  <span>
                    Showing {startRow}–{endRow} of {filteredCount} · Page {safePage} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={safePage <= 1}
                      aria-label="Previous notifications page"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={safePage >= totalPages}
                      aria-label="Next notifications page"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-[24rem] overflow-y-auto p-4 space-y-3">
              <div className="rounded-md border border-line bg-canvas p-3 text-xs text-soft flex items-start gap-2">
                <Mail className="h-4 w-4 text-emerald shrink-0 mt-0.5" />
                <p>
                  Choose which categories email you when email dispatch is enabled. Urgent Field
                  Service alerts are locked on for operational escalation continuity.
                </p>
              </div>

              {preferencesQuery.isError ? (
                <div className="rounded-md border border-rose/40 bg-rose-tint/20 p-3 text-xs text-rose flex items-center justify-between gap-2">
                  <span>Could not load saved preferences.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void preferencesQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {NOTIFICATION_CATEGORIES.map((category) => {
                    const meta = NOTIFICATION_CATEGORY_META[category]
                    const isLocked = meta.lockedOn === true
                    const enabled = isLocked ? true : (prefMap.get(category) ?? true)
                    return (
                      <li
                        key={category}
                        className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-ink">{meta.label}</span>
                            {isLocked && (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-tint/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose">
                                <Lock className="h-2.5 w-2.5" />
                                Mandatory
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted">{meta.description}</p>
                        </div>
                        <Switch
                          checked={enabled}
                          disabled={isLocked || setPreferenceMutation.isPending}
                          aria-label={`${meta.label} email alerts${isLocked ? ' (locked on)' : ''}`}
                          onCheckedChange={(next) => void handleTogglePreference(category, next)}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
