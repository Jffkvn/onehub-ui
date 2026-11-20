import { Link } from 'react-router-dom'
import { ArrowRight, Briefcase, ClipboardList, FilePlus2, Wrench, Wifi } from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  getEffectiveServiceAccess,
  useMyAssignedRequests,
  useServiceOverviewCounts,
} from '../api/services'
import { PendingServiceOperationsBanner } from '../components/ServiceBadges'

export function ServicesHomePage() {
  const auth = useAuth()
  const { hasPermission } = getEffectiveServiceAccess(auth)
  const canReadAll = hasPermission('service_requests.read')
  const canIntake = hasPermission('service_requests.intake')
  const canMyJobs = hasPermission('service_visits.read_assigned')

  const overviewQuery = useServiceOverviewCounts(canReadAll)
  const myQuery = useMyAssignedRequests(25, 0, {
    assignmentScope: 'active',
    enabled: canMyJobs,
  })

  const overview = overviewQuery.data
  const myActiveRows = (myQuery.data?.rows ?? []).filter((r) => r.is_active_assignment)
  const myActiveCount = myQuery.data?.active_count ?? myActiveRows.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Field Services"
        subtitle="ISP customer installations, maintenance dispatches, and field visit verification."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canIntake && (
              <Link to="/services/intake/new">
                <Button type="button" variant="primary" leftIcon={<FilePlus2 className="h-4 w-4" />}>
                  Log New Request
                </Button>
              </Link>
            )}
            {canReadAll && (
              <Link to="/services/dispatch">
                <Button type="button" variant="outline" leftIcon={<ClipboardList className="h-4 w-4" />}>
                  Dispatch Queue
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <PendingServiceOperationsBanner />

      {canReadAll && overviewQuery.isError ? (
        <EmptyState
          title="Could not load service overview counts"
          description={overviewQuery.error.message}
        />
      ) : canReadAll ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Link
            to="/services/dispatch?type=installation"
            className="group flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-xs transition-all hover:border-emerald hover:shadow-sm"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-tint text-emerald-600">
                  <Wifi className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-600" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-ink">Installation</h2>
                <p className="mt-0.5 text-xs text-soft">
                  New customer fibre drops, ONT provisioning, and initial activation handoffs.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-3 text-xs">
              {overviewQuery.isLoading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <>
                  <span className="font-semibold text-ink tabular-nums">
                    {overview?.installation.active ?? 0} active
                  </span>
                  <span className="text-muted tabular-nums">
                    {overview?.installation.submitted ?? 0} awaiting dispatch
                  </span>
                  {(overview?.installation.open_urgent_flags ?? 0) > 0 && (
                    <span className="font-semibold text-rose tabular-nums">
                      {overview?.installation.open_urgent_flags ?? 0} urgent flag(s)
                    </span>
                  )}
                </>
              )}
            </div>
          </Link>

          <Link
            to="/services/dispatch?type=maintenance"
            className="group flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-xs transition-all hover:border-emerald hover:shadow-sm"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-tint text-amber">
                  <Wrench className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-600" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-ink">Maintenance</h2>
                <p className="mt-0.5 text-xs text-soft">
                  Line fault restoration, splicing repairs, and customer CPE troubleshooting.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-3 text-xs">
              {overviewQuery.isLoading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <>
                  <span className="font-semibold text-ink tabular-nums">
                    {overview?.maintenance.active ?? 0} active
                  </span>
                  <span className="text-muted tabular-nums">
                    {overview?.maintenance.submitted ?? 0} awaiting dispatch
                  </span>
                  {(overview?.maintenance.open_urgent_flags ?? 0) > 0 && (
                    <span className="font-semibold text-rose tabular-nums">
                      {overview?.maintenance.open_urgent_flags ?? 0} urgent flag(s)
                    </span>
                  )}
                </>
              )}
            </div>
          </Link>
        </div>
      ) : null}

      {canMyJobs && (
        <div className="rounded-lg border border-line bg-surface p-5 shadow-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-tint text-blue">
                <Briefcase className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">My Assigned Service Jobs</h2>
                <p className="mt-0.5 text-xs text-soft">
                  {myQuery.isLoading
                    ? 'Checking assigned crew jobs...'
                    : myQuery.isError
                      ? `Could not load assigned crew jobs: ${myQuery.error.message}`
                      : myActiveCount > 0
                        ? `${myActiveCount} active assignment(s) ready for field execution.`
                        : 'No active service jobs currently assigned to you.'}
                </p>
              </div>
            </div>
            <Link to="/services/my-jobs">
              <Button type="button" variant="secondary" rightIcon={<ArrowRight className="h-4 w-4" />}>
                Open My Service Jobs
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
