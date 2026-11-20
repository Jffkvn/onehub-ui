import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Clock, PlayCircle } from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useMyAssignedRequests } from '../api/services'
import {
  PendingServiceOperationsBanner,
  ServicePaginationBar,
  ServicePriorityPill,
  ServiceStatusPill,
  ServiceTimestamp,
  ServiceTypeBadge,
} from '../components/ServiceBadges'

const MY_JOBS_PAGE_SIZE = 25

function parsePageParam(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function MyServiceJobsPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const activePage = parsePageParam(searchParams.get('activePage'))
  const pastPage = parsePageParam(searchParams.get('pastPage'))

  const activeQuery = useMyAssignedRequests(
    MY_JOBS_PAGE_SIZE,
    (activePage - 1) * MY_JOBS_PAGE_SIZE,
    { assignmentScope: 'active' },
  )
  const pastQuery = useMyAssignedRequests(
    MY_JOBS_PAGE_SIZE,
    (pastPage - 1) * MY_JOBS_PAGE_SIZE,
    { assignmentScope: 'historical' },
  )

  const activeRows = (activeQuery.data?.rows ?? []).filter((r) => r.is_active_assignment)
  const pastRows = (pastQuery.data?.rows ?? []).filter((r) => !r.is_active_assignment)
  const activeTotal = activeQuery.data?.active_count ?? activeQuery.data?.total_count ?? activeRows.length
  const pastTotal = pastQuery.data?.historical_count ?? pastQuery.data?.total_count ?? pastRows.length

  const updatePage = (key: 'activePage' | 'pastPage', nextPage: number) => {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) {
      next.delete(key)
    } else {
      next.set(key, String(nextPage))
    }
    setSearchParams(next, { replace: true })
  }

  const fromTarget = encodeURIComponent(location.pathname + location.search)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Service Jobs"
        subtitle="Your active customer visits and read-only record of past jobs you worked on."
      />

      <PendingServiceOperationsBanner intentPrefix="service:visit:" />

      {activeQuery.isLoading && pastQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton shape="card" className="h-28" />
          <Skeleton shape="card" className="h-28" />
        </div>
      ) : activeQuery.isError && pastQuery.isError ? (
        <EmptyState title="Could not load assigned jobs" description={activeQuery.error.message} />
      ) : !activeQuery.isError && !pastQuery.isError && activeTotal === 0 && pastTotal === 0 ? (
        <EmptyState
          title="No service jobs assigned"
          description="Requests assigned to you by Dispatch coordinators will appear here."
        />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
              Active Crew Assignments ({activeTotal})
            </h2>
            {activeQuery.isError ? (
              <EmptyState
                title="Could not load active assignments"
                description={activeQuery.error.message}
              />
            ) : activeRows.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-4 text-xs text-muted">
                {activePage > 1
                  ? 'No active crew assignments on this page.'
                  : 'You have no active crew assignments right now.'}
              </p>
            ) : (
              <div className="space-y-3">
                {activeRows.map((row) => (
                  <Link
                    key={row.id}
                    to={`/services/requests/${row.id}?from=${fromTarget}`}
                    className="block rounded-lg border border-line bg-surface p-4 shadow-xs transition-colors hover:border-emerald"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-ink">
                            {row.internal_code}
                          </span>
                          <ServiceTypeBadge requestType={row.request_type} />
                          <ServicePriorityPill priority={row.priority} />
                          <ServiceStatusPill status={row.status} />
                        </div>
                        <span className="rounded bg-canvas px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink border border-line">
                          {row.my_role === 'lead' ? 'Lead Engineer' : 'Assistant'}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-ink">
                        {row.site_name}{' '}
                        <span className="font-normal text-soft">({row.area_label})</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                        <span>{row.provider_name}</span>
                        {row.provider_deadline_at && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Target: <ServiceTimestamp value={row.provider_deadline_at} />
                          </span>
                        )}
                        {row.open_visit_id && (
                          <span className="inline-flex items-center gap-1 font-medium text-blue">
                            <PlayCircle className="h-3.5 w-3.5" />
                            Visit in progress
                          </span>
                        )}
                        {row.open_urgent_count > 0 && (
                          <span className="inline-flex items-center gap-1 font-medium text-rose">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {row.open_urgent_count} urgent flag(s)
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <ServicePaginationBar
              page={activePage}
              pageSize={MY_JOBS_PAGE_SIZE}
              totalCount={activeTotal}
              onPageChange={(nextPage) => updatePage('activePage', nextPage)}
              label="Active crew assignments pagination"
            />
          </section>

          {(pastTotal > 0 || pastQuery.isError || pastPage > 1) && (
            <section className="space-y-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
                Past / Historical Participation ({pastTotal})
              </h2>
              {pastQuery.isError ? (
                <EmptyState
                  title="Could not load past participation records"
                  description={pastQuery.error.message}
                />
              ) : pastRows.length === 0 ? (
                <p className="rounded-lg border border-line bg-surface p-4 text-xs text-muted">
                  No past participation records on this page.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {pastRows.map((row) => (
                    <Link
                      key={row.id}
                      to={`/services/requests/${row.id}?from=${fromTarget}`}
                      className="block rounded-lg border border-line bg-canvas p-4 transition-colors hover:border-line/80"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-soft">
                              {row.internal_code}
                            </span>
                            <ServiceTypeBadge requestType={row.request_type} />
                            <ServiceStatusPill status={row.status} />
                          </div>
                          <p className="text-sm font-medium text-soft">
                            {row.site_name} ({row.area_label}) — {row.provider_name}
                          </p>
                        </div>
                        <span className="text-xs text-muted">Read-Only Record →</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <ServicePaginationBar
                page={pastPage}
                pageSize={MY_JOBS_PAGE_SIZE}
                totalCount={pastTotal}
                onPageChange={(nextPage) => updatePage('pastPage', nextPage)}
                label="Past participation pagination"
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}
