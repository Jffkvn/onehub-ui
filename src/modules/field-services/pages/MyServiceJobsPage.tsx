import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Clock, PlayCircle } from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useMyAssignedRequests } from '../api/services'
import { classifyTechnicianAssignmentBucket } from '../schemas/services'
import {
  PendingServiceOperationsBanner,
  ServicePaginationBar,
  ServicePriorityPill,
  ServiceStatusPill,
  ServiceTimestamp,
  ServiceTypeBadge,
} from '../components/ServiceBadges'

const MY_JOBS_PAGE_SIZE = 25
type MyJobsSection = 'all' | 'active' | 'awaiting_review' | 'historical'

function parsePageParam(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function parseSectionParam(raw: string | null): MyJobsSection {
  if (raw === 'active' || raw === 'awaiting_review' || raw === 'historical') {
    return raw
  }
  return 'all'
}

export function MyServiceJobsPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionFilter = parseSectionParam(searchParams.get('section'))
  const activePage = parsePageParam(searchParams.get('activePage'))
  const reviewPage = parsePageParam(searchParams.get('reviewPage'))
  const pastPage = parsePageParam(searchParams.get('pastPage'))

  const activeQuery = useMyAssignedRequests(
    MY_JOBS_PAGE_SIZE,
    (activePage - 1) * MY_JOBS_PAGE_SIZE,
    { assignmentScope: 'active' },
  )
  const reviewQuery = useMyAssignedRequests(
    MY_JOBS_PAGE_SIZE,
    (reviewPage - 1) * MY_JOBS_PAGE_SIZE,
    { assignmentScope: 'awaiting_review' },
  )
  const pastQuery = useMyAssignedRequests(
    MY_JOBS_PAGE_SIZE,
    (pastPage - 1) * MY_JOBS_PAGE_SIZE,
    { assignmentScope: 'historical' },
  )

  const rawActiveRows = activeQuery.data?.rows ?? []
  const rawReviewRows = reviewQuery.data?.rows ?? []
  const rawPastRows = pastQuery.data?.rows ?? []

  // Defensively ensure closed/review tickets never show in Active even under stale caches or legacy payloads.
  const activeRows = rawActiveRows.filter((r) => classifyTechnicianAssignmentBucket(r) === 'active')
  const reviewRows = [
    ...rawReviewRows.filter((r) => classifyTechnicianAssignmentBucket(r) === 'awaiting_review'),
    ...rawActiveRows.filter((r) => classifyTechnicianAssignmentBucket(r) === 'awaiting_review'),
  ]
  const pastSeen = new Set<string>()
  const pastRows = [
    ...rawPastRows.filter((r) => classifyTechnicianAssignmentBucket(r) === 'historical'),
    ...rawActiveRows.filter((r) => classifyTechnicianAssignmentBucket(r) === 'historical'),
  ].filter((row) => {
    if (pastSeen.has(row.id)) return false
    pastSeen.add(row.id)
    return true
  })

  const hasBucketedServerCounts = activeQuery.data?.awaiting_review_count !== undefined
  const activeTotal = hasBucketedServerCounts
    ? (activeQuery.data?.active_count ?? activeRows.length)
    : activeRows.length
  const reviewTotal = reviewQuery.data?.awaiting_review_count ?? activeQuery.data?.awaiting_review_count ?? reviewRows.length
  const pastTotal = hasBucketedServerCounts
    ? (pastQuery.data?.historical_count ?? activeQuery.data?.historical_count ?? pastRows.length)
    : Math.max(pastQuery.data?.historical_count ?? 0, pastRows.length)

  const updatePage = (key: 'activePage' | 'reviewPage' | 'pastPage', nextPage: number) => {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) {
      next.delete(key)
    } else {
      next.set(key, String(nextPage))
    }
    setSearchParams(next, { replace: true })
  }

  const updateSection = (nextSection: MyJobsSection) => {
    const next = new URLSearchParams(searchParams)
    if (nextSection === 'all') {
      next.delete('section')
    } else {
      next.set('section', nextSection)
    }
    setSearchParams(next, { replace: true })
  }

  const fromTarget = encodeURIComponent(location.pathname + location.search)
  const showActive = sectionFilter === 'all' || sectionFilter === 'active'
  const showReview = sectionFilter === 'all' || sectionFilter === 'awaiting_review'
  const showPast = sectionFilter === 'all' || sectionFilter === 'historical'

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Service Jobs"
        subtitle="Your active customer visits, completed work awaiting review, and past jobs."
      />

      <PendingServiceOperationsBanner intentPrefix="service:visit:" />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter assigned jobs">
        {(
          [
            ['all', 'All Jobs'],
            ['active', `Active (${activeTotal})`],
            ['awaiting_review', `Awaiting Review (${reviewTotal})`],
            ['historical', `Past Jobs (${pastTotal})`],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={sectionFilter === key ? 'primary' : 'outline'}
            onClick={() => updateSection(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {activeQuery.isLoading && reviewQuery.isLoading && pastQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton shape="card" className="h-28" />
          <Skeleton shape="card" className="h-28" />
        </div>
      ) : activeQuery.isError && reviewQuery.isError && pastQuery.isError ? (
        <EmptyState title="Could not load assigned jobs" description={activeQuery.error.message} />
      ) : !activeQuery.isError &&
        !reviewQuery.isError &&
        !pastQuery.isError &&
        activeTotal === 0 &&
        reviewTotal === 0 &&
        pastTotal === 0 ? (
        <EmptyState
          title="No service jobs assigned"
          description="Requests assigned to you by Dispatch coordinators will appear here."
        />
      ) : (
        <>
          {showActive && (
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
          )}

          {showReview && (reviewTotal > 0 || sectionFilter === 'awaiting_review' || reviewQuery.isError || reviewPage > 1) && (
            <section className="space-y-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
                Awaiting Review &amp; Provider Handoff ({reviewTotal})
              </h2>
              {reviewQuery.isError ? (
                <EmptyState
                  title="Could not load review-pending jobs"
                  description={reviewQuery.error.message}
                />
              ) : reviewRows.length === 0 ? (
                <p className="rounded-lg border border-line bg-surface p-4 text-xs text-muted">
                  No completed visits awaiting coordinator review or provider confirmation.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {reviewRows.map((row) => (
                    <Link
                      key={row.id}
                      to={`/services/requests/${row.id}?from=${fromTarget}`}
                      className="block rounded-lg border border-line bg-surface p-4 shadow-xs transition-colors hover:border-emerald"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-ink">
                              {row.internal_code}
                            </span>
                            <ServiceTypeBadge requestType={row.request_type} />
                            <ServiceStatusPill status={row.status} />
                          </div>
                          <p className="text-sm font-medium text-ink">
                            {row.site_name} ({row.area_label}) — {row.provider_name}
                          </p>
                        </div>
                        <span className="text-xs text-muted">View Ticket →</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <ServicePaginationBar
                page={reviewPage}
                pageSize={MY_JOBS_PAGE_SIZE}
                totalCount={reviewTotal}
                onPageChange={(nextPage) => updatePage('reviewPage', nextPage)}
                label="Awaiting review jobs pagination"
              />
            </section>
          )}

          {showPast && (pastTotal > 0 || sectionFilter === 'historical' || pastQuery.isError || pastPage > 1) && (
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
