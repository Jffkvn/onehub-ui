import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FormGroup, Textarea } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Toggles'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type {
  NotificationDeliveryStatus,
  UrgentFlagDeliveryAttempt,
  UrgentFlagDeliverySummary,
} from '../schemas/services'
import { extractErrorMessage } from '../lib/pendingOperations'
import { useReissueUrgentNotification, useRetryUrgentNotification } from '../api/services'
import { ServiceTimestamp } from './ServiceBadges'

const SAFE_DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000

const ERROR_CODE_LABELS: Record<string, string> = {
  EMAIL_CHANNEL_DISABLED: 'Email alerts paused',
  EMAIL_PROVIDER_NOT_CONFIGURED: 'Email Provider Secrets Not Configured (MAIL-01)',
  IDEMPOTENCY_WINDOW_EXPIRED_REQUIRES_RECONCILIATION:
    '20h Safe Deduplication Window Expired — Reconciliation Required',
  STALE_FINAL_CLAIM_UNKNOWN_DELIVERY:
    'Final Attempt Timed Out — Provider Outcome Unknown (Reconciliation Required)',
  UNCERTAIN_ATTEMPT_NO_TIMESTAMP:
    'Stale Attempt Without Provider Timestamp — Reconciliation Required',
  RECIPIENT_NO_LONGER_AUTHORISED: 'Recipient No Longer Authorised (Skipped)',
  RECONCILED_AND_REISSUED: 'Reconciled & Reissued',
  DELIVERY_CONFIGURATION_MISSING: 'Webhook Configuration Missing',
  WEBHOOK_TRANSPORT_UNAVAILABLE: 'Webhook Transport Unavailable (pg_net inactive)',
  WEBHOOK_DISPATCH_FAILED: 'Webhook Dispatch Failed',
  STALE_PROCESSING_CLAIM_RECOVERED: 'Stale Processing Claim Released — Retryable',
}

export interface UrgentDeliveryEligibility {
  retryableCount: number
  reissuableCount: number
  unresolvedMaxAttemptCount: number
  canRetry: boolean
  canReissue: boolean
}

export function deriveUrgentDeliveryEligibility(
  deliverySummary: UrgentFlagDeliverySummary,
  deliveries?: UrgentFlagDeliveryAttempt[] | null,
  nowMs = Date.now(),
): UrgentDeliveryEligibility {
  // Always derive per-row eligibility when individual rows are available so completed ('sent')
  // or historical reconciled ('skipped') rows at attempt 5 never mask actionable failures.
  if (deliveries && deliveries.length > 0) {
    let retryableCount = 0
    let reissuableCount = 0
    let unresolvedMaxAttemptCount = 0

    for (const row of deliveries) {
      if (row.status === 'sent' || row.status === 'skipped') {
        continue
      }
      if (row.attempt_count > unresolvedMaxAttemptCount) {
        unresolvedMaxAttemptCount = row.attempt_count
      }
      if (typeof row.is_reissuable === 'boolean' || typeof row.is_retryable === 'boolean') {
        if (row.is_reissuable) {
          reissuableCount += 1
        } else if (row.is_retryable) {
          retryableCount += 1
        }
        continue
      }
      const firstAttemptMs = row.first_provider_attempt_at
        ? Date.parse(row.first_provider_attempt_at)
        : Number.NaN
      const isExpired =
        Number.isFinite(firstAttemptMs) && firstAttemptMs > 0 && nowMs - firstAttemptMs > SAFE_DEDUP_WINDOW_MS

      if (
        row.status === 'failed' &&
        (row.requires_reconciliation || row.attempt_count >= 5 || isExpired)
      ) {
        reissuableCount += 1
      } else if (
        (row.status === 'failed' || row.status === 'pending') &&
        !row.requires_reconciliation &&
        row.attempt_count < 5 &&
        !isExpired
      ) {
        retryableCount += 1
      }
    }

    return {
      retryableCount,
      reissuableCount,
      unresolvedMaxAttemptCount,
      canRetry: retryableCount > 0,
      canReissue: reissuableCount > 0,
    }
  }

  // Next prefer explicit server-computed actionable counts when rows array isn't expanded
  if (
    deliverySummary.retryable_count !== undefined &&
    deliverySummary.reissuable_count !== undefined
  ) {
    return {
      retryableCount: deliverySummary.retryable_count,
      reissuableCount: deliverySummary.reissuable_count,
      unresolvedMaxAttemptCount: deliverySummary.max_attempt_count,
      canRetry: deliverySummary.retryable_count > 0,
      canReissue: deliverySummary.reissuable_count > 0,
    }
  }

  // Fallback for legacy summary-only fixtures without per-row breakdown
  const fallbackReissue =
    deliverySummary.failed > 0 &&
    (deliverySummary.requires_reconciliation || deliverySummary.max_attempt_count >= 5)
  const fallbackRetry =
    !deliverySummary.requires_reconciliation &&
    deliverySummary.max_attempt_count < 5 &&
    (deliverySummary.failed > 0 || deliverySummary.pending > 0)

  return {
    retryableCount: fallbackRetry ? deliverySummary.failed + deliverySummary.pending : 0,
    reissuableCount: fallbackReissue ? deliverySummary.failed : 0,
    unresolvedMaxAttemptCount: deliverySummary.max_attempt_count,
    canRetry: fallbackRetry,
    canReissue: fallbackReissue,
  }
}

function formatErrorCode(code: string | null | undefined): string {
  if (!code) return 'None'
  return ERROR_CODE_LABELS[code] ?? code
}

function getDeliveryStatusBadgeMeta(status: NotificationDeliveryStatus): {
  label: string
  className: string
} {
  switch (status) {
    case 'sent':
      return {
        label: 'Provider Accepted (Resend)',
        className: 'bg-emerald-tint text-emerald-700 dark:text-emerald-300 border-emerald/30',
      }
    case 'failed':
      return {
        label: 'Failed',
        className: 'bg-rose-tint/50 text-rose border-rose/40',
      }
    case 'processing':
      return {
        label: 'Processing Claim',
        className: 'bg-amber-tint/50 text-amber border-amber/40',
      }
    case 'skipped':
      return {
        label: 'Skipped',
        className: 'bg-canvas text-muted border-line',
      }
    case 'pending':
    default:
      return {
        label: 'Pending',
        className: 'bg-canvas text-soft border-line',
      }
  }
}

export function AuditedReissueDialog({
  open,
  onOpenChange,
  flagId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flagId: string
}) {
  const { toast } = useToast()
  const reissueMutation = useReissueUrgentNotification()
  const [confirmDuplicateRisk, setConfirmDuplicateRisk] = useState(false)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setConfirmDuplicateRisk(false)
      setReason('')
      setFormError(null)
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = async () => {
    setFormError(null)
    if (!confirmDuplicateRisk) {
      setFormError('Confirm duplicate-email risk acknowledgement before continuing.')
      return
    }
    const cleanReason = reason.trim()
    if (cleanReason.length < 5) {
      setFormError('Provide a reconciliation / reissue justification (at least 5 characters).')
      return
    }
    try {
      const res = await reissueMutation.mutateAsync({
        flagId,
        confirmDuplicateRisk: true,
        reason: cleanReason,
      })
      toast(
        `Reconciled ${res.reconciled_count} record(s) and queued ${res.reissued_count} replacement alert(s).`,
        { tone: 'success' },
      )
      handleClose(false)
    } catch (err) {
      setFormError(extractErrorMessage(err))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      hasUnsavedChanges={confirmDuplicateRisk || reason.trim().length > 0}
      title="Audited Reissue of Urgent Email Alert"
      description="Use only after verifying with Resend or recipients that previous uncertain/exhausted deliveries did not reach inboxes. Recipients with status Provider Accepted are never re-sent."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={reissueMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            Confirm Audited Reissue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-amber/50 bg-amber-tint/35 p-3 text-xs text-ink flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-amber shrink-0 mt-0.5" />
          <p>
            Reissuing reconciles failed/uncertain attempts and creates a new delivery event key. If
            an earlier Resend call actually reached a recipient during a timeout, they may receive a
            duplicate email.
          </p>
        </div>

        <Checkbox
          checked={confirmDuplicateRisk}
          onCheckedChange={(v) => setConfirmDuplicateRisk(Boolean(v))}
          label="I understand this audited reissue carries duplicate-email risk for unconfirmed failures."
        />

        <FormGroup
          label="Reconciliation & Reissue Justification"
          required
          htmlFor={`reissue-reason-${flagId}`}
        >
          <Textarea
            id={`reissue-reason-${flagId}`}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The coordinator confirmed they did not receive the alert after a delivery timeout."
          />
        </FormGroup>

        {formError && (
          <p role="alert" className="text-xs font-medium text-rose">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  )
}

export function UrgentDeliveryStatusPanel({
  flagId,
  deliverySummary,
  deliveries,
  canOperate,
  compact = false,
}: {
  flagId: string
  deliverySummary?: UrgentFlagDeliverySummary | null
  deliveries?: UrgentFlagDeliveryAttempt[] | null
  canOperate: boolean
  compact?: boolean
}) {
  const { toast } = useToast()
  const retryMutation = useRetryUrgentNotification()
  const [reissueOpen, setReissueOpen] = useState(false)
  const [showRecipients, setShowRecipients] = useState(!compact)

  // Crew (Tier 2) and Historical (Tier 3) receive null deliverySummary from SQL; render nothing.
  if (!canOperate || !deliverySummary) {
    return null
  }

  const eligibility = deriveUrgentDeliveryEligibility(deliverySummary, deliveries)
  const canRetry = eligibility.canRetry
  const needsReissue = eligibility.canReissue

  const handleRetry = async () => {
    try {
      const res = await retryMutation.mutateAsync({ flagId })
      toast(
        `Retry queued for ${res.retried_count} recipient(s)${
          res.skipped_unauthorised_count > 0
            ? ` (${res.skipped_unauthorised_count} unauthorised skipped)`
            : ''
        }.`,
        { tone: 'success' },
      )
    } catch (err) {
      toast(extractErrorMessage(err), { tone: 'danger' })
    }
  }

  return (
    <div className="mt-2.5 rounded-md border border-line bg-canvas/80 p-3 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Mail className="h-3.5 w-3.5 text-emerald" />
            Email Escalation Delivery
          </span>
          {deliverySummary.total === 0 ? (
            <span className="text-muted">No coordinator email deliveries recorded yet.</span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {deliverySummary.sent > 0 && (
                <span className="inline-flex items-center gap-1 rounded border border-emerald/30 bg-emerald-tint px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  {deliverySummary.sent} Provider Accepted
                </span>
              )}
              {deliverySummary.failed > 0 && (
                <span className="inline-flex items-center gap-1 rounded border border-rose/40 bg-rose-tint/40 px-1.5 py-0.5 text-[11px] font-semibold text-rose">
                  <AlertCircle className="h-3 w-3" />
                  {deliverySummary.failed} Failed
                </span>
              )}
              {(deliverySummary.pending > 0 || deliverySummary.processing > 0) && (
                <span className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-soft">
                  <Clock className="h-3 w-3" />
                  {deliverySummary.pending + deliverySummary.processing} In Queue
                </span>
              )}
              {needsReissue && (
                <span className="inline-flex items-center gap-1 rounded border border-amber/50 bg-amber-tint/50 px-1.5 py-0.5 text-[11px] font-semibold text-ink">
                  <ShieldAlert className="h-3 w-3 text-amber" />
                  Reconciliation Required
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {deliveries && deliveries.length > 0 && compact && (
            <button
              type="button"
              onClick={() => setShowRecipients((v) => !v)}
              className="text-[11px] font-semibold text-emerald hover:underline px-1.5"
            >
              {showRecipients ? 'Hide Recipients' : `Recipients (${deliveries.length})`}
            </button>
          )}
          {canRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={retryMutation.isPending}
              leftIcon={<RefreshCw className="h-3 w-3" />}
              onClick={() => void handleRetry()}
            >
              Retry Email Delivery
            </Button>
          )}
          {needsReissue && (
            <Button
              type="button"
              size="sm"
              variant="danger"
              leftIcon={<RotateCcw className="h-3 w-3" />}
              onClick={() => setReissueOpen(true)}
            >
              Audited Reissue
            </Button>
          )}
        </div>
      </div>

      {deliverySummary.latest_error_code && (
        <p className="text-[11px] text-soft">
          Latest status note:{' '}
          <span className="font-mono font-medium text-ink">
            {formatErrorCode(deliverySummary.latest_error_code)}
          </span>
          {eligibility.unresolvedMaxAttemptCount > 0 && (
            <span className="text-muted">
              {' '}
              · Attempts: {eligibility.unresolvedMaxAttemptCount}/5
            </span>
          )}
        </p>
      )}

      {deliverySummary.sent > 0 && (
        <p className="text-[11px] text-muted">
          Note: &ldquo;Provider Accepted (Resend)&rdquo; confirms API handoff, not end-user inbox
          placement.
        </p>
      )}

      {showRecipients && deliveries && deliveries.length > 0 && (
        <ul className="divide-y divide-line rounded border border-line bg-surface">
          {deliveries.map((attempt) => {
            const badge = getDeliveryStatusBadgeMeta(attempt.status)
            return (
              <li
                key={attempt.id}
                className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 text-[11px]"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-ink">{attempt.recipient_name}</span>
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                    <span className="text-muted">({attempt.attempt_count}/5 attempts)</span>
                  </div>
                  {attempt.last_error_code && (
                    <p className="font-mono text-[10px] text-muted">
                      {formatErrorCode(attempt.last_error_code)}
                    </p>
                  )}
                </div>
                <span className="text-muted shrink-0">
                  <ServiceTimestamp
                    value={attempt.first_provider_attempt_at ?? attempt.updated_at}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <AuditedReissueDialog
        open={reissueOpen}
        onOpenChange={setReissueOpen}
        flagId={flagId}
      />
    </div>
  )
}
