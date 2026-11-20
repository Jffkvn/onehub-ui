import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  executeIdempotentOperation,
  sanitizeRpcArgs,
  useProtectedIdentityScope,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import {
  arrangementsListResponseSchema,
  fieldEvidenceResponseSchema,
  mutationEnvelopeSchema,
  myHistoryResponseSchema,
  registerResponseSchema,
  reviewQueuesResponseSchema,
  setupOverviewResponseSchema,
  todayContextSchema,
  type ArrangementsListResponse,
  type FieldEvidenceResponse,
  type MutationEnvelope,
  type MyHistoryResponse,
  type RegisterResponse,
  type ReviewQueuesResponse,
  type SetupOverviewResponse,
  type TodayContext,
} from '../schemas/attendance'
import {
  ATTENDANCE_DEFINITE_MESSAGE_MARKERS,
  UncertainAttendanceTransportError,
  attendancePendingStore,
  classifyAttendanceRpcError,
  clearPendingAttendanceOperation,
  extractErrorMessage,
  isAttendanceOperationActivelyInFlight,
  readPendingAttendanceOperationByIntent,
  type PendingAttendanceOperation,
  type PendingAttendanceOperationType,
} from '../lib/pendingOperations'

export { sanitizeRpcArgs }

function toRpcError(error: unknown): Error {
  if (error instanceof Error) return error
  const wrapped = new Error(extractErrorMessage(error))
  if (error && typeof error === 'object') {
    Object.assign(wrapped, error)
  }
  return wrapped
}

async function callAttendanceReadRpc<T>(
  fnName: string,
  params: Record<string, unknown> | undefined,
  schema: { parse: (val: unknown) => T },
): Promise<T> {
  const client = getSupabaseClient()
  const response = (
    params ? await client.rpc(fnName, sanitizeRpcArgs(params)) : await client.rpc(fnName)
  ) as { data: unknown; error: unknown }
  if (response.error) {
    throw toRpcError(response.error)
  }
  if (response.data == null) {
    throw new UncertainAttendanceTransportError(`Empty response from ${fnName}.`)
  }
  return schema.parse(response.data)
}

async function callAttendanceMutationRpc(
  fnName: string,
  params: Record<string, unknown>,
): Promise<MutationEnvelope> {
  const client = getSupabaseClient()
  const response = (await client.rpc(fnName, sanitizeRpcArgs(params))) as {
    data: unknown
    error: unknown
  }
  if (response.error) {
    throw toRpcError(response.error)
  }
  const parsed = mutationEnvelopeSchema.safeParse(response.data)
  if (!parsed.success) {
    throw new UncertainAttendanceTransportError(
      `Malformed confirmation envelope from ${fnName}. Use Retry to verify whether the action applied.`,
    )
  }
  return parsed.data
}

function useIdentityScope() {
  return useProtectedIdentityScope(useAuth())
}

/* ─── Pending Operations Subscription Hooks (B4-01) ────────────────────────── */

export function usePendingAttendanceOperations() {
  return attendancePendingStore.useOperations(useAuth())
}

export function useRetryPendingAttendanceOperation() {
  const queryClient = useQueryClient()
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useMutation({
    mutationFn: (op: PendingAttendanceOperation) =>
      runIdempotentIntentOperation({
        identityScope: { identityKey, authEpoch, isAuthReady, latestRef },
        intentKey: op.intentKey,
        operationType: op.operationType,
        rpcName: op.rpcName,
        payloadWithoutRequestId: op.payload,
        retryingOperation: op,
      }),
    onSuccess: async () => {
      if (latestRef.current.isAuthReady && latestRef.current.identityKey) {
        await queryClient.invalidateQueries({ queryKey: ['attendance'] })
      }
    },
  })
}

export function useDiscardPendingAttendanceOperation() {
  const { identityKey } = useIdentityScope()
  return (intentKey: string, options?: { force?: boolean }): boolean => {
    if (!identityKey) return false
    const existing = readPendingAttendanceOperationByIntent(identityKey, intentKey)
    if (existing && isAttendanceOperationActivelyInFlight(existing) && !options?.force) {
      return false
    }
    return clearPendingAttendanceOperation(identityKey, intentKey)
  }
}

/* ─── Read Queries ────────────────────────────────────────────────────────── */

export function useAttendanceTodayContext(enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<TodayContext>({
    queryKey: ['attendance', 'today-context', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    retry: (failureCount, error) =>
      classifyAttendanceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callAttendanceReadRpc(
        'rpc_attendance_today_context',
        undefined,
        todayContextSchema,
      )
      const latest = latestRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before attendance loaded.', 'AbortError')
      }
      return res
    },
  })
}

export function useAttendanceMyHistory(fromDate?: string, toDate?: string, enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<MyHistoryResponse>({
    queryKey: [
      'attendance',
      'my-history',
      fromDate ?? null,
      toDate ?? null,
      identityKey ?? 'anonymous',
      authEpoch,
    ],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callAttendanceReadRpc(
        'rpc_attendance_my_history',
        { p_from: fromDate ?? null, p_to: toDate ?? null },
        myHistoryResponseSchema,
      )
      const latest = latestRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before history loaded.', 'AbortError')
      }
      return res
    },
  })
}

export interface RegisterQueryFilters {
  from?: string
  to?: string
  departmentId?: string | null
  status?: string | null
  employeeId?: string | null
  limit?: number
  offset?: number
}

export function useAttendanceRegister(filters: RegisterQueryFilters, enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<RegisterResponse>({
    queryKey: [
      'attendance',
      'register',
      filters.from ?? null,
      filters.to ?? null,
      filters.departmentId ?? null,
      filters.status ?? null,
      filters.employeeId ?? null,
      filters.limit ?? 50,
      filters.offset ?? 0,
      identityKey ?? 'anonymous',
      authEpoch,
    ],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callAttendanceReadRpc(
        'rpc_attendance_get_register',
        {
          p_from: filters.from ?? null,
          p_to: filters.to ?? null,
          p_department_id: filters.departmentId ?? null,
          p_status: filters.status ?? null,
          p_employee_id: filters.employeeId ?? null,
          p_limit: filters.limit ?? 50,
          p_offset: filters.offset ?? 0,
        },
        registerResponseSchema,
      )
      const latest = latestRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before register loaded.', 'AbortError')
      }
      return res
    },
  })
}

export function useAttendanceReviewQueues(
  status: 'pending' | 'all' = 'pending',
  enabled = true,
) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<ReviewQueuesResponse>({
    queryKey: ['attendance', 'review-queues', status, identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callAttendanceReadRpc(
        'rpc_attendance_list_review_queues',
        { p_status: status, p_limit: 50, p_offset: 0 },
        reviewQueuesResponseSchema,
      )
      const latest = latestRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before review queues loaded.', 'AbortError')
      }
      return res
    },
  })
}

export function useAttendanceArrangements(
  params: { status?: string | null; employeeId?: string | null; reviewOnly?: boolean },
  enabled = true,
) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<ArrangementsListResponse>({
    queryKey: [
      'attendance',
      'arrangements',
      params.status ?? null,
      params.employeeId ?? null,
      Boolean(params.reviewOnly),
      identityKey ?? 'anonymous',
      authEpoch,
    ],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callAttendanceReadRpc(
        'rpc_attendance_list_arrangements',
        {
          p_status: params.status ?? null,
          p_employee_id: params.employeeId ?? null,
          p_review_only: Boolean(params.reviewOnly),
          p_limit: 50,
          p_offset: 0,
        },
        arrangementsListResponseSchema,
      )
      const latest = latestRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before arrangements loaded.', 'AbortError')
      }
      return res
    },
  })
}

export function useAttendanceSetupOverview(enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<SetupOverviewResponse>({
    queryKey: ['attendance', 'setup-overview', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callAttendanceReadRpc(
        'rpc_attendance_get_setup_overview',
        undefined,
        setupOverviewResponseSchema,
      )
      const latest = latestRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before setup loaded.', 'AbortError')
      }
      return res
    },
  })
}

export function useAttendanceFieldEvidence(punchId: string | null) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<FieldEvidenceResponse>({
    queryKey: ['attendance', 'field-evidence', punchId, identityKey ?? 'anonymous', authEpoch],
    enabled: Boolean(punchId) && isAuthReady && Boolean(identityKey),
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || !punchId || signal.aborted) {
        throw new DOMException('Evidence cannot be loaded.', 'AbortError')
      }
      const res = await callAttendanceReadRpc(
        'rpc_attendance_get_field_evidence',
        { p_punch_id: punchId },
        fieldEvidenceResponseSchema,
      )
      const latest = latestRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before evidence loaded.', 'AbortError')
      }
      return res
    },
  })
}

/* ─── Intent-Scoped Idempotent & Session-Guarded Mutation Engine (B4-01/B4-02) */

async function runIdempotentIntentOperation({
  identityScope,
  intentKey,
  operationType,
  rpcName,
  payloadWithoutRequestId,
  retryingOperation,
}: {
  identityScope: IdentityScopeRef
  intentKey: string
  operationType: PendingAttendanceOperationType
  rpcName: string
  payloadWithoutRequestId: Record<string, unknown>
  retryingOperation?: PendingAttendanceOperation
}): Promise<MutationEnvelope> {
  return executeIdempotentOperation({
    store: attendancePendingStore,
    identityScope,
    intentKey,
    operationType,
    rpcName,
    payloadWithoutRequestId,
    retryingOperation,
    extraDefiniteMarkers: ATTENDANCE_DEFINITE_MESSAGE_MARKERS,
    invokeRpc: callAttendanceMutationRpc,
  })
}

function useIntentAttendanceMutation<TInput>(buildSpec: (input: TInput) => {
  intentKey: string
  operationType: PendingAttendanceOperationType
  rpcName: string
  payload: Record<string, unknown>
  retryingOperation?: PendingAttendanceOperation
}) {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation({
    mutationFn: (input: TInput) => {
      const spec = buildSpec(input)
      return runIdempotentIntentOperation({
        identityScope,
        intentKey: spec.intentKey,
        operationType: spec.operationType,
        rpcName: spec.rpcName,
        payloadWithoutRequestId: spec.payload,
        retryingOperation: spec.retryingOperation,
      })
    },
    onSuccess: async () => {
      if (identityScope.latestRef.current.isAuthReady && identityScope.latestRef.current.identityKey) {
        await queryClient.invalidateQueries({ queryKey: ['attendance'] })
      }
    },
  })
}

/* ─── Self Execution Mutations ────────────────────────────────────────────── */

export interface PunchSubmissionInput {
  locationStatus: string
  lat: number | null
  lng: number | null
  accuracyM: number | null
  clientCapturedAt: string | null
  contextRevision: string
  retryingOperation?: PendingAttendanceOperation
}

export function useClockIn() {
  return useIntentAttendanceMutation<PunchSubmissionInput>((input) => ({
    intentKey: 'execution:punch',
    operationType: 'clock_in',
    rpcName: 'rpc_attendance_clock_in',
    retryingOperation: input.retryingOperation,
    payload: {
      p_location_status: input.locationStatus,
      p_lat: input.lat,
      p_lng: input.lng,
      p_accuracy_m: input.accuracyM,
      p_client_captured_at: input.clientCapturedAt,
      p_context_revision: input.contextRevision,
    },
  }))
}

export function useClockOut() {
  return useIntentAttendanceMutation<PunchSubmissionInput>((input) => ({
    intentKey: 'execution:punch',
    operationType: 'clock_out',
    rpcName: 'rpc_attendance_clock_out',
    retryingOperation: input.retryingOperation,
    payload: {
      p_location_status: input.locationStatus,
      p_lat: input.lat,
      p_lng: input.lng,
      p_accuracy_m: input.accuracyM,
      p_client_captured_at: input.clientCapturedAt,
      p_context_revision: input.contextRevision,
    },
  }))
}

export interface StillWorkingSubmissionInput extends PunchSubmissionInput {
  reason: string
  expectedFinishAt: string | null
}

export function useDeclareStillWorking() {
  return useIntentAttendanceMutation<StillWorkingSubmissionInput>((input) => ({
    intentKey: 'execution:punch',
    operationType: 'declare_still_working',
    rpcName: 'rpc_attendance_declare_still_working',
    retryingOperation: input.retryingOperation,
    payload: {
      p_reason: input.reason,
      p_expected_finish_at: input.expectedFinishAt,
      p_location_status: input.locationStatus,
      p_lat: input.lat,
      p_lng: input.lng,
      p_accuracy_m: input.accuracyM,
      p_client_captured_at: input.clientCapturedAt,
      p_context_revision: input.contextRevision,
    },
  }))
}

/* ─── Self Workflow Mutations ─────────────────────────────────────────────── */

export function useSubmitCorrection() {
  return useIntentAttendanceMutation<{
    localDate: string
    requestKind: string
    claimedInAt: string | null
    claimedOutAt: string | null
    reason: string
  }>((input) => ({
    intentKey: `self:submit_correction:${input.localDate}`,
    operationType: 'submit_correction',
    rpcName: 'rpc_attendance_submit_correction',
    payload: {
      p_local_date: input.localDate,
      p_request_kind: input.requestKind,
      p_claimed_in_at: input.claimedInAt,
      p_claimed_out_at: input.claimedOutAt,
      p_reason: input.reason,
    },
  }))
}

export function useCancelCorrection() {
  return useIntentAttendanceMutation<string>((correctionId) => ({
    intentKey: `self:cancel_correction:${correctionId}`,
    operationType: 'cancel_correction',
    rpcName: 'rpc_attendance_cancel_correction',
    payload: {
      p_correction_id: correctionId,
    },
  }))
}

export function useSubmitExplanation() {
  return useIntentAttendanceMutation<{
    attendanceDayId: string
    reason: string
    declaredFinishAt: string | null
  }>((input) => ({
    intentKey: `self:submit_explanation:${input.attendanceDayId}`,
    operationType: 'submit_explanation',
    rpcName: 'rpc_attendance_submit_explanation',
    payload: {
      p_attendance_day_id: input.attendanceDayId,
      p_reason: input.reason,
      p_declared_finish_at: input.declaredFinishAt,
    },
  }))
}

export function useSubmitArrangement() {
  return useIntentAttendanceMutation<{
    mode: 'field' | 'remote'
    coverageType: 'dated' | 'weekly'
    startDate: string
    endDate: string | null
    weekdays: number[] | null
    reason: string
    dutyLabel: string | null
  }>((input) => ({
    intentKey: 'self:submit_arrangement',
    operationType: 'submit_arrangement',
    rpcName: 'rpc_attendance_submit_arrangement',
    payload: {
      p_mode: input.mode,
      p_coverage_type: input.coverageType,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_weekdays: input.coverageType === 'weekly' ? input.weekdays : null,
      p_reason: input.reason,
      p_duty_label: input.dutyLabel,
    },
  }))
}

export function useCancelArrangement() {
  return useIntentAttendanceMutation<{ arrangementId: string; expectedVersion: number }>(
    (input) => ({
      intentKey: `self:cancel_arrangement:${input.arrangementId}`,
      operationType: 'cancel_arrangement',
      rpcName: 'rpc_attendance_cancel_arrangement',
      payload: {
        p_arrangement_id: input.arrangementId,
        p_expected_version: input.expectedVersion,
      },
    }),
  )
}

/* ─── Manager & HR Decision / Register / Setup Mutations ─────────────────── */

export function useDecideCorrection() {
  return useIntentAttendanceMutation<{
    correctionId: string
    decision: 'approved' | 'rejected'
    reviewNote: string | null
    dayVersion: number
  }>((input) => ({
    intentKey: `review:decide_correction:${input.correctionId}`,
    operationType: 'decide_correction',
    rpcName: 'rpc_attendance_decide_correction',
    payload: {
      p_correction_id: input.correctionId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
      p_day_version: input.dayVersion,
    },
  }))
}

export function useHrCorrectDay() {
  return useIntentAttendanceMutation<{
    employeeId: string
    localDate: string
    claimedInAt: string | null
    claimedOutAt: string | null
    reason: string
    expectedDayVersion: number | null
  }>((input) => ({
    intentKey: `hr:correct_day:${input.employeeId}:${input.localDate}`,
    operationType: 'hr_correct_day',
    rpcName: 'rpc_attendance_hr_correct_day',
    payload: {
      p_employee_id: input.employeeId,
      p_local_date: input.localDate,
      p_claimed_in_at: input.claimedInAt,
      p_claimed_out_at: input.claimedOutAt,
      p_reason: input.reason,
      p_expected_day_version: input.expectedDayVersion,
    },
  }))
}

export function useDecideExplanation() {
  return useIntentAttendanceMutation<{
    explanationId: string
    decision: 'approved' | 'rejected'
    reviewNote: string | null
  }>((input) => ({
    intentKey: `review:decide_explanation:${input.explanationId}`,
    operationType: 'decide_explanation',
    rpcName: 'rpc_attendance_decide_explanation',
    payload: {
      p_explanation_id: input.explanationId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
    },
  }))
}

export interface DecideArrangementInput {
  arrangementId: string
  decision: 'approved' | 'rejected'
  reviewNote: string | null
  expectedVersion: number
  replace?: boolean
  applyFromNow?: boolean
  applyReason?: string | null
  dayVersion?: number | null
  expectedReplacedId?: string | null
  expectedReplacedVersion?: number | null
}

export function useDecideArrangement() {
  return useIntentAttendanceMutation<DecideArrangementInput>((input) => ({
    intentKey: `review:decide_arrangement:${input.arrangementId}`,
    operationType: 'decide_arrangement',
    rpcName: 'rpc_attendance_decide_arrangement',
    payload: {
      p_arrangement_id: input.arrangementId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
      p_expected_version: input.expectedVersion,
      p_replace: Boolean(input.replace),
      p_apply_from_now: Boolean(input.applyFromNow),
      p_apply_reason: input.applyFromNow ? (input.applyReason ?? null) : null,
      p_day_version: input.applyFromNow ? (input.dayVersion ?? null) : null,
      p_expected_replaced_id: input.replace ? (input.expectedReplacedId ?? null) : null,
      p_expected_replaced_version: input.replace ? (input.expectedReplacedVersion ?? null) : null,
    },
  }))
}

export function useHrCreateArrangement() {
  return useIntentAttendanceMutation<{
    employeeId: string
    mode: 'field' | 'remote'
    coverageType: 'dated' | 'weekly'
    startDate: string
    endDate: string | null
    weekdays: number[] | null
    reason: string
    dutyLabel: string | null
    replace?: boolean
    applyFromNow?: boolean
    applyReason?: string | null
    dayVersion?: number | null
    expectedReplacedId?: string | null
    expectedReplacedVersion?: number | null
  }>((input) => ({
    intentKey: `hr:create_arrangement:${input.employeeId}`,
    operationType: 'hr_create_arrangement',
    rpcName: 'rpc_attendance_hr_create_arrangement',
    payload: {
      p_employee_id: input.employeeId,
      p_mode: input.mode,
      p_coverage_type: input.coverageType,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_weekdays: input.coverageType === 'weekly' ? input.weekdays : null,
      p_reason: input.reason,
      p_duty_label: input.dutyLabel,
      p_replace: Boolean(input.replace),
      p_apply_from_now: Boolean(input.applyFromNow),
      p_apply_reason: input.applyFromNow ? (input.applyReason ?? null) : null,
      p_day_version: input.applyFromNow ? (input.dayVersion ?? null) : null,
      p_expected_replaced_id: input.replace ? (input.expectedReplacedId ?? null) : null,
      p_expected_replaced_version: input.replace ? (input.expectedReplacedVersion ?? null) : null,
    },
  }))
}

export function useReviewFieldEvidence() {
  return useIntentAttendanceMutation<{
    punchId: string
    action: 'verify' | 'flag_follow_up' | 'dismiss_follow_up' | 'add_note'
    note: string | null
    expectedVersion: number | null
  }>((input) => ({
    intentKey: `review:field_evidence:${input.punchId}`,
    operationType: 'review_field_evidence',
    rpcName: 'rpc_attendance_review_field_evidence',
    payload: {
      p_punch_id: input.punchId,
      p_action: input.action,
      p_note: input.note,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useSetAttendanceEnabled() {
  return useIntentAttendanceMutation<{ enabled: boolean; reason: string }>((input) => ({
    intentKey: 'setup:set_enabled',
    operationType: 'set_enabled',
    rpcName: 'rpc_attendance_set_enabled',
    payload: {
      p_enabled: input.enabled,
      p_reason: input.reason,
    },
  }))
}

export function useSaveWorkplace() {
  return useIntentAttendanceMutation<{
    id: string | null
    name: string
    latitude: number
    longitude: number
    radiusMeters: number
    timezone: string
    isActive: boolean
    reason: string
  }>((input) => ({
    intentKey: `setup:save_workplace:${input.id ?? 'new'}`,
    operationType: 'save_workplace',
    rpcName: 'rpc_attendance_save_workplace',
    payload: {
      p_id: input.id,
      p_name: input.name,
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_radius_meters: input.radiusMeters,
      p_timezone: input.timezone,
      p_is_active: input.isActive,
      p_reason: input.reason,
    },
  }))
}

export function useSaveSchedule() {
  return useIntentAttendanceMutation<{
    id: string | null
    name: string
    timezone: string
    halfDayBoundary: string
    latenessGraceMinutes: number
    explanationThresholdMinutes: number
    isActive: boolean
    days: Array<{
      weekday: number
      is_workday: boolean
      expected_start: string | null
      expected_end: string | null
    }>
    reason: string
  }>((input) => ({
    intentKey: `setup:save_schedule:${input.id ?? 'new'}`,
    operationType: 'save_schedule',
    rpcName: 'rpc_attendance_save_schedule',
    payload: {
      p_id: input.id,
      p_name: input.name,
      p_timezone: input.timezone,
      p_half_day_boundary: input.halfDayBoundary,
      p_lateness_grace_minutes: input.latenessGraceMinutes,
      p_explanation_threshold_minutes: input.explanationThresholdMinutes,
      p_is_active: input.isActive,
      p_days: input.days,
      p_reason: input.reason,
    },
  }))
}

export function useSaveHoliday() {
  return useIntentAttendanceMutation<{
    localDate: string
    name: string
    isActive: boolean
    reason: string
  }>((input) => ({
    intentKey: `setup:save_holiday:${input.localDate}`,
    operationType: 'save_holiday',
    rpcName: 'rpc_attendance_save_holiday',
    payload: {
      p_local_date: input.localDate,
      p_name: input.name,
      p_is_active: input.isActive,
      p_reason: input.reason,
    },
  }))
}

export function useSetEnrollmentDefaults() {
  return useIntentAttendanceMutation<{
    scheduleId: string | null
    workplaceId: string | null
    enrollmentBasis: 'office' | 'arrangement'
    defaultManagerEmployeeId: string | null
    autoEnrollNew: boolean
    expectedRevision: number
    reason: string
  }>((input) => ({
    intentKey: 'setup:set_defaults',
    operationType: 'set_enrollment_defaults',
    rpcName: 'rpc_attendance_set_enrollment_defaults',
    payload: {
      p_schedule_id: input.scheduleId,
      p_workplace_id: input.workplaceId,
      p_enrollment_basis: input.enrollmentBasis,
      p_default_manager_employee_id: input.defaultManagerEmployeeId,
      p_auto_enroll_new: input.autoEnrollNew,
      p_expected_revision: input.expectedRevision,
      p_reason: input.reason,
    },
  }))
}

export function useSetEmployeeManager() {
  return useIntentAttendanceMutation<{
    employeeId: string
    managerEmployeeId: string | null
    reason: string
  }>((input) => ({
    intentKey: `setup:set_manager:${input.employeeId}`,
    operationType: 'set_employee_manager',
    rpcName: 'rpc_attendance_set_employee_manager',
    payload: {
      p_employee_id: input.employeeId,
      p_manager_employee_id: input.managerEmployeeId,
      p_reason: input.reason,
    },
  }))
}

export function useBulkEnroll() {
  return useIntentAttendanceMutation<{
    employeeIds: string[]
    scheduleId: string
    workplaceId: string | null
    enrollmentBasis: 'office' | 'arrangement'
    effectiveFrom: string
    effectiveTo: string | null
    managerEmployeeId: string | null
    reason: string
  }>((input) => ({
    intentKey: 'setup:bulk_enroll',
    operationType: 'bulk_enroll',
    rpcName: 'rpc_attendance_bulk_enroll',
    payload: {
      p_employee_ids: input.employeeIds,
      p_schedule_id: input.scheduleId,
      p_workplace_id: input.workplaceId,
      p_enrollment_basis: input.enrollmentBasis,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_manager_employee_id: input.managerEmployeeId,
      p_reason: input.reason,
    },
  }))
}
