import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react'
import { isMonitorOnlyAccount } from '@/config/navigation'
import { useAuth } from '@/modules/auth/AuthProvider'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import {
  SERVICE_MONITOR_BUCKETS,
  SERVICE_URGENT_REASON_LABELS,
  type ServiceMonitorBucket,
} from '../schemas/services'
import {
  getEffectiveServiceAccess,
  useServiceMonitorQueue,
  useServiceMonitorSnapshot,
} from '../api/services'
import { extractErrorMessage } from '../lib/pendingOperations'
import {
  ServicePaginationBar,
  ServicePriorityPill,
  ServiceStatusPill,
  ServiceTimestamp,
  ServiceTypeBadge,
  UrgentFlagBadge,
} from '../components/ServiceBadges'

const MONITOR_PAGE_SIZE = 25
const STALE_THRESHOLD_MS = 90_000

const BUCKET_META: Record<
  ServiceMonitorBucket,
  { label: string; description: string }
> = {
  all: { label: 'All Active Queue', description: 'Open operational tickets excluding drafts & closed' },
  unassigned: { label: 'Unassigned', description: 'Submitted tickets awaiting dispatch' },
  ongoing: { label: 'Assigned / In Progress', description: 'Crew dispatched or actively on site' },
  follow_up: { label: 'Follow-Up Required', description: 'Requires revisit, parts, or coordinator action' },
  review: { label: 'Awaiting Review', description: 'Field work finished; coordinator verification pending' },
  urgent: { label: 'Open Urgent Alerts', description: 'Tickets with unacknowledged safety/service alerts' },
  overdue: { label: 'Overdue SLA', description: 'Past provider target deadline and still open' },
  acknowledged: { label: 'Acknowledged Urgent Alerts', description: 'Urgent alerts acknowledged and under active watch' },
}

function formatMonitorClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toLocaleTimeString('en-UG', {
    timeZone: 'Africa/Kampala',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export interface FeedFreshnessState {
  hasData: boolean
  displayMs: number
  isStale: boolean
  isDisconnected: boolean
  isBackgroundSyncFailed: boolean
  isFetching: boolean
}

export function evaluateFeedFreshness({
  hasData,
  generatedAt,
  dataUpdatedAt,
  isError,
  isFetching,
  nowMs,
}: {
  hasData: boolean
  generatedAt?: string | null
  dataUpdatedAt?: number
  isError: boolean
  isFetching: boolean
  nowMs: number
}): FeedFreshnessState {
  const serverMs = generatedAt ? Date.parse(generatedAt) || 0 : 0
  const fetchMs = dataUpdatedAt && dataUpdatedAt > 0 ? dataUpdatedAt : 0
  const validCandidates = [serverMs, fetchMs].filter((t) => t > 0)
  // Using Math.min guarantees an old cached/pending section keeps its real older timestamp
  const displayMs = hasData && validCandidates.length > 0 ? Math.min(...validCandidates) : 0
  const serverAgeMs = hasData && serverMs > 0 ? Math.max(0, nowMs - serverMs) : 0
  const fetchAgeMs = hasData && fetchMs > 0 ? Math.max(0, nowMs - fetchMs) : 0
  const isDisconnected = !hasData && isError
  const isBackgroundSyncFailed = hasData && isError
  const isStale =
    hasData &&
    (serverAgeMs > STALE_THRESHOLD_MS || fetchAgeMs > STALE_THRESHOLD_MS || isBackgroundSyncFailed)

  return {
    hasData,
    displayMs,
    isStale,
    isDisconnected,
    isBackgroundSyncFailed,
    isFetching,
  }
}

export function ServiceMonitorPage() {
  const location = useLocation()
  const auth = useAuth()
  const { roleKeys, hasPermission } = getEffectiveServiceAccess(auth)
  const isMonitorOnly = isMonitorOnlyAccount(roleKeys)
  const canOpenTicketDetail = hasPermission('service_requests.read') && !isMonitorOnly

  const [searchParams, setSearchParams] = useSearchParams()
  const rawBucket = searchParams.get('bucket')
  const bucket: ServiceMonitorBucket = SERVICE_MONITOR_BUCKETS.includes(
    rawBucket as ServiceMonitorBucket,
  )
    ? (rawBucket as ServiceMonitorBucket)
    : 'all'

  const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  const snapshotQuery = useServiceMonitorSnapshot()
  const queueQuery = useServiceMonitorQueue({
    bucket,
    limit: MONITOR_PAGE_SIZE,
    offset: (page - 1) * MONITOR_PAGE_SIZE,
  })

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now())
    }, 15_000)
    return () => window.clearInterval(id)
  }, [])

  const snapshot = snapshotQuery.data
  const queue = queueQuery.data
  const hasSnapshot = Boolean(snapshot)
  const hasQueue = Boolean(queue)

  const snapshotFeed = evaluateFeedFreshness({
    hasData: hasSnapshot,
    generatedAt: snapshot?.generated_at,
    dataUpdatedAt: snapshotQuery.dataUpdatedAt,
    isError: snapshotQuery.isError,
    isFetching: snapshotQuery.isFetching,
    nowMs,
  })
  const queueFeed = evaluateFeedFreshness({
    hasData: hasQueue,
    generatedAt: queue?.generated_at,
    dataUpdatedAt: queueQuery.dataUpdatedAt,
    isError: queueQuery.isError,
    isFetching: queueQuery.isFetching,
    nowMs,
  })

  const bothHaveData = snapshotFeed.hasData && queueFeed.hasData
  const loadedTimestamps = [snapshotFeed.displayMs, queueFeed.displayMs].filter((t) => t > 0)
  const oldestDisplayedMs = loadedTimestamps.length > 0 ? Math.min(...loadedTimestamps) : 0

  const isAnyStale = snapshotFeed.isStale || queueFeed.isStale
  const isAnyBgSyncFailed = snapshotFeed.isBackgroundSyncFailed || queueFeed.isBackgroundSyncFailed
  const isFullDisconnect = snapshotFeed.isDisconnected && queueFeed.isDisconnected
  const isPartialDisconnect =
    !isFullDisconnect && (snapshotFeed.isDisconnected || queueFeed.isDisconnected)

  const staleLabels: string[] = []
  if (snapshotFeed.isStale) staleLabels.push('summary counts')
  if (queueFeed.isStale) staleLabels.push('operational queue')

  const selectBucket = (nextBucket: ServiceMonitorBucket) => {
    const next = new URLSearchParams(searchParams)
    if (nextBucket === 'all') {
      next.delete('bucket')
    } else {
      next.set('bucket', nextBucket)
    }
    next.delete('page')
    setSearchParams(next, { replace: true })
  }

  const updatePage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) {
      next.delete('page')
    } else {
      next.set('page', String(nextPage))
    }
    setSearchParams(next, { replace: true })
  }

  const refreshBoth = () => {
    void Promise.all([snapshotQuery.refetch(), queueQuery.refetch()])
  }

  const ongoingCount = snapshot ? snapshot.assigned_count + snapshot.in_progress_count : null
  const activeTotalCount = snapshot
    ? snapshot.unassigned_count +
      snapshot.assigned_count +
      snapshot.in_progress_count +
      snapshot.follow_up_count +
      snapshot.review_pending_count +
      snapshot.reported_pending_confirm_count
    : null

  const kpiBuckets: Array<{
    key: ServiceMonitorBucket
    label: string
    value: number | null
    accent: string
  }> = [
    { key: 'urgent', label: 'Open Urgent Flags', value: snapshot?.open_urgent_flags_count ?? null, accent: 'text-rose' },
    { key: 'acknowledged', label: 'Acknowledged Urgent Alerts', value: snapshot?.acknowledged_urgent_flags_count ?? null, accent: 'text-amber' },
    { key: 'unassigned', label: 'Unassigned', value: snapshot?.unassigned_count ?? null, accent: 'text-ink' },
    { key: 'ongoing', label: 'Assigned / In Progress', value: ongoingCount, accent: 'text-emerald-600' },
    { key: 'follow_up', label: 'Follow-Up Required', value: snapshot?.follow_up_count ?? null, accent: 'text-amber' },
    { key: 'review', label: 'Coordinator Review Pending', value: snapshot?.review_pending_count ?? null, accent: 'text-ink' },
    { key: 'overdue', label: 'Overdue SLA', value: snapshot?.overdue_count ?? null, accent: 'text-rose' },
    { key: 'all', label: 'All Active Queue', value: activeTotalCount, accent: 'text-ink' },
  ]

  const rows = queue?.rows ?? []
  const totalCount = queue?.total_count ?? rows.length
  const backTarget = encodeURIComponent(location.pathname + location.search)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations Monitor"
        subtitle="Live 30-second operational queue status. Display-safe telemetry only — customer PII and notes are excluded."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                isAnyStale || isFullDisconnect || isPartialDisconnect
                  ? 'border-amber/50 bg-amber-tint/30 text-ink'
                  : 'border-line bg-canvas text-soft',
              )}
              data-testid="monitor-freshness"
            >
              <Clock className="h-3.5 w-3.5 text-muted" />
              {bothHaveData
                ? isAnyStale
                  ? `Oldest feed: ${formatMonitorClock(oldestDisplayedMs)}`
                  : `Last updated: ${formatMonitorClock(oldestDisplayedMs)}`
                : oldestDisplayedMs > 0
                  ? `Partial update: ${formatMonitorClock(oldestDisplayedMs)}`
                  : 'Last updated: —'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={snapshotQuery.isFetching || queueQuery.isFetching}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={refreshBoth}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Display-Safe Boundary Notice */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-4 py-2.5 text-xs text-soft">
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <ShieldCheck className="h-4 w-4 text-emerald shrink-0" />
          Display-Safe Monitor View
        </span>
        <span>
          Customer names, phone numbers, street addresses, access instructions, provider references,
          and internal notes are never exposed on monitor screens.
          {snapshot && (
            <>
              {' '}
              · Reported / Awaiting Confirm:{' '}
              <strong className="font-mono text-ink">
                {snapshot.reported_pending_confirm_count}
              </strong>
            </>
          )}
        </span>
      </div>

      {/* Disconnected / Stale Warnings (never mask disconnects or single-feed staleness) */}
      {(isFullDisconnect || isPartialDisconnect) && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-rose/50 bg-rose-tint/25 p-4 text-sm text-rose sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5">
            <WifiOff className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                {isFullDisconnect
                  ? 'Disconnected — Monitor feed unavailable'
                  : snapshotFeed.isDisconnected
                    ? 'Partial disconnect — Summary KPI feed unavailable'
                    : 'Partial disconnect — Operational queue feed unavailable'}
              </p>
              <p className="text-xs text-ink mt-0.5">
                {extractErrorMessage(snapshotQuery.error ?? queueQuery.error)}
              </p>
            </div>
          </div>
          <Button type="button" size="sm" variant="danger" onClick={refreshBoth}>
            Retry Connection
          </Button>
        </div>
      )}

      {isAnyStale && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-amber/50 bg-amber-tint/35 p-4 text-xs sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5 text-ink">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber mt-0.5" />
            <div>
              <p className="font-semibold">
                {isAnyBgSyncFailed
                  ? `Stale data warning — live refresh failed on ${staleLabels.join(' & ')}; showing cached feed`
                  : `Stale data warning — ${staleLabels.join(' & ')} over 90 seconds old`}
              </p>
              <p className="text-soft mt-0.5">
                Summary updated: {snapshotFeed.displayMs > 0 ? formatMonitorClock(snapshotFeed.displayMs) : '—'}
                {' · '}
                Queue updated: {queueFeed.displayMs > 0 ? formatMonitorClock(queueFeed.displayMs) : '—'}
              </p>
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={refreshBoth}>
            Sync Now
          </Button>
        </div>
      )}

      {/* Per-Section KPI Summary Header & Grid */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="font-semibold uppercase tracking-wide">Queue Summary Counts</span>
          <span
            data-testid="monitor-snapshot-freshness"
            className="inline-flex items-center gap-1.5"
          >
            Summary updated:{' '}
            <span className="font-mono text-ink">
              {snapshotFeed.displayMs > 0 ? formatMonitorClock(snapshotFeed.displayMs) : '—'}
            </span>
            {snapshotFeed.isStale && (
              <span className="rounded bg-amber-tint px-1.5 py-0.5 text-[10px] font-semibold text-ink border border-amber/40">
                Stale (&gt;90s)
              </span>
            )}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpiBuckets.map((card) => {
            const isSelected = bucket === card.key
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => selectBucket(card.key)}
                aria-pressed={isSelected}
                className={cn(
                  'rounded-lg border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald',
                  isSelected
                    ? 'border-emerald bg-emerald-tint/20 shadow-xs'
                    : 'border-line bg-surface hover:border-emerald/60',
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {card.label}
                </p>
                <p className={cn('mt-1 font-display text-2xl font-bold tabular-nums', card.accent)}>
                  {snapshotQuery.isLoading && !hasSnapshot
                    ? '…'
                    : card.value !== null
                      ? card.value
                      : '—'}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Queue Drill-Down Section */}
      <section className="rounded-lg border border-line bg-surface shadow-xs overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="monitor-queue-heading"
              className="font-display text-sm font-bold text-ink flex items-center gap-2"
            >
              <Activity className="h-4 w-4 text-emerald" />
              {BUCKET_META[bucket].label}
              <span className="rounded bg-canvas px-2 py-0.5 font-mono text-xs text-soft border border-line">
                {queueQuery.isError && !queue ? '—' : totalCount}
              </span>
            </h2>
            <p className="text-xs text-muted mt-0.5">{BUCKET_META[bucket].description}</p>
          </div>
          <span
            data-testid="monitor-queue-freshness"
            className="inline-flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted"
          >
            Queue updated:{' '}
            <span className="font-mono text-ink">
              {queueFeed.displayMs > 0 ? formatMonitorClock(queueFeed.displayMs) : '—'}
            </span>
            {queueFeed.isStale && (
              <span className="rounded bg-amber-tint px-1.5 py-0.5 text-[10px] font-semibold text-ink border border-amber/40">
                Stale (&gt;90s)
              </span>
            )}
            <span>· 30s auto-refresh</span>
          </span>
        </div>

        {queueQuery.isLoading && !queue ? (
          <div className="p-4 space-y-3">
            <Skeleton shape="row" />
            <Skeleton shape="row" />
            <Skeleton shape="row" />
          </div>
        ) : queueQuery.isError && !queue ? (
          <div className="p-6">
            <EmptyState
              title="Queue data disconnected"
              description={extractErrorMessage(queueQuery.error)}
              action={
                <Button type="button" size="sm" variant="outline" onClick={refreshBoth}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<CheckCircle2 className="h-6 w-6" />}
              title="No tickets in this bucket"
              description={`No active operational tickets currently match "${BUCKET_META[bucket].label}".`}
            />
          </div>
        ) : (
          <>
            {/* Desktop Semantic Table */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="monitor-queue-heading"
              className="hidden md:block overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-line bg-canvas text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Ticket</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Area</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Type &amp; Priority</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status &amp; Alerts</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Lead</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Submitted</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Target SLA</th>
                    {canOpenTicketDetail && (
                      <th scope="col" className="px-4 py-2.5 font-semibold text-right">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => {
                    const isOverdue =
                      row.provider_deadline_at != null &&
                      Date.parse(row.provider_deadline_at) < nowMs &&
                      !['provider_confirmed', 'cancelled'].includes(row.status)
                    return (
                      <tr key={row.id} className="hover:bg-canvas/60">
                        <th scope="row" className="px-4 py-3 font-mono font-semibold text-ink whitespace-nowrap">
                          {row.internal_code}
                        </th>
                        <td className="px-4 py-3 text-ink max-w-[14rem] truncate">
                          {row.area_label}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <ServiceTypeBadge requestType={row.request_type} />
                            <ServicePriorityPill priority={row.priority} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <ServiceStatusPill status={row.status} />
                            <UrgentFlagBadge
                              status={row.highest_urgent_status}
                              count={row.open_urgent_count || undefined}
                            />
                            {row.urgent_reason_code && row.highest_urgent_status !== 'none' && (
                              <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-soft border border-line">
                                {SERVICE_URGENT_REASON_LABELS[row.urgent_reason_code]}
                              </span>
                            )}
                            {row.has_blocker && (
                              <span className="rounded bg-rose-tint/50 px-1.5 py-0.5 text-[10px] font-semibold text-rose">
                                Blocker
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-soft whitespace-nowrap">
                          {row.assigned_lead_name || 'Unassigned'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <ServiceTimestamp value={row.submitted_at} fallback="Pending" />
                        </td>
                        <td className={cn('px-4 py-3 whitespace-nowrap', isOverdue && 'text-rose font-semibold')}>
                          <ServiceTimestamp value={row.provider_deadline_at} fallback="None" />
                        </td>
                        {canOpenTicketDetail && (
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <Link
                              to={`/services/requests/${row.id}?from=${backTarget}`}
                              className="inline-flex items-center gap-1 font-semibold text-emerald hover:underline"
                            >
                              Open
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Stack */}
            <div className="md:hidden divide-y divide-line">
              {rows.map((row) => {
                const isOverdue =
                  row.provider_deadline_at != null &&
                  Date.parse(row.provider_deadline_at) < nowMs &&
                  !['provider_confirmed', 'cancelled'].includes(row.status)
                return (
                  <div key={row.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-ink">
                        {row.internal_code}
                      </span>
                      <ServiceStatusPill status={row.status} />
                    </div>
                    <p className="text-xs font-medium text-ink">{row.area_label}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ServiceTypeBadge requestType={row.request_type} />
                      <ServicePriorityPill priority={row.priority} />
                      <UrgentFlagBadge
                        status={row.highest_urgent_status}
                        count={row.open_urgent_count || undefined}
                      />
                      {row.urgent_reason_code && row.highest_urgent_status !== 'none' && (
                        <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-soft border border-line">
                          {SERVICE_URGENT_REASON_LABELS[row.urgent_reason_code]}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted pt-1">
                      <span>Lead: {row.assigned_lead_name || 'Unassigned'}</span>
                      <span className={cn(isOverdue && 'text-rose font-semibold')}>
                        SLA: <ServiceTimestamp value={row.provider_deadline_at} fallback="None" />
                      </span>
                    </div>
                    {canOpenTicketDetail && (
                      <div className="pt-1">
                        <Link
                          to={`/services/requests/${row.id}?from=${backTarget}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-emerald hover:underline"
                        >
                          Open Ticket Detail
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="border-t border-line px-4 py-3">
              <ServicePaginationBar
                page={page}
                pageSize={MONITOR_PAGE_SIZE}
                totalCount={totalCount}
                onPageChange={updatePage}
                label="Operations monitor queue pagination"
              />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
