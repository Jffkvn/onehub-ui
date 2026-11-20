import { AlertCircle, AlertTriangle, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'

type StatusTone = NonNullable<StatusPillProps['tone']>
import { Button } from '@/components/ui/Button'
import { DialogClose } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { describeLocationCheck } from '../lib/geolocation'
import {
  classifyAttendanceRpcError,
  extractErrorMessage,
  isAbortError,
  isAttendanceOperationActivelyInFlight,
} from '../lib/pendingOperations'
import {
  useDiscardPendingAttendanceOperation,
  usePendingAttendanceOperations,
  useRetryPendingAttendanceOperation,
} from '../api/attendance'

export const WEEKDAY_OPTIONS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 0, short: 'Sun', label: 'Sunday' },
] as const

export function formatWeekdaysSummary(weekdays?: number[] | null): string {
  if (!weekdays || weekdays.length === 0) return 'Every scheduled day'
  const set = new Set(weekdays)
  return WEEKDAY_OPTIONS.filter((d) => set.has(d.value))
    .map((d) => d.short)
    .join(', ')
}

export function WorkModePill({ mode }: { mode?: string | null }) {
  switch (mode) {
    case 'office':
      return (
        <StatusPill tone="info" size="sm">
          Office
        </StatusPill>
      )
    case 'field':
      return (
        <StatusPill tone="warning" size="sm">
          Field
        </StatusPill>
      )
    case 'remote':
      return (
        <StatusPill tone="violet" size="sm">
          Remote
        </StatusPill>
      )
    default:
      return (
        <StatusPill tone="neutral" size="sm">
          Not Scheduled
        </StatusPill>
      )
  }
}

export function RecordStatePill({ state }: { state?: string | null }) {
  const map: Record<string, { label: string; tone: StatusTone }> = {
    complete: { label: 'Complete', tone: 'success' },
    open: { label: 'Working', tone: 'info' },
    expected: { label: 'Scheduled', tone: 'neutral' },
    holiday: { label: 'Holiday', tone: 'violet' },
    non_scheduled: { label: 'Non-Workday', tone: 'neutral' },
    missing_clock_in: { label: 'Missing Start Day', tone: 'danger' },
    missing_clock_out: { label: 'Missing End Day', tone: 'danger' },
    partial_out_only: { label: 'Missing Start Day', tone: 'danger' },
    absent: { label: 'Absent', tone: 'warning' },
    unverified: { label: 'Policy Unverified', tone: 'neutral' },
  }
  const entry = (state && map[state]) || { label: state || 'Unknown', tone: 'neutral' as StatusTone }
  return (
    <StatusPill tone={entry.tone} size="sm">
      {entry.label}
    </StatusPill>
  )
}

export function PolicyProvenancePill({
  policyVerified,
  recordState,
}: {
  policyVerified?: boolean | null
  recordState?: string | null
}) {
  if (policyVerified !== false || recordState === 'unverified' || recordState === 'holiday') {
    return null
  }
  return (
    <StatusPill tone="neutral" size="sm">
      Schedule Unverified
    </StatusPill>
  )
}

export function PunctualityPill({ punctuality }: { punctuality?: 'on_time' | 'late' | null }) {
  if (!punctuality) return null
  return punctuality === 'on_time' ? (
    <StatusPill tone="success" size="sm">
      On Time
    </StatusPill>
  ) : (
    <StatusPill tone="warning" size="sm">
      Late
    </StatusPill>
  )
}

export function LocationCheckPill({
  locationCheck,
  distanceM,
}: {
  locationCheck?: string | null
  distanceM?: number | null
}) {
  if (!locationCheck) return null
  const { label, tone } = describeLocationCheck(locationCheck, distanceM)
  return (
    <StatusPill tone={tone === 'info' ? 'info' : tone} size="sm">
      {label}
    </StatusPill>
  )
}

export function WorkflowStatusPill({ status }: { status?: string | null }) {
  const map: Record<string, { label: string; tone: StatusTone }> = {
    pending: { label: 'Pending', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
    follow_up_pending: { label: 'Follow-up Pending', tone: 'warning' },
    no_follow_up: { label: 'No Follow-up', tone: 'neutral' },
    reviewed: { label: 'Reviewed', tone: 'success' },
    verified: { label: 'Verified', tone: 'success' },
    dismissed: { label: 'Dismissed', tone: 'neutral' },
    required_unsubmitted: { label: 'Explanation Required', tone: 'warning' },
    required: { label: 'Explanation Required', tone: 'warning' },
    accepted: { label: 'Accepted', tone: 'success' },
    unresolved: { label: 'Unresolved', tone: 'danger' },
    submitted: { label: 'Explanation Submitted', tone: 'info' },
    not_required: { label: 'Not Required', tone: 'neutral' },
    pending_correction: { label: 'Correction Pending', tone: 'warning' },
    corrected: { label: 'Corrected', tone: 'info' },
    resolved: { label: 'Resolved', tone: 'success' },
    none: { label: 'Clear', tone: 'neutral' },
  }
  const entry = (status && map[status]) || {
    label: status ? status.replace(/_/g, ' ') : '—',
    tone: 'neutral' as StatusTone,
  }
  return (
    <StatusPill tone={entry.tone} size="sm">
      {entry.label}
    </StatusPill>
  )
}

export function ModalSubmitFooter({
  formId,
  submitError,
  isPending,
  submitLabel,
  submitVariant = 'primary',
}: {
  formId: string
  submitError: unknown
  isPending: boolean
  submitLabel: string
  submitVariant?: 'primary' | 'danger'
}) {
  const errorText =
    submitError && !isAbortError(submitError) ? extractErrorMessage(submitError) : ''
  return (
    <div className="w-full space-y-3">
      {errorText && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-rose/30 bg-rose-tint p-3 text-xs text-rose"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorText}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2.5">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" form={formId} variant={submitVariant} loading={isPending}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

export function PendingAttendanceOperationsBanner({
  filterScope,
}: {
  filterScope?: 'self' | 'admin' | 'all'
}) {
  const { toast } = useToast()
  const operations = usePendingAttendanceOperations()
  const retryMutation = useRetryPendingAttendanceOperation()
  const discardOperation = useDiscardPendingAttendanceOperation()

  const visibleOps = operations.filter((op) => {
    if (!filterScope || filterScope === 'all') return true
    const isAdminIntent =
      op.intentKey.startsWith('review:') ||
      op.intentKey.startsWith('hr:') ||
      op.intentKey.startsWith('setup:')
    return filterScope === 'admin' ? isAdminIntent : !isAdminIntent
  })

  if (visibleOps.length === 0) return null

  return (
    <div className="space-y-2.5" data-testid="attendance-pending-retry-banner">
      {visibleOps.map((op) => {
        const isInFlight = isAttendanceOperationActivelyInFlight(op)
        const isRetrying =
          retryMutation.isPending && retryMutation.variables?.intentKey === op.intentKey
        return (
          <div
            key={op.intentKey}
            role={isInFlight ? 'status' : 'alert'}
            className={
              isInFlight
                ? 'rounded-lg border border-blue/40 bg-blue-tint p-4 shadow-xs'
                : 'rounded-lg border border-amber/40 bg-amber-tint p-4 shadow-xs'
            }
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {isInFlight ? (
                  <Loader2 className="h-5 w-5 text-blue shrink-0 mt-0.5 animate-spin" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 text-xs">
                  <p className="font-display text-sm font-bold text-ink">
                    {isInFlight
                      ? `Sending Request: ${op.label}`
                      : `Awaiting Confirmation: ${op.label}`}
                  </p>
                  {isInFlight ? (
                    <p className="text-soft">
                      Waiting for server confirmation (
                      <span className="font-mono text-ink">{op.requestId.slice(0, 8)}</span>). This
                      action is still in flight — avoid duplicate submissions until it settles.
                    </p>
                  ) : (
                    <p className="text-soft">
                      Delivery was interrupted ({op.errorMessage ?? 'connection error'}). Retry with
                      frozen request ID{' '}
                      <span className="font-mono text-ink">{op.requestId.slice(0, 8)}</span> to
                      prevent duplicate actions, or discard if you need to submit different details.
                    </p>
                  )}
                </div>
              </div>
              {!isInFlight && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={retryMutation.isPending}
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => discardOperation(op.intentKey)}
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={isRetrying}
                    disabled={retryMutation.isPending}
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    onClick={() => {
                      void retryMutation
                        .mutateAsync(op)
                        .then((env) => {
                          toast(
                            env.replayed
                              ? `${op.label} confirmed — server had already recorded this request`
                              : `${op.label} confirmed`,
                            { tone: 'success' },
                          )
                        })
                        .catch((error) => {
                          if (isAbortError(error)) return
                          if (classifyAttendanceRpcError(error) === 'definite') {
                            toast(extractErrorMessage(error), { tone: 'danger' })
                          }
                        })
                    }}
                  >
                    Retry Pending Action
                  </Button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
