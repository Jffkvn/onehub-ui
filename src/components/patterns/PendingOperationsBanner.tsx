import { AlertTriangle, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  extractErrorMessage,
  isAbortError,
  type PendingOperationRecord,
  type RpcErrorKind,
} from '@/lib/idempotency/pendingOperations'

export interface PendingOperationsBannerProps<TOpType extends string> {
  operations: PendingOperationRecord<TOpType>[]
  isActivelyInFlight: (op: PendingOperationRecord<TOpType>) => boolean
  retryingIntentKey: string | undefined
  isRetryPending: boolean
  onRetry: (op: PendingOperationRecord<TOpType>) => Promise<{ replayed?: boolean }>
  onDiscard: (intentKey: string) => void
  classifyError: (error: unknown) => RpcErrorKind
  testId?: string
}

export function PendingOperationsBanner<TOpType extends string>({
  operations,
  isActivelyInFlight,
  retryingIntentKey,
  isRetryPending,
  onRetry,
  onDiscard,
  classifyError,
  testId = 'pending-retry-banner',
}: PendingOperationsBannerProps<TOpType>) {
  const { toast } = useToast()

  if (operations.length === 0) return null

  return (
    <div className="space-y-2.5" data-testid={testId}>
      {operations.map((op) => {
        const isInFlight = isActivelyInFlight(op)
        const isRetrying = isRetryPending && retryingIntentKey === op.intentKey
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
                    disabled={isRetryPending}
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => onDiscard(op.intentKey)}
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={isRetrying}
                    disabled={isRetryPending}
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    onClick={() => {
                      void onRetry(op)
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
                          if (classifyError(error) === 'definite') {
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
