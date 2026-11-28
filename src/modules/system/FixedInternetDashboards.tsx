import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, CheckCircle2, FilePlus2, Router } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAttendanceTodayContext } from '@/modules/attendance/api/attendance'
import { formatTimeInZone } from '@/modules/attendance/lib/zonedTime'

import { EmptyState } from '@/components/patterns/EmptyState'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import { cn } from '@/lib/utils'
import { extractErrorMessage, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import {
  useMyAssignedRequests,
  useServiceActivityWindow,
  useServiceMonitorSnapshot,
  useServiceOverviewCounts,
  useServiceRequests,
  type ServiceActivitySummary,
} from '@/modules/field-services/api/services'
import {
  ServicePriorityPill,
  ServiceStatusPill,
  ServiceTimestamp,
  ServiceTypeBadge,
  UrgentFlagBadge,
} from '@/modules/field-services/components/ServiceBadges'
import {
  classifyTechnicianAssignmentBucket,
  isServiceRequestOverdue,
  type ServiceRequestListRow,
} from '@/modules/field-services/schemas/services'
import { readMyRouterFloat, readRouterFloatOverview } from '@/modules/warehouse/router-float/routerFloatApi'

import { workCardTones, workPanel as panel } from './WorkDashboardLayout'
const liveRefreshMs = 30_000

export type DashboardCardTone = 'default' | 'warning' | 'danger' | 'success'

function ActionCard({
  label,
  value,
  hint,
  path,
  tone = 'default',
  failed,
  onRetry,
}: {
  label: string
  value?: number | string
  hint?: string
  path: string
  tone?: DashboardCardTone
  failed?: boolean
  onRetry?: () => void
}) {
  const formatted =
    value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString('en-UG') : value

  return (
    <article className={cn(panel, tone !== 'default' && workCardTones[tone])}>
      <Link
        to={path}
        className="group flex items-start justify-between gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald"
      >
        <div className="min-w-0">
          <h2 className="break-words text-base font-medium text-ink">{label}</h2>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">{formatted}</p>
          {hint && <p className="mt-1 text-sm text-soft">{hint}</p>}
        </div>
        <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted group-hover:text-emerald" />
      </Link>
      {failed && onRetry && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-soft">
          <span>Count unavailable</span>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </article>
  )
}

function YesterdayHandoff({ summary }: { summary: ServiceActivitySummary }) {
  const day = summary.yesterday
  return (
    <section aria-label="Yesterday’s handoff" className={panel}>
      <h2 className="font-display text-sm font-semibold text-ink">Yesterday · {day.label}</h2>
      <p className="mt-1 text-sm text-soft">
        {day.submittedCount} sent to dispatch · {day.visitsCompletedCount} visits completed · {day.providerConfirmedCount} confirmed by provider
      </p>
    </section>
  )
}

export function ServiceDeskDashboard({
  live,
  canIntake,
  canReadService,
}: {
  live: boolean
  canIntake: boolean
  canReadService: boolean
}) {
  const overview = useServiceOverviewCounts(live && canReadService, liveRefreshMs)
  const attentionQueue = useServiceRequests(
    { statuses: ['draft', 'coordinator_reviewed'], limit: 6, offset: 0 },
    live && canReadService,
    liveRefreshMs,
  )
  const activity = useServiceActivityWindow(live && canReadService)

  const queues = overview.data?.queues
  const rows = attentionQueue.data?.rows ?? []
  const queued = queues?.submitted_count
  const inField = queues ? queues.assigned_count + queues.in_progress_count : undefined

  return (
    <div className="space-y-5">
      <PageHeader title="Service desk" className="[&_h1]:sm:text-2xl" actions={canIntake &&
        <Link to="/services/intake/new" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
          <FilePlus2 aria-hidden="true" className="h-4 w-4" /> Log a ticket
        </Link>} />
      <section className={cn(panel, 'flex flex-wrap items-center justify-between gap-3')} aria-label="Live service queue">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className={cn('h-2 w-2 rounded-full', overview.isError ? 'bg-amber' : 'bg-emerald')} aria-hidden="true" />
          {overview.isError ? 'Queue update unavailable' : 'Today’s queue'}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-soft">
          <Link className="hover:underline" to="/services/intake?queue=queued"><strong className="text-ink">{queued ?? '—'}</strong> awaiting assignment</Link>
          <Link className="hover:underline" to="/services/intake?queue=ongoing"><strong className="text-ink">{inField ?? '—'}</strong> with the field team</Link>
        </div>
      </section>
      <section aria-label="Service desk work overview" className="grid gap-3 sm:grid-cols-3">
        <ActionCard
          label="Drafts to Submit"
          value={queues?.draft_count}
          path="/services/intake?queue=draft"
          tone={(queues?.draft_count ?? 0) > 0 ? 'warning' : 'default'}
          failed={overview.isError}
          onRetry={() => void overview.refetch()}
        />
        <ActionCard
          label="Ready to Report to Provider"
          value={queues?.coordinator_reviewed_count}
          path="/services/intake?queue=ready_to_report"
          tone={(queues?.coordinator_reviewed_count ?? 0) > 0 ? 'warning' : 'default'}
          failed={overview.isError}
          onRetry={() => void overview.refetch()}
        />
        <ActionCard
          label="Awaiting Provider Confirmation"
          value={queues?.reported_to_provider_count}
          path="/services/intake?queue=reported_to_provider"
          failed={overview.isError}
          onRetry={() => void overview.refetch()}
        />
      </section>

      <section aria-labelledby="desk-needs-attention" className={cn(panel, 'space-y-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="desk-needs-attention" className="font-display text-lg font-semibold text-ink">
              Needs your attention
            </h2>
          </div>
        </div>

        {attentionQueue.isPending ? (
          <p role="status" className="text-sm text-soft">
            Loading service desk queue…
          </p>
        ) : attentionQueue.isError ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-soft">
            <span>{extractErrorMessage(attentionQueue.error)}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void attentionQueue.refetch()}>
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="All caught up"
            description="No intake drafts or coordinator-reviewed tickets need Service Desk action right now."
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const targetPath =
                row.status === 'draft'
                  ? `/services/intake?draft=${row.id}`
                  : `/services/requests/${row.id}?from=${encodeURIComponent('/dashboard')}`

              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ink">{row.internal_code}</span>
                      <ServiceTypeBadge requestType={row.request_type} />
                      <ServiceStatusPill status={row.status} />
                    </div>
                    <p className="break-words text-base font-medium text-ink">
                      {row.site_name} ({row.area_label}) — {row.provider_name} [{row.provider_reference}]
                    </p>
                  </div>
                  <Link to={targetPath}>
                    <Button
                      type="button"
                      size="sm"
                      variant={row.status === 'coordinator_reviewed' ? 'primary' : 'outline'}
                    >
                      {row.status === 'draft' ? 'Resume Draft' : 'Report to Provider'}
                    </Button>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {activity.data && !activity.isError && <YesterdayHandoff summary={activity.data} />}
    </div>
  )
}

function getCoordinatorNextStep(row: ServiceRequestListRow): {
  label: string
} {
  if (row.open_urgent_count > 0) return { label: 'Urgent' }
  if (row.status === 'work_completed') return { label: 'Review' }
  if (row.status === 'submitted') return { label: 'Assign' }
  if (isServiceRequestOverdue(row)) return { label: 'Check SLA' }
  return { label: 'Follow-Up' }
}

export function ServiceCoordinatorDashboard({
  scope,
  live,
  canReadService,
  canMonitor,
  canRouterFloat,
}: {
  scope: IdentityScopeRef
  live: boolean
  canReadService: boolean
  canMonitor: boolean
  canRouterFloat: boolean
}) {
  const overview = useServiceOverviewCounts(live && canReadService, liveRefreshMs)
  const monitor = useServiceMonitorSnapshot(live && canMonitor)
  const urgentList = useServiceRequests({ urgentOnly: true, limit: 5, offset: 0 }, live && canReadService, liveRefreshMs)
  const overdueList = useServiceRequests({ overdueOnly: true, limit: 6, offset: 0 }, live && canReadService, liveRefreshMs)
  const queueList = useServiceRequests(
    { statuses: ['submitted', 'work_completed', 'follow_up_required'], limit: 8, offset: 0 },
    live && canReadService,
    liveRefreshMs,
  )
  const routerFloat = useQuery({
    queryKey: ['warehouse', 'router-float', 'dashboard', scope.identityKey, scope.authEpoch],
    enabled: live && canRouterFloat && scope.isAuthReady && Boolean(scope.identityKey),
    queryFn: ({ signal }) => readRouterFloatOverview(scope, signal),
    retry: false,
  })

  const queues = overview.data?.queues

  const seen = new Set<string>()
  const priorityRows: ServiceRequestListRow[] = []
  for (const row of [
    ...(urgentList.data?.rows ?? []),
    ...(overdueList.data?.rows ?? []),
    ...(queueList.data?.rows ?? []),
  ]) {
    if (!seen.has(row.id)) {
      seen.add(row.id)
      priorityRows.push(row)
    }
    if (priorityRows.length >= 6) break
  }

  const floatItems = routerFloat.data?.active_float ?? []
  const floatPendingCount = floatItems.filter((item) => item.float_state === 'pending_handover').length
  const floatFaultyCount = floatItems.filter((item) => item.float_state === 'faulty_to_return').length
  const overdueCardValue = canMonitor ? monitor.data?.overdue_count : overdueList.data?.total_count

  return (
    <div className="space-y-5">
      <section aria-label="Dispatch and review overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ActionCard
          label="Awaiting Assignment"
          value={queues?.submitted_count}
          path="/services/dispatch?status=submitted"
          tone={(queues?.submitted_count ?? 0) > 0 ? 'warning' : 'default'}
          failed={overview.isError}
          onRetry={() => void overview.refetch()}
        />
        <ActionCard
          label="Open Urgent Tickets"
          value={queues?.open_urgent_tickets}
          path="/services/dispatch?urgent=1"
          tone={(queues?.open_urgent_tickets ?? 0) > 0 ? 'danger' : 'default'}
          failed={overview.isError}
          onRetry={() => void overview.refetch()}
        />
        <ActionCard
          label="Overdue SLA"
          value={overdueCardValue}
          path={canMonitor ? '/services/monitor?bucket=overdue' : '/services/dispatch?overdue=1'}
          tone={(overdueCardValue ?? 0) > 0 ? 'danger' : 'default'}
          failed={canMonitor ? monitor.isError : overdueList.isError}
          onRetry={() => void (canMonitor ? monitor.refetch() : overdueList.refetch())}
        />
        <ActionCard
          label="Awaiting Review"
          value={queues?.work_completed_count}
          path="/services/dispatch?status=work_completed"
          tone={(queues?.work_completed_count ?? 0) > 0 ? 'warning' : 'default'}
          failed={overview.isError}
          onRetry={() => void overview.refetch()}
        />
      </section>

      <section aria-labelledby="coord-needs-attention" className={cn(panel, 'space-y-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="coord-needs-attention" className="font-display text-lg font-semibold text-ink">
              Needs attention now
            </h2>
          </div>
          <Link to="/services/dispatch">
            <Button type="button" size="sm" variant="outline">
              Open Dispatch Queue
            </Button>
          </Link>
        </div>

        {urgentList.isPending || overdueList.isPending || queueList.isPending ? (
          <p role="status" className="text-sm text-soft">
            Loading priority tickets…
          </p>
        ) : urgentList.isError || overdueList.isError || queueList.isError ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-soft">
            <span>Could not load priority tickets.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void urgentList.refetch()
                void overdueList.refetch()
                void queueList.refetch()
              }}
            >
              Retry
            </Button>
          </div>
        ) : priorityRows.length === 0 ? (
          <EmptyState
            title="Dispatch queue is clear"
            description="No urgent, overdue, unassigned, review-pending, or follow-up tickets right now."
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
        ) : (
          <ul className="divide-y divide-line">
            {priorityRows.map((row) => {
              const step = getCoordinatorNextStep(row)
              const overdue = isServiceRequestOverdue(row)
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ink">{row.internal_code}</span>
                      <ServiceTypeBadge requestType={row.request_type} />
                      <ServicePriorityPill priority={row.priority} />
                      <ServiceStatusPill status={row.status} />
                      <UrgentFlagBadge status={row.highest_urgent_status} count={row.open_urgent_count} />
                      {overdue && (
                        <StatusPill tone="danger" size="sm">
                          Overdue SLA
                        </StatusPill>
                      )}
                    </div>
                    <p className="break-words text-base font-medium text-ink">
                      {row.site_name} ({row.area_label}) · {row.provider_name}
                    </p>
                    <p className="text-sm text-soft">
                      {row.lead_name ? `Lead: ${row.lead_name}` : 'Unassigned'}
                      {row.provider_deadline_at && (
                        <>
                          {' '}
                          · Target: <ServiceTimestamp value={row.provider_deadline_at} />
                        </>
                      )}
                    </p>
                  </div>
                  <Link to={`/services/requests/${row.id}?from=${encodeURIComponent('/dashboard')}`}>
                    <Button type="button" size="sm" variant="secondary">
                      {step.label}
                    </Button>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {canRouterFloat && (floatPendingCount > 0 || floatFaultyCount > 0 || routerFloat.isError) && (
        <section aria-label="CPE Router Float oversight" className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Router className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <div>
                <h2 className="font-display text-sm font-semibold text-ink">Router handover issues</h2>
                {routerFloat.data ? (
                  <p className="text-xs text-soft">
                    Pending pickup:{' '}
                    <strong className="text-ink">{floatPendingCount}</strong> · Faulty pending return:{' '}
                    <strong className={floatFaultyCount > 0 ? 'text-rose' : 'text-ink'}>{floatFaultyCount}</strong>
                  </p>
                ) : routerFloat.isError ? (
                  <p className="text-xs text-soft">Router float summary unavailable right now.</p>
                ) : (
                  <p className="text-xs text-soft">Loading router float summary…</p>
                )}
              </div>
            </div>
            <Link to="/inventory/router-float">
              <Button type="button" size="sm" variant="outline">
                Open Router Float
              </Button>
            </Link>
          </div>
        </section>
      )}

    </div>
  )
}

export function ServiceTechnicianDashboard({
  scope,
  live,
  canMyJobs,
  canAttend = false,
  canWorkVisits,
}: {
  scope: IdentityScopeRef
  live: boolean
  canMyJobs: boolean
  canAttend?: boolean
  canWorkVisits: boolean
}) {
  const shift = useAttendanceTodayContext(live && canAttend)
  const activeJobs = useMyAssignedRequests(6, 0, {
    enabled: live && canMyJobs,
    assignmentScope: 'active',
  })
  const myFloat = useQuery({
    queryKey: ['warehouse', 'my-router-float', scope.identityKey, scope.authEpoch],
    enabled: live && canWorkVisits && scope.isAuthReady && Boolean(scope.identityKey),
    queryFn: ({ signal }) => readMyRouterFloat(scope, signal),
    retry: false,
  })

  const rawRows = activeJobs.data?.rows ?? []
  const actionableRows = rawRows.filter((row) => classifyTechnicianAssignmentBucket(row) === 'active')
  const hasBucketedServerCounts = activeJobs.data?.awaiting_review_count !== undefined
  const activeCount = activeJobs.data
    ? (hasBucketedServerCounts ? activeJobs.data.active_count : actionableRows.length)
    : undefined
  const awaitingReviewCount = activeJobs.data?.awaiting_review_count
    ?? (activeJobs.data
      ? rawRows.filter((row) => classifyTechnicianAssignmentBucket(row) === 'awaiting_review').length
      : undefined)
  const historicalCount = activeJobs.data?.historical_count

  const floatData = myFloat.data
  const pendingCount = floatData?.pending_count ?? 0
  const faultyCount = floatData?.faulty_count ?? 0

  return (
    <div className="space-y-5">
      {canAttend && (
        <section aria-label="Today’s shift" className={cn(panel, 'flex flex-wrap items-center justify-between gap-3')}>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Today’s shift</h2>
            <p className="mt-0.5 text-sm text-soft">
              {shift.isError ? 'Attendance unavailable' : !shift.data ? 'Checking attendance…'
                : !shift.data.enabled ? 'Live clock-ins are paused'
                  : !shift.data.enrolled ? 'Attendance is not set up for your account'
                    : shift.data.day?.clock_out_at ? 'Clocked out at ' + formatTimeInZone(shift.data.day.clock_out_at, shift.data.timezone)
                      : shift.data.day?.clock_in_at ? 'Clocked in at ' + formatTimeInZone(shift.data.day.clock_in_at, shift.data.timezone)
                        : shift.data.is_workday ? 'Ready to clock in' : 'No shift scheduled today'}
            </p>
          </div>
          <Link to="/my/attendance" className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-emerald">My Attendance</Link>
        </section>
      )}
      {pendingCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/50 bg-amber-tint/20 px-4 py-3 text-sm"
        >
          <div className="flex items-center gap-2.5 text-ink">
            <Router className="h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
            <span>
              <strong>{pendingCount}</strong> CPE router(s) awaiting your counter pickup confirmation.
            </span>
          </div>
          <Link to="/services/my-float">
            <Button type="button" size="sm" variant="primary">
              Confirm Pickup
            </Button>
          </Link>
        </div>
      )}

      {faultyCount > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose/40 bg-rose-tint/15 px-4 py-3 text-sm"
        >
          <div className="flex items-center gap-2.5 text-ink">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose" aria-hidden="true" />
            <span>
              <strong>{faultyCount}</strong> faulty CPE router(s) pending return to warehouse (still counted in your
              5-router float).
            </span>
          </div>
          <Link to="/services/my-float">
            <Button type="button" size="sm" variant="outline">
              View My Float
            </Button>
          </Link>
        </div>
      )}

      <section aria-labelledby="tech-active-jobs" className={cn(panel, 'space-y-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="tech-active-jobs" className="font-display text-lg font-semibold text-ink">
              My Active Service Jobs
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/services/my-jobs?section=historical">
              <Button type="button" size="sm" variant="outline">
                Past Jobs{historicalCount !== undefined ? ` (${historicalCount})` : ''}
              </Button>
            </Link>
            <Link to="/services/my-jobs">
              <Button type="button" size="sm" variant="outline">
                Open My Service Jobs
              </Button>
            </Link>
          </div>
        </div>

        {activeJobs.isPending ? (
          <p role="status" className="text-sm text-soft">
            Loading assigned jobs…
          </p>
        ) : activeJobs.isError ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-soft">
            <span>{extractErrorMessage(activeJobs.error)}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void activeJobs.refetch()}>
              Retry
            </Button>
          </div>
        ) : actionableRows.length === 0 ? (
          <EmptyState
            title="No active jobs assigned"
            description="Assigned fiber installation and maintenance tickets appear here automatically."
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
        ) : (
          <ul className="divide-y divide-line">
            {actionableRows.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">{job.internal_code}</span>
                    <ServiceTypeBadge requestType={job.request_type} />
                    <ServicePriorityPill priority={job.priority} />
                    <ServiceStatusPill status={job.status} />
                    {job.my_role && (
                      <StatusPill tone="info" size="sm" withDot={false}>
                        {job.my_role === 'lead' ? 'Lead' : 'Assistant'}
                      </StatusPill>
                    )}
                    {job.open_visit_id && (
                      <StatusPill tone="success" size="sm">
                        Visit in progress
                      </StatusPill>
                    )}
                  </div>
                  <p className="break-words text-base font-medium text-ink">
                    {job.site_name} ({job.area_label}) · {job.provider_name}
                  </p>
                </div>
                <Link to={`/services/requests/${job.id}?from=${encodeURIComponent('/dashboard')}`}>
                  <Button type="button" size="sm" variant="primary">
                    {job.open_visit_id ? 'Continue Visit' : 'Open Job'}
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Technician work overview" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <ActionCard
          label="My Active Jobs"
          value={activeCount}
          hint="Assigned, in-progress, or follow-up jobs"
          path="/services/my-jobs?section=active"
          tone={(activeCount ?? 0) > 0 ? 'success' : 'default'}
          failed={activeJobs.isError}
          onRetry={() => void activeJobs.refetch()}
        />
        <ActionCard
          label="Awaiting Review"
          value={awaitingReviewCount}
          hint="Completed visits awaiting review or sign-off"
          path="/services/my-jobs?section=awaiting_review"
          failed={activeJobs.isError}
          onRetry={() => void activeJobs.refetch()}
        />
        {canWorkVisits && (
          <>
            <ActionCard
              label="Ready to Install"
              value={floatData?.confirmed_count}
              hint="Confirmed CPE routers in your bag"
              path="/services/my-float"
              failed={myFloat.isError}
              onRetry={() => void myFloat.refetch()}
            />
            <ActionCard
              label="Float Used"
              value={floatData ? `${floatData.active_total} / ${floatData.cap}` : undefined}
              hint={
                floatData
                  ? `Pending pickup: ${floatData.pending_count} · Faulty: ${floatData.faulty_count}`
                  : '5-router allowance including pending & faulty'
              }
              path="/services/my-float"
              tone={faultyCount > 0 ? 'danger' : pendingCount > 0 ? 'warning' : 'default'}
              failed={myFloat.isError}
              onRetry={() => void myFloat.refetch()}
            />
          </>
        )}
      </section>
    </div>
  )
}
