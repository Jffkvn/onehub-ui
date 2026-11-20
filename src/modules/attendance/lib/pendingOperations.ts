import {
  PendingOperationConflictError,
  UncertainTransportError,
  canonicalizePayload,
  classifyRpcError,
  clearAllProtectedPendingOperations,
  createPendingOperationStore,
  createUuidV4,
  extractErrorMessage,
  formatPendingOperationConflictMessage,
  isAbortError,
  isProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  resetProtectedSessionRegistryForTest,
  syncProtectedAuthSessionFromHook,
  syncProtectedAuthSessionFromProvider,
  type PendingOperationRecord,
  type PendingOperationStatus,
  type ProtectedSessionSnapshot,
  type RpcErrorKind,
} from '@/lib/idempotency/pendingOperations'

export const PENDING_OPS_STORAGE_PREFIX = 'onehub.attendance.pendingOps.'
export const LEGACY_PENDING_OP_STORAGE_PREFIX = 'onehub.attendance.pendingOp.'

export type PendingAttendanceOperationType =
  | 'clock_in'
  | 'clock_out'
  | 'declare_still_working'
  | 'submit_correction'
  | 'cancel_correction'
  | 'submit_explanation'
  | 'submit_arrangement'
  | 'cancel_arrangement'
  | 'decide_correction'
  | 'hr_correct_day'
  | 'decide_explanation'
  | 'decide_arrangement'
  | 'hr_create_arrangement'
  | 'review_field_evidence'
  | 'set_enabled'
  | 'save_workplace'
  | 'save_schedule'
  | 'save_holiday'
  | 'set_enrollment_defaults'
  | 'set_employee_manager'
  | 'bulk_enroll'

export type { PendingOperationStatus }
export type PendingAttendanceOperation = PendingOperationRecord<PendingAttendanceOperationType>
export type AttendanceSessionSnapshot = ProtectedSessionSnapshot
export type AttendanceRpcErrorKind = RpcErrorKind

export const ATTENDANCE_DEFINITE_MESSAGE_MARKERS = [
  'ARRANGEMENT_CONFLICT',
  'APPLY_FROM_NOW_REQUIRED',
  'ATTENDANCE_DISABLED',
  'ATTENDANCE_SETUP_INCOMPLETE',
  'MISSING_CLOCK_IN',
  'NOT_ENROLLED',
  'WORKPLACE_GPS_REQUIRED',
  'EXPLANATION_REQUIRED',
] as const

export function formatOperationTypeLabel(opType: PendingAttendanceOperationType): string {
  switch (opType) {
    case 'clock_in':
      return 'Start Day'
    case 'clock_out':
      return 'End Day'
    case 'declare_still_working':
      return 'Still Working Confirmation'
    case 'submit_correction':
      return 'Submit Correction Request'
    case 'cancel_correction':
      return 'Cancel Correction Request'
    case 'submit_explanation':
      return 'Submit Extra-Time Explanation'
    case 'submit_arrangement':
      return 'Submit Work Arrangement'
    case 'cancel_arrangement':
      return 'Cancel Work Arrangement'
    case 'decide_correction':
      return 'Review Correction Request'
    case 'hr_correct_day':
      return 'Direct HR Day Correction'
    case 'decide_explanation':
      return 'Review Extra-Time Explanation'
    case 'decide_arrangement':
      return 'Review Work Arrangement'
    case 'hr_create_arrangement':
      return 'HR Assign Work Arrangement'
    case 'review_field_evidence':
      return 'Save Field Evidence Review'
    case 'set_enabled':
      return 'Toggle Live Attendance'
    case 'save_workplace':
      return 'Save Workplace Geofence'
    case 'save_schedule':
      return 'Save Attendance Schedule'
    case 'save_holiday':
      return 'Save Company Holiday'
    case 'set_enrollment_defaults':
      return 'Save Enrolment Defaults'
    case 'set_employee_manager':
      return 'Assign Attendance Reviewer'
    case 'bulk_enroll':
      return 'Bulk Enrol Employees'
  }
}

export const attendancePendingStore = createPendingOperationStore<PendingAttendanceOperationType>({
  storagePrefix: PENDING_OPS_STORAGE_PREFIX,
  legacyPrefixes: [LEGACY_PENDING_OP_STORAGE_PREFIX],
  defaultIntentKey: 'execution:punch',
  formatLabel: formatOperationTypeLabel,
})

export const syncAttendanceAuthSessionFromProvider = syncProtectedAuthSessionFromProvider
export const syncAttendanceAuthSessionFromHook = syncProtectedAuthSessionFromHook
export const captureAttendanceSessionSnapshot = captureProtectedSessionSnapshot
export const isAttendanceSessionCurrent = isProtectedSessionCurrent

export const registerInFlightAttendanceInstance = attendancePendingStore.registerInFlight
export const unregisterInFlightAttendanceInstance = attendancePendingStore.unregisterInFlight
export const isAttendanceOperationActivelyInFlight = attendancePendingStore.isActivelyInFlight
export const isAttendanceOperationStillOwned = attendancePendingStore.isStillOwned

export function resetAttendanceSessionRegistryForTest(): void {
  resetProtectedSessionRegistryForTest()
}

export {
  isAbortError,
  canonicalizePayload as canonicalizeAttendancePayload,
  PendingOperationConflictError,
  extractErrorMessage,
  createUuidV4,
}

export function PendingOperationConflictErrorMessage(
  pendingOperation: PendingAttendanceOperation,
): string {
  return formatPendingOperationConflictMessage(
    pendingOperation,
    attendancePendingStore.isActivelyInFlight(pendingOperation),
  )
}

export const getPendingOperationsStorageKey = attendancePendingStore.getStorageKey
export const subscribePendingAttendanceOperations = attendancePendingStore.subscribe
export const readPendingAttendanceOperations = attendancePendingStore.readAll
export const readPendingAttendanceOperationByIntent = attendancePendingStore.readByIntent
export const readPendingAttendanceOperation = attendancePendingStore.readDefault
export const writePendingAttendanceOperation = attendancePendingStore.write
export const updatePendingAttendanceOperationIfOwned = attendancePendingStore.updateIfOwned
export const clearPendingAttendanceOperation = attendancePendingStore.clear

export function clearAllPendingAttendanceOperations(): void {
  attendancePendingStore.clearAll()
  clearAllProtectedPendingOperations()
}

export function classifyAttendanceRpcError(error: unknown): AttendanceRpcErrorKind {
  return classifyRpcError(error, ATTENDANCE_DEFINITE_MESSAGE_MARKERS)
}

export class UncertainAttendanceTransportError extends UncertainTransportError {
  constructor(message: string) {
    super(message)
    this.name = 'UncertainAttendanceTransportError'
  }
}

export function isUnlinkedEmployeeError(error: unknown): boolean {
  const msg = extractErrorMessage(error)
  return msg.includes('No active employee record is linked')
}

export function isAttendanceDisabledError(error: unknown): boolean {
  const msg = extractErrorMessage(error)
  return msg.includes('ATTENDANCE_DISABLED')
}

export function isApplyFromNowRequiredError(error: unknown): boolean {
  const msg = extractErrorMessage(error)
  return msg.includes('APPLY_FROM_NOW_REQUIRED')
}

export function parseArrangementConflictId(error: unknown): string | null {
  const msg = extractErrorMessage(error)
  const match = /ARRANGEMENT_CONFLICT:([0-9a-fA-F-]{36})/.exec(msg)
  return match ? match[1] : null
}
