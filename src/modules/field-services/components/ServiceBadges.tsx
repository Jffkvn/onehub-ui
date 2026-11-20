import { AlertTriangle, ChevronLeft, ChevronRight, ShieldAlert, Wrench, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'
import { PendingOperationsBanner } from '@/components/patterns/PendingOperationsBanner'
import {
  SERVICE_PRIORITY_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_TYPE_LABELS,
  SERVICE_URGENT_STATUS_LABELS,
  type ServicePriority,
  type ServiceRequestStatus,
  type ServiceRequestType,
  type ServiceUrgentStatus,
} from '../schemas/services'
import {
  classifyServiceRpcError,
  isServiceOperationActivelyInFlight,
} from '../lib/pendingOperations'
import {
  useDiscardPendingServiceOperation,
  usePendingServiceOperations,
  useRetryPendingServiceOperation,
} from '../api/services'

type StatusTone = NonNullable<StatusPillProps['tone']>

const STATUS_TONES: Record<ServiceRequestStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'info',
  assigned: 'violet',
  in_progress: 'info',
  follow_up_required: 'warning',
  work_completed: 'violet',
  coordinator_reviewed: 'success',
  reported_to_provider: 'info',
  provider_confirmed: 'success',
  cancelled: 'neutral',
}

const PRIORITY_TONES: Record<ServicePriority, StatusTone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
}

const URGENT_TONES: Record<ServiceUrgentStatus, StatusTone> = {
  open: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
}

export function ServiceStatusPill({
  status,
  size = 'sm',
}: {
  status: ServiceRequestStatus
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <StatusPill tone={STATUS_TONES[status]} size={size}>
      {SERVICE_STATUS_LABELS[status]}
    </StatusPill>
  )
}

export function ServicePriorityPill({ priority }: { priority: ServicePriority }) {
  return (
    <StatusPill tone={PRIORITY_TONES[priority]} size="sm" withDot={priority === 'urgent'}>
      {SERVICE_PRIORITY_LABELS[priority]}
    </StatusPill>
  )
}

export function ServiceTypeBadge({ requestType }: { requestType: ServiceRequestType }) {
  const isInstall = requestType === 'installation'
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-line bg-canvas px-2 py-0.5 text-[11px] font-medium text-soft">
      {isInstall ? (
        <Wifi className="h-3 w-3 text-emerald" />
      ) : (
        <Wrench className="h-3 w-3 text-amber" />
      )}
      {SERVICE_TYPE_LABELS[requestType]}
    </span>
  )
}

export function UrgentFlagBadge({
  status,
  count,
}: {
  status: ServiceUrgentStatus | 'none'
  count?: number
}) {
  if (status === 'none') return null
  return (
    <StatusPill tone={URGENT_TONES[status]} size="sm" withDot={status === 'open'}>
      <AlertTriangle className="h-3 w-3 mr-0.5" />
      {count && count > 1
        ? `${count} ${SERVICE_URGENT_STATUS_LABELS[status]}`
        : SERVICE_URGENT_STATUS_LABELS[status]}
    </StatusPill>
  )
}

export function ServiceTimestamp({
  value,
  fallback = 'Not recorded',
}: {
  value: string | null | undefined
  fallback?: string
}) {
  if (!value) return <span className="text-muted">{fallback}</span>
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <span className="text-muted">{fallback}</span>
  return (
    <span className="tabular-nums text-ink">
      {date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </span>
  )
}

export function ViewerScopeNotice({
  scope,
}: {
  scope: 'full' | 'active_assigned' | 'historical_participant'
}) {
  if (scope === 'full') return null
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-line bg-canvas p-3 text-xs text-soft">
      <ShieldAlert className="h-4 w-4 shrink-0 text-amber mt-0.5" />
      {scope === 'active_assigned' ? (
        <span>
          Active crew view — customer site details, active visit checklist, and photos are visible.
          Internal intake and provider reporting notes stay restricted to Intake and Coordinators.
        </span>
      ) : (
        <span>
          Historical participant read-only view — customer phone numbers, street addresses, access
          instructions, and other crews&apos; episodes are redacted for privacy.
        </span>
      )}
    </div>
  )
}

export function PendingServiceOperationsBanner({
  intentPrefix,
}: {
  intentPrefix?: string
}) {
  const operations = usePendingServiceOperations()
  const retryMutation = useRetryPendingServiceOperation()
  const discardOperation = useDiscardPendingServiceOperation()

  const visibleOps = intentPrefix
    ? operations.filter((op) => op.intentKey.startsWith(intentPrefix))
    : operations

  return (
    <PendingOperationsBanner
      operations={visibleOps}
      isActivelyInFlight={isServiceOperationActivelyInFlight}
      retryingIntentKey={retryMutation.variables?.intentKey}
      isRetryPending={retryMutation.isPending}
      onRetry={(op) => retryMutation.mutateAsync(op)}
      onDiscard={(intentKey) => discardOperation(intentKey)}
      classifyError={classifyServiceRpcError}
      testId="service-pending-retry-banner"
    />
  )
}

export function ServicePaginationBar({
  page,
  pageSize,
  totalCount,
  onPageChange,
  label = 'Pagination',
}: {
  page: number
  pageSize: number
  totalCount: number
  onPageChange: (nextPage: number) => void
  label?: string
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  if (totalCount <= pageSize && page <= 1) return null
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(totalCount, page * pageSize)

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-xs"
    >
      <span className="text-muted tabular-nums">
        {totalCount === 0
          ? `Page ${page} of ${totalPages} · 0 results`
          : `Showing ${start}–${end} of ${totalCount} · Page ${page} of ${totalPages}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </Button>
      </div>
    </nav>
  )
}
