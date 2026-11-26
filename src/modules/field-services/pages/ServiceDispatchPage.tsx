import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Search, Users } from 'lucide-react'
import { useAuth } from '@/modules/auth/AuthProvider'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TYPES,
  SERVICE_STATUS_LABELS,
  SERVICE_TYPE_LABELS,
  SERVICE_URGENT_REASON_LABELS,
  isServiceRequestOverdue,
  type CoordinatorUrgentFlagRow,
  type ServiceRequestStatus,
  type ServiceRequestType,
} from '../schemas/services'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  getEffectiveServiceAccess,
  useServiceRequests,
  useServiceUrgentFlags,
  type UrgentFlagQueueStatusFilter,
} from '../api/services'
import { UrgentFlagDialog } from '../components/ServiceModals'
import { UrgentDeliveryStatusPanel } from '../components/UrgentDeliveryStatusPanel'
import {
  PendingServiceOperationsBanner,
  ServicePaginationBar,
  ServicePriorityPill,
  ServiceStatusPill,
  ServiceTimestamp,
  ServiceTypeBadge,
  UrgentFlagBadge,
} from '../components/ServiceBadges'

const DISPATCH_PAGE_SIZE = 25
const URGENT_QUEUE_PAGE_SIZE = 10

export function ServiceDispatchPage() {
  const location = useLocation()
  const auth = useAuth()
  const { hasPermission } = getEffectiveServiceAccess(auth)
  const canReadAlerts = hasPermission('service_alerts.read')
  const canAckUrgent = hasPermission('service_alerts.ack')
  const canResolveUrgent = hasPermission('service_alerts.resolve')
  const canOperateUrgent = canAckUrgent || canResolveUrgent

  const [searchParams, setSearchParams] = useSearchParams()
  const [urgentTab, setUrgentTab] = useState<UrgentFlagQueueStatusFilter>('unresolved')
  const [urgentModal, setUrgentModal] = useState<{
    mode: 'ack' | 'resolve'
    flag: CoordinatorUrgentFlagRow
  } | null>(null)

  const urgentFlagsQuery = useServiceUrgentFlags({
    status: urgentTab,
    limit: URGENT_QUEUE_PAGE_SIZE,
    offset: 0,
    enabled: canReadAlerts,
  })

  const rawType = searchParams.get('type')
  const requestType: ServiceRequestType | null =
    rawType === 'installation' || rawType === 'maintenance' ? rawType : null

  const rawStatus = searchParams.get('status')
  const statusFilter: ServiceRequestStatus | null = SERVICE_REQUEST_STATUSES.includes(
    rawStatus as ServiceRequestStatus,
  )
    ? (rawStatus as ServiceRequestStatus)
    : null

  const urgentOnly = searchParams.get('urgent') === '1'
  const overdueOnly = searchParams.get('overdue') === '1'
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') ?? '')
  const searchQuery = searchParams.get('q') ?? ''

  const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1

  const listQuery = useServiceRequests({
    requestType,
    status: statusFilter,
    urgentOnly,
    overdueOnly,
    search: searchQuery || null,
    limit: DISPATCH_PAGE_SIZE,
    offset: (page - 1) * DISPATCH_PAGE_SIZE,
  })

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    if (key !== 'page') {
      next.delete('page')
    }
    setSearchParams(next, { replace: true })
  }

  const visibleRows = listQuery.data?.rows ?? []
  const totalCount = listQuery.data?.total_count ?? visibleRows.length

  const backTarget = encodeURIComponent(location.pathname + location.search)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dispatch & Operational Queues"
        subtitle="Accept incoming requests, assign or reassign Lead and Assistant crews, review completed work, and track urgent flags."
        actions={
          <Link to="/services">
            <Button type="button" variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Service Overview
            </Button>
          </Link>
        }
      />

      <PendingServiceOperationsBanner />

      {/* Persistent Urgent Alerts & Delivery Inbox (Coordinator / Dispatch Backup) */}
      {canReadAlerts && (
        <section
          aria-labelledby="dispatch-urgent-inbox-heading"
          className="rounded-lg border border-rose/35 bg-surface p-4 shadow-xs space-y-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <h2
                id="dispatch-urgent-inbox-heading"
                className="font-display text-sm font-bold text-ink flex items-center gap-2"
              >
                <AlertTriangle className="h-4 w-4 text-rose" />
                Urgent Alerts &amp; Email Escalation Queue
              </h2>
              <p className="text-xs text-muted">
                Persistent urgent flags across tickets with acknowledgement/resolution tracking and
                email retry recovery.
              </p>
            </div>
            {urgentFlagsQuery.data && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                <span className="rounded border border-rose/40 bg-rose-tint/40 px-2 py-0.5 text-rose">
                  {urgentFlagsQuery.data.open_count} Open
                </span>
                <span className="rounded border border-amber/40 bg-amber-tint/40 px-2 py-0.5 text-ink">
                  {urgentFlagsQuery.data.acknowledged_count} Acknowledged
                </span>
                {urgentFlagsQuery.data.failed_delivery_flags_count > 0 && (
                  <span className="rounded border border-rose/40 bg-rose-tint/30 px-2 py-0.5 text-rose">
                    {urgentFlagsQuery.data.failed_delivery_flags_count} Delivery Issues
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['unresolved', 'Unresolved'],
                ['delivery_failed', 'Email Delivery Issues'],
                ['open', 'Open'],
                ['acknowledged', 'Acknowledged'],
                ['resolved', 'Resolved'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={urgentTab === key ? 'danger' : 'outline'}
                onClick={() => setUrgentTab(key)}
              >
                {label}
              </Button>
            ))}
          </div>

          {urgentFlagsQuery.isLoading ? (
            <Skeleton shape="row" />
          ) : urgentFlagsQuery.isError ? (
            <p className="text-xs font-medium text-rose">
              Could not load urgent alert queue: {urgentFlagsQuery.error.message}
            </p>
          ) : (urgentFlagsQuery.data?.rows ?? []).length === 0 ? (
            <p className="rounded-md border border-line bg-canvas px-3 py-2.5 text-xs text-muted">
              No urgent alerts matching this filter.
            </p>
          ) : (
            <div className="space-y-2.5">
              {(urgentFlagsQuery.data?.rows ?? []).map((flag) => (
                <div
                  key={flag.id}
                  className="rounded-md border border-line bg-surface p-3.5 space-y-2"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/services/requests/${flag.service_request_id}?urgent=${flag.id}&from=${backTarget}`}
                          className="font-mono text-xs font-bold text-emerald hover:underline"
                        >
                          {flag.internal_code}
                        </Link>
                        <UrgentFlagBadge status={flag.status} />
                        <span className="text-xs font-semibold text-ink">
                          {SERVICE_URGENT_REASON_LABELS[flag.reason_code]}
                        </span>
                        <span className="text-xs text-muted">
                          {flag.site_name} ({flag.area_label})
                        </span>
                      </div>
                      <p className="text-xs text-ink">{flag.summary}</p>
                      <p className="text-[11px] text-muted">
                        Raised by {flag.reported_by_name} · <ServiceTimestamp value={flag.reported_at} />
                        {flag.acknowledged_at && (
                          <>
                            {' '}
                            · Acked{flag.acknowledged_by_name ? ` by ${flag.acknowledged_by_name}` : ''}
                          </>
                        )}
                        {flag.resolved_at && (
                          <>
                            {' '}
                            · Resolved{flag.resolved_by_name ? ` by ${flag.resolved_by_name}` : ''}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <Link
                        to={`/services/requests/${flag.service_request_id}?urgent=${flag.id}&from=${backTarget}`}
                      >
                        <Button type="button" size="sm" variant="outline">
                          Inspect Ticket
                        </Button>
                      </Link>
                      {flag.status === 'open' && canAckUrgent && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setUrgentModal({ mode: 'ack', flag })}
                        >
                          Acknowledge
                        </Button>
                      )}
                      {flag.status !== 'resolved' && canResolveUrgent && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setUrgentModal({ mode: 'resolve', flag })}
                        >
                          Resolve Flag
                        </Button>
                      )}
                    </div>
                  </div>

                  <UrgentDeliveryStatusPanel
                    flagId={flag.id}
                    deliverySummary={flag.delivery_summary}
                    deliveries={flag.deliveries}
                    canOperate={canOperateUrgent}
                    compact
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                updateParam('q', searchDraft.trim() || null)
              }}
            >
              <Input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Search code, provider ref, site, area..."
                leftIcon={<Search className="h-4 w-4" />}
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
          </div>
          <Select
            value={requestType ?? ''}
            onValueChange={(v) => updateParam('type', v || null)}
            options={[
              { value: '', label: 'All Categories' },
              ...SERVICE_REQUEST_TYPES.map((t) => ({
                value: t,
                label: SERVICE_TYPE_LABELS[t],
              })),
            ]}
          />
          <Select
            value={statusFilter ?? ''}
            onValueChange={(v) => updateParam('status', v || null)}
            options={[
              { value: '', label: 'All Statuses' },
              ...SERVICE_REQUEST_STATUSES.map((s) => ({
                value: s,
                label: SERVICE_STATUS_LABELS[s],
              })),
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant={!statusFilter && !urgentOnly && !overdueOnly ? 'primary' : 'outline'}
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('status')
              next.delete('urgent')
              next.delete('overdue')
              next.delete('page')
              setSearchParams(next, { replace: true })
            }}
          >
            All Tickets
          </Button>
          <Button
            type="button"
            size="sm"
            variant={statusFilter === 'submitted' ? 'primary' : 'outline'}
            onClick={() => updateParam('status', statusFilter === 'submitted' ? null : 'submitted')}
          >
            Awaiting Assignment
          </Button>
          <Button
            type="button"
            size="sm"
            variant={statusFilter === 'follow_up_required' ? 'primary' : 'outline'}
            onClick={() =>
              updateParam(
                'status',
                statusFilter === 'follow_up_required' ? null : 'follow_up_required',
              )
            }
          >
            Follow-Up / Rework
          </Button>
          <Button
            type="button"
            size="sm"
            variant={statusFilter === 'work_completed' ? 'primary' : 'outline'}
            onClick={() =>
              updateParam('status', statusFilter === 'work_completed' ? null : 'work_completed')
            }
          >
            Needs Review
          </Button>
          <Button
            type="button"
            size="sm"
            variant={urgentOnly ? 'danger' : 'outline'}
            onClick={() => updateParam('urgent', urgentOnly ? null : '1')}
          >
            Open Urgent Flags
          </Button>
          <Button
            type="button"
            size="sm"
            variant={overdueOnly ? 'danger' : 'outline'}
            onClick={() => updateParam('overdue', overdueOnly ? null : '1')}
          >
            Overdue SLA
          </Button>
        </div>
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton shape="row" />
          <Skeleton shape="row" />
          <Skeleton shape="row" />
        </div>
      ) : listQuery.isError ? (
        <EmptyState
          title="Could not load dispatch queue"
          description={listQuery.error.message}
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          title="No matching service requests"
          description="Try clearing search text or switching queue filters."
        />
      ) : (
        <div className="space-y-2.5">
          {visibleRows.map((row) => (
            <Link
              key={row.id}
              to={`/services/requests/${row.id}?from=${backTarget}`}
              className="block rounded-lg border border-line bg-surface p-4 shadow-xs transition-colors hover:border-emerald"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">
                      {row.internal_code}
                    </span>
                    <ServiceTypeBadge requestType={row.request_type} />
                    <ServicePriorityPill priority={row.priority} />
                    <ServiceStatusPill status={row.status} />
                    <UrgentFlagBadge
                      status={row.highest_urgent_status}
                      count={row.open_urgent_count || undefined}
                    />
                    {isServiceRequestOverdue(row) && (
                      <StatusPill tone="danger" size="sm">
                        Overdue SLA
                      </StatusPill>
                    )}
                  </div>
                  <p className="text-sm font-medium text-ink">
                    {row.site_name}{' '}
                    <span className="text-soft font-normal">({row.area_label})</span>
                  </p>
                  <p className="text-xs text-muted flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      {row.provider_name} · Ref {row.provider_reference}
                    </span>
                    {row.lead_name ? (
                      <span className="inline-flex items-center gap-1 text-soft">
                        <Users className="h-3.5 w-3.5" />
                        Lead: {row.lead_name}
                        {row.assistant_count > 0 ? ` (+${row.assistant_count} asst)` : ''}
                      </span>
                    ) : (
                      <span>No crew assigned yet</span>
                    )}
                    {row.provider_deadline_at && (
                      <span>
                        Target: <ServiceTimestamp value={row.provider_deadline_at} />
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-xs font-semibold text-emerald-600 shrink-0">
                  Open Ticket →
                </span>
              </div>
            </Link>
          ))}
          <ServicePaginationBar
            page={page}
            pageSize={DISPATCH_PAGE_SIZE}
            totalCount={totalCount}
            onPageChange={(nextPage) =>
              updateParam('page', nextPage <= 1 ? null : String(nextPage))
            }
            label="Dispatch queue pagination"
          />
        </div>
      )}
      {urgentModal && (
        <UrgentFlagDialog
          open={Boolean(urgentModal)}
          onOpenChange={(open) => {
            if (!open) setUrgentModal(null)
          }}
          mode={urgentModal.mode}
          serviceRequestId={urgentModal.flag.service_request_id}
          flag={urgentModal.flag}
        />
      )}
    </div>
  )
}
