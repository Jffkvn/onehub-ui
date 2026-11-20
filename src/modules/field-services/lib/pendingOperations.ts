import {
  PendingOperationConflictError,
  UncertainTransportError,
  assertProtectedSessionCurrent,
  canonicalizePayload,
  captureProtectedSessionSnapshot,
  classifyRpcError,
  clearAllProtectedPendingOperations,
  createPendingOperationStore,
  createUuidV4,
  extractErrorMessage,
  formatPendingOperationConflictMessage,
  isAbortError,
  isProtectedSessionCurrent,
  resetProtectedSessionRegistryForTest,
  useProtectedIdentityScope,
  type PendingOperationRecord,
  type PendingOperationStatus,
  type ProtectedSessionSnapshot,
  type RpcErrorKind,
} from '@/lib/idempotency/pendingOperations'

export const SERVICE_PENDING_OPS_STORAGE_PREFIX = 'onehub.service.pendingOps.'

export type PendingServiceOperationType =
  | 'service_save_draft'
  | 'service_submit_request'
  | 'service_cancel_request'
  | 'service_accept_request'
  | 'service_assign_request'
  | 'service_add_assignment_assistant'
  | 'service_start_visit'
  | 'service_save_visit'
  | 'service_complete_visit'
  | 'service_log_assistant_visit_contribution'
  | 'service_review_request'
  | 'service_report_to_provider'
  | 'service_confirm_provider_handoff'
  | 'service_raise_urgent_flag'
  | 'service_ack_urgent_flag'
  | 'service_resolve_urgent_flag'

export type { PendingOperationStatus, RpcErrorKind }
export type PendingServiceOperation = PendingOperationRecord<PendingServiceOperationType>

export const SERVICE_DEFINITE_MESSAGE_MARKERS = [
  'PROVIDER_REF_EXISTS:',
  'ASSIGNMENT_SUPERSEDED:',
  'cannot approve its review',
  'Cannot cancel while a field visit is in progress',
  'Service request not found',
  'Service visit not found',
  'Urgent flag not found',
  'A valid uploaded service evidence image',
  'Evidence path does not belong to this service visit',
] as const

export function formatServiceOperationLabel(opType: PendingServiceOperationType): string {
  switch (opType) {
    case 'service_save_draft':
      return 'Save Service Draft'
    case 'service_submit_request':
      return 'Submit Service Request'
    case 'service_cancel_request':
      return 'Cancel Service Request'
    case 'service_accept_request':
      return 'Accept Unclaimed Request'
    case 'service_assign_request':
      return 'Assign Crew Episode'
    case 'service_add_assignment_assistant':
      return 'Add Crew Assistant'
    case 'service_start_visit':
      return 'Start Field Visit'
    case 'service_save_visit':
      return 'Save Field Visit Draft'
    case 'service_complete_visit':
      return 'Complete Field Visit'
    case 'service_log_assistant_visit_contribution':
      return 'Save Assistant Contribution'
    case 'service_review_request':
      return 'Coordinator Review Decision'
    case 'service_report_to_provider':
      return 'Report Completion to Provider'
    case 'service_confirm_provider_handoff':
      return 'Record Provider Confirmation'
    case 'service_raise_urgent_flag':
      return 'Raise Urgent Flag'
    case 'service_ack_urgent_flag':
      return 'Acknowledge Urgent Flag'
    case 'service_resolve_urgent_flag':
      return 'Resolve Urgent Flag'
  }
}

export const servicePendingStore = createPendingOperationStore<PendingServiceOperationType>({
  storagePrefix: SERVICE_PENDING_OPS_STORAGE_PREFIX,
  formatLabel: formatServiceOperationLabel,
})

export const registerInFlightServiceInstance = servicePendingStore.registerInFlight
export const unregisterInFlightServiceInstance = servicePendingStore.unregisterInFlight
export const isServiceOperationActivelyInFlight = servicePendingStore.isActivelyInFlight
export const readPendingServiceOperations = servicePendingStore.readAll
export const readPendingServiceOperationByIntent = servicePendingStore.readByIntent
export const clearPendingServiceOperation = servicePendingStore.clear

export function clearAllPendingServiceOperations(): void {
  servicePendingStore.clearAll()
  clearAllProtectedPendingOperations()
}

export function resetServiceSessionRegistryForTest(): void {
  resetProtectedSessionRegistryForTest()
}

export function classifyServiceRpcError(error: unknown): RpcErrorKind {
  return classifyRpcError(error, SERVICE_DEFINITE_MESSAGE_MARKERS)
}

export class UncertainServiceTransportError extends UncertainTransportError {
  constructor(message: string) {
    super(message)
    this.name = 'UncertainServiceTransportError'
  }
}

export {
  PendingOperationConflictError,
  assertProtectedSessionCurrent,
  canonicalizePayload,
  captureProtectedSessionSnapshot,
  createUuidV4,
  extractErrorMessage,
  formatPendingOperationConflictMessage,
  isAbortError,
  isProtectedSessionCurrent,
  useProtectedIdentityScope,
  type ProtectedSessionSnapshot,
}

export function isProviderRefDuplicateError(error: unknown): boolean {
  return extractErrorMessage(error).includes('PROVIDER_REF_EXISTS:')
}

export function isConcurrentModificationError(error: unknown): boolean {
  return extractErrorMessage(error).includes('CONCURRENT_MODIFICATION:')
}

export function isAssignmentSupersededError(error: unknown): boolean {
  return extractErrorMessage(error).includes('ASSIGNMENT_SUPERSEDED:')
}

export function isSelfReviewBlockedError(error: unknown): boolean {
  return extractErrorMessage(error)
    .toLowerCase()
    .includes('cannot approve its review')
}
