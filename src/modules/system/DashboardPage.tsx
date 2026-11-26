import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import { isItemPermitted, NAV_ITEMS } from '@/config/navigation'
import { useProtectedIdentityScope } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/modules/auth/AuthProvider'
import { getEffectiveServiceAccess, useMyAssignedRequests, useServiceMonitorSnapshot, useServiceOverviewCounts } from '@/modules/field-services/api/services'
import { isSafeNotificationPath, useMarkNotificationRead, useNotificationBellState, type NotificationItem } from '@/modules/notifications/api/notifications'
import { listProjects } from '@/modules/projects/projectApi'
import { readInventoryOverview } from '@/modules/warehouse/catalog/catalogApi'
import {
  ServiceCoordinatorDashboard,
  ServiceDeskDashboard,
  ServiceTechnicianDashboard,
} from './FixedInternetDashboards'
import { systemSessionGuard } from './systemSession'

const shortcuts = [
  'service-my-jobs', 'my-router-float', 'service-intake', 'service-dispatch', 'service-monitor',
  'projects', 'cash', 'router-float', 'requests', 'employee-equipment', 'returns',
  'employees', 'reports', 'users', 'settings', 'audit',
  'my-attendance', 'my', 'my-leave', 'my-equipment',
]
const panel = 'rounded-xl border border-line bg-surface p-4 sm:p-5'

type Metric = {
  label: string
  value?: number
  path: string
  failed: boolean
  retry: () => void
}

function MetricCard({ label, value, path, failed, retry }: Metric) {
  return (
    <article className={panel}>
      <Link to={path} className="group flex items-start justify-between gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald">
        <div>
          <h2 className="text-sm font-medium text-soft group-hover:text-ink">{label}</h2>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
            {value === undefined ? '—' : value.toLocaleString('en-UG')}
          </p>
        </div>
        <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted group-hover:text-emerald" />
      </Link>
      {failed && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-soft">
        <span>{value === undefined ? 'Count unavailable' : 'Showing the last loaded count'}</span>
        <Button size="sm" variant="ghost" onClick={retry}>Retry</Button>
      </div>}
    </article>
  )
}

function RecentNotifications() {
  const feed = useNotificationBellState({ filter: 'unread', limit: 5 })
  const mark = useMarkNotificationRead()
  const entries = feed.data?.rows
  function markRead(item: NotificationItem) {
    if (!item.is_read) void mark.mutateAsync(item.id).catch(() => undefined)
  }
  return (
    <section aria-labelledby="recent-notifications" className={panel}>
      <h2 id="recent-notifications" className="font-display font-semibold">Unread notifications</h2>
      {feed.isError && <div role="alert" className="mt-3 flex items-center gap-2 text-sm text-soft">
        <span>Could not load notifications.</span>
        <Button size="sm" variant="outline" onClick={() => void feed.refetch()}>Retry</Button>
      </div>}
      {feed.isPending && <p role="status" className="mt-2 text-sm text-soft">Loading notifications…</p>}
      {entries?.length === 0 && <p className="mt-2 text-sm text-soft">You’re up to date.</p>}
      {entries && entries.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {entries.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                {item.category === 'service_urgent' && <StatusPill tone="danger">Urgent</StatusPill>}
                {isSafeNotificationPath(item.action_path)
                  ? <Link to={item.action_path} className="block break-words font-medium text-ink underline-offset-4 hover:underline" onClick={() => markRead(item)}>{item.title}</Link>
                  : <p className="break-words font-medium text-ink">{item.title}</p>}
                <p className="mt-0.5 break-words text-soft">{item.message}</p>
              </div>
              <Button size="sm" variant="ghost" disabled={mark.isPending} onClick={() => markRead(item)} aria-label={'Mark as read: ' + item.title}>Mark read</Button>
            </li>
          ))}
        </ul>
      )}
      {mark.isError && <p role="alert" className="mt-2 text-sm text-soft">Could not mark the notification as read.</p>}
    </section>
  )
}

export default function DashboardPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const { roleKeys, permissionKeys, hasPermission } = getEffectiveServiceAccess(auth)
  const permitted = NAV_ITEMS.filter((item) => isItemPermitted(item, permissionKeys, roleKeys))
  const actions = shortcuts.flatMap((key) => permitted.find((item) => item.key === key) ?? [])
  const canOpen = (key: string) => permitted.some((item) => item.key === key)
  const live = scope.isAuthReady && !(import.meta.env.DEV && auth.devPreviewRole)
  const primaryRole = roleKeys.find((role) => role !== 'employee') ?? roleKeys[0]
  const canReadService = hasPermission('service_requests.read')
  const canMonitor = canOpen('service-monitor')
  const canDispatchOrReview =
    hasPermission('service_requests.dispatch') || hasPermission('service_requests.review')
  const canIntakeOrReport =
    hasPermission('service_requests.intake') || hasPermission('service_requests.report_provider')

  const isServiceCoordinatorView =
    canDispatchOrReview &&
    ((!canOpen('projects') && !canOpen('employees')) ||
      primaryRole === 'service_coordinator' ||
      primaryRole === 'service_dispatch_backup')
  const isServiceDeskView =
    !isServiceCoordinatorView && canIntakeOrReport && !canDispatchOrReview && canReadService
  const isServiceTechnicianView =
    !isServiceCoordinatorView &&
    !isServiceDeskView &&
    hasPermission('service_visits.read_assigned') &&
    !canReadService &&
    ((!canOpen('projects') && !canOpen('employees')) || primaryRole === 'service_technician')

  const isFixedInternetView =
    isServiceCoordinatorView || isServiceDeskView || isServiceTechnicianView

  const needsOverview = !isFixedInternetView && !canMonitor && canReadService
  const canReadJobs = !isFixedInternetView && !canMonitor && !needsOverview && canOpen('service-my-jobs')
  const monitor = useServiceMonitorSnapshot(live && !isFixedInternetView && canMonitor)
  const overview = useServiceOverviewCounts(live && needsOverview)
  const jobs = useMyAssignedRequests(1, 0, { enabled: live && canReadJobs, assignmentScope: 'active' })
  const projects = useQuery({
    queryKey: ['dashboard', scope.identityKey, scope.authEpoch, 'active-projects'],
    enabled: live && !isFixedInternetView && canOpen('projects'),
    queryFn: async ({ signal }) => (await listProjects(scope, signal, { page: 0, status: 'active', name: '' })).count,
    retry: false,
  })
  const inventory = useQuery({
    queryKey: ['dashboard', scope.identityKey, scope.authEpoch, 'inventory'],
    enabled: live && !isFixedInternetView && canOpen('inventory') && canOpen('requests'),
    queryFn: ({ signal }) => readInventoryOverview(scope, signal),
    retry: false,
  })
  const employees = useQuery({
    queryKey: ['dashboard', scope.identityKey, scope.authEpoch, 'employee-records'],
    enabled: live && !isFixedInternetView && canOpen('employees'),
    queryFn: async ({ signal }) => {
      const check = systemSessionGuard(scope)
      const { count, error } = await getSupabaseClient().from('employees').select('id', { count: 'exact', head: true })
        .is('archived_at', null).abortSignal(signal)
      check()
      if (error || count === null) throw new Error('Employee count is unavailable.')
      return count
    },
    retry: false,
  })
  const metrics: Metric[] = []
  if (live && canMonitor) {
    metrics.push(
      { label: 'Service jobs awaiting assignment', value: monitor.data?.unassigned_count, path: '/services/monitor', failed: monitor.isError, retry: () => void monitor.refetch() },
      { label: 'Open urgent flags', value: monitor.data?.open_urgent_flags_count, path: '/services/monitor', failed: monitor.isError, retry: () => void monitor.refetch() },
    )
  }
  if (live && needsOverview) metrics.push({
    label: 'Tickets needing intake attention', value: overview.data?.queues.intake_attention_count, path: canOpen('service-intake') ? '/services/intake' : '/services/dispatch',
    failed: overview.isError, retry: () => void overview.refetch(),
  })
  if (live && canReadJobs) metrics.push({
    label: 'My active service jobs', value: jobs.data?.active_count, path: '/services/my-jobs', failed: jobs.isError, retry: () => void jobs.refetch(),
  })
  if (live && canOpen('projects')) metrics.push({
    label: 'Active projects', value: projects.data, path: '/ops/projects', failed: projects.isError, retry: () => void projects.refetch(),
  })
  if (live && canOpen('inventory') && canOpen('requests')) metrics.push({
    label: 'Stock requests awaiting approval', value: inventory.data?.requestsPendingApproval, path: '/inventory/requests',
    failed: inventory.isError, retry: () => void inventory.refetch(),
  })
  if (live && canOpen('employees')) metrics.push({
    label: 'Employee records', value: employees.data, path: '/people/employees', failed: employees.isError, retry: () => void employees.refetch(),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" />
      {isServiceCoordinatorView ? (
        <ServiceCoordinatorDashboard
          scope={scope}
          live={live}
          canReadService={canReadService}
          canMonitor={canMonitor}
          canRouterFloat={hasPermission('router_float.read')}
        />
      ) : isServiceDeskView ? (
        <ServiceDeskDashboard
          live={live}
          canIntake={hasPermission('service_requests.intake')}
          canReadService={canReadService}
        />
      ) : isServiceTechnicianView ? (
        <ServiceTechnicianDashboard
          scope={scope}
          live={live}
          canMyJobs={canOpen('service-my-jobs')}
          canWorkVisits={hasPermission('service_visits.work_assigned')}
        />
      ) : (
        <>
          {metrics.length > 0 && <section aria-label="Work overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
          </section>}
          <section aria-labelledby="dashboard-actions" className="space-y-3">
            <h2 id="dashboard-actions" className="font-display font-semibold">Quick actions</h2>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {actions.map((item) => (
                <Link key={item.key} to={item.path} className="group flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm font-medium hover:border-emerald hover:text-emerald-600">
                  <item.icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                  {item.label}
                  <ArrowUpRight aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-muted group-hover:text-emerald" />
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
      {live && <RecentNotifications />}
    </div>
  )
}
