import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase/client'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'
import { useAuth } from '@/modules/auth/AuthProvider'
import { MOCK_ROLE_PERMISSIONS } from '@/components/patterns/DevRoleSwitcher'
import type { UserRole } from '@/config/modules'
import {
  assertProtectedSessionCurrent,
  executeIdempotentOperation,
  isProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  sanitizeRpcArgs,
  useProtectedIdentityScope,
  type IdentityScopeRef,
  type ProtectedSessionSnapshot,
} from '@/lib/idempotency/pendingOperations'
import {
  coordinatorUrgentFlagsListResponseSchema,
  dispatchCandidatesResponseSchema,
  myAssignedRequestsResponseSchema,
  reissueUrgentDeliveryResultSchema,
  retryUrgentDeliveryResultSchema,
  serviceChecklistsResponseSchema,
  serviceMonitorQueueResponseSchema,
  serviceMonitorSnapshotSchema,
  serviceMutationEnvelopeSchema,
  serviceOverviewCountsSchema,
  serviceActivitySummaryResponseSchema,
  serviceRequestDetailSchema,
  serviceRequestsListResponseSchema,
  type CoordinatorUrgentFlagsListResponse,
  type DispatchCandidate,
  type MyAssignedRequestsResponse,
  type ReissueUrgentDeliveryResult,
  type RetryUrgentDeliveryResult,
  type ServiceActivitySummaryResponse,
  type ServiceChecklistsResponse,
  type ServiceMonitorBucket,
  type ServiceMonitorQueueResponse,
  type ServiceMonitorSnapshot,
  type ServiceMutationEnvelope,
  type ServiceOverviewCounts,
  type ServicePriority,
  type ServiceReceivedSource,
  type ServiceRequestDetail,
  type ServiceRequestStatus,
  type ServiceRequestType,
  type ServiceRequestsListResponse,
  type ServiceUrgentReasonCode,
} from '../schemas/services'
import {
  PendingOperationConflictError,
  SERVICE_DEFINITE_MESSAGE_MARKERS,
  UncertainServiceTransportError,
  classifyServiceRpcError,
  clearPendingServiceOperation,
  extractErrorMessage,
  formatPendingOperationConflictMessage,
  isAbortError,
  isServiceOperationActivelyInFlight,
  readPendingServiceOperationByIntent,
  servicePendingStore,
  type PendingServiceOperation,
  type PendingServiceOperationType,
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

function getSupabaseOrigin(): string {
  const raw = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (raw) {
    try {
      return new URL(raw).origin
    } catch {
      // Fallback below if malformed
    }
  }
  return typeof window !== 'undefined' ? window.location.origin : 'https://invalid.local'
}

export function getEffectiveServiceAccess(auth: ReturnType<typeof useAuth>): {
  actorId: string | null
  roleKeys: readonly UserRole[]
  permissionKeys: readonly string[]
  hasPermission: (key: string) => boolean
} {
  const previewRole = import.meta.env.DEV ? auth.devPreviewRole : null
  const roleKeys: readonly UserRole[] = previewRole ? [previewRole] : auth.access?.roleKeys ?? []
  const permissionKeys: readonly string[] = previewRole
    ? MOCK_ROLE_PERMISSIONS[previewRole]
    : auth.access?.permissionKeys ?? []
  const actorId = auth.access?.profile?.id ?? auth.session?.userId ?? null

  return {
    actorId,
    roleKeys,
    permissionKeys,
    hasPermission: (key: string) => permissionKeys.includes(key),
  }
}

export function hasParticipatedInRequest(
  detail: Pick<ServiceRequestDetail, 'visits'>,
  actorId: string | null | undefined,
): boolean {
  if (!actorId) return false
  return detail.visits.some(
    (visit) =>
      visit.lead_profile_id === actorId ||
      visit.started_by === actorId ||
      visit.completed_by === actorId ||
      visit.contributors.some((c) => c.profile_id === actorId),
  )
}

async function callServiceReadRpc<T>(
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
    throw new UncertainServiceTransportError(`Empty response from ${fnName}.`)
  }
  return schema.parse(response.data)
}

async function callServiceMutationRpc(
  fnName: string,
  params: Record<string, unknown>,
): Promise<ServiceMutationEnvelope> {
  const client = getSupabaseClient()
  const response = (await client.rpc(fnName, sanitizeRpcArgs(params))) as {
    data: unknown
    error: unknown
  }
  if (response.error) {
    throw toRpcError(response.error)
  }
  const parsed = serviceMutationEnvelopeSchema.safeParse(response.data)
  if (!parsed.success) {
    throw new UncertainServiceTransportError(
      `Malformed confirmation envelope from ${fnName}. Use Retry to verify whether the action applied.`,
    )
  }
  return parsed.data
}

function useIdentityScope() {
  return useProtectedIdentityScope(useAuth())
}

/* ─── Pending Operations Subscription Hooks ───────────────────────────────── */

export function usePendingServiceOperations() {
  return servicePendingStore.useOperations(useAuth())
}

export function useRetryPendingServiceOperation() {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation({
    mutationFn: (op: PendingServiceOperation) =>
      runServiceIdempotentOperation({
        identityScope,
        intentKey: op.intentKey,
        operationType: op.operationType,
        rpcName: op.rpcName,
        payloadWithoutRequestId: op.payload,
        retryingOperation: op,
      }),
    onSuccess: async () => {
      if (identityScope.latestRef.current.isAuthReady && identityScope.latestRef.current.identityKey) {
        await queryClient.invalidateQueries({ queryKey: ['field-services'] })
      }
    },
  })
}

export function useDiscardPendingServiceOperation() {
  const { identityKey } = useIdentityScope()
  return (intentKey: string, options?: { force?: boolean }): boolean => {
    if (!identityKey) return false
    const existing = readPendingServiceOperationByIntent(identityKey, intentKey)
    if (existing && isServiceOperationActivelyInFlight(existing) && !options?.force) {
      return false
    }
    return clearPendingServiceOperation(identityKey, intentKey)
  }
}

/* ─── Storage Evidence Upload & Private Signed URL Helpers ────────────────── */

export const MAX_SERVICE_VISIT_PHOTOS = 10
export const SERVICE_EVIDENCE_ALLOWED_MIMES =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif'

export class ServiceEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceEvidenceValidationError'
  }
}

function describePolicyErrorCode(code: string, fileName: string): string {
  switch (code) {
    case 'empty_file':
      return `"${fileName}" is empty.`
    case 'file_too_large':
      return `"${fileName}" exceeds the 10 MiB private upload limit.`
    case 'type_mismatch':
      return `"${fileName}" MIME type does not match its file extension.`
    case 'invalid_signature':
      return `"${fileName}" file content failed security signature verification.`
    default:
      return `"${fileName}" is not a supported image format.`
  }
}

export async function uploadServiceEvidencePhotos({
  ownerId,
  visitId,
  files,
  existingPathsCount = 0,
  isSessionCurrent,
}: {
  ownerId: string
  visitId: string
  files: readonly File[]
  existingPathsCount?: number
  isSessionCurrent?: () => boolean
}): Promise<string[]> {
  if (isSessionCurrent && !isSessionCurrent()) {
    throw new DOMException('Account session changed before photo upload.', 'AbortError')
  }
  if (files.length === 0) return []
  if (existingPathsCount + files.length > MAX_SERVICE_VISIT_PHOTOS) {
    throw new ServiceEvidenceValidationError(
      `Up to ${MAX_SERVICE_VISIT_PHOTOS} photos can be attached per visit record.`,
    )
  }

  const validated: Array<{ file: File; path: string }> = []
  for (const file of files) {
    if (isSessionCurrent && !isSessionCurrent()) {
      throw new DOMException('Account session changed before photo validation.', 'AbortError')
    }
    const check = await validatePrivateFileForUpload(file)
    if (isSessionCurrent && !isSessionCurrent()) {
      throw new DOMException('Account session changed during photo validation.', 'AbortError')
    }
    if (!check.ok) {
      throw new ServiceEvidenceValidationError(describePolicyErrorCode(check.code, file.name))
    }
    if (check.extension === 'pdf') {
      throw new ServiceEvidenceValidationError(
        `"${file.name}": Visit evidence accepts photos only (JPEG, PNG, WebP, HEIC, HEIF, AVIF). PDF documents are rejected.`,
      )
    }
    const path = createPrivateObjectPath({
      ownerId,
      category: 'service-evidence',
      recordId: visitId,
      extension: check.extension,
    })
    validated.push({ file, path })
  }

  const storage = getSupabaseClient().storage.from('private-files')
  const uploaded: string[] = []
  try {
    for (const item of validated) {
      if (isSessionCurrent && !isSessionCurrent()) {
        throw new DOMException('Account session changed before photo upload.', 'AbortError')
      }
      const { error } = await storage.upload(item.path, item.file, {
        upsert: false,
        contentType: item.file.type || undefined,
      })
      if (isSessionCurrent && !isSessionCurrent()) {
        throw new DOMException('Account session changed during photo upload.', 'AbortError')
      }
      if (error) {
        throw toRpcError(error)
      }
      uploaded.push(item.path)
    }
    return uploaded
  } catch (err) {
    // Never issue Storage DELETE under a switched user's auth token.
    if (uploaded.length > 0 && (!isSessionCurrent || isSessionCurrent())) {
      await storage.remove(uploaded).catch(() => undefined)
    }
    throw err
  }
}

export async function removeServiceEvidencePaths(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    const storage = getSupabaseClient().storage.from('private-files')
    await storage.remove([...paths])
  } catch {
    // Best-effort orphan cleanup only
  }
}

export async function getSignedServiceEvidenceUrl(path: string): Promise<string> {
  const storage = getSupabaseClient().storage.from('private-files')
  return createPrivateDownloadUrl(
    path,
    {
      allowedOrigin: getSupabaseOrigin(),
      createSignedUrl: (objectPath, expiresIn) => storage.createSignedUrl(objectPath, expiresIn),
    },
    60,
  )
}

export function useSignedServiceEvidenceUrl(path: string | null | undefined, enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<string>({
    queryKey: ['field-services', 'evidence-url', path ?? '', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && Boolean(path) && isAuthReady && Boolean(identityKey),
    staleTime: 45_000,
    gcTime: 50_000,
    retry: false,
    queryFn: async () => {
      if (!path) throw new Error('Missing evidence path.')
      const url = await getSignedServiceEvidenceUrl(path)
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Session changed while loading evidence URL.', 'AbortError')
      }
      return url
    },
  })
}

/* ─── Read Queries ────────────────────────────────────────────────────────── */

export function useServiceChecklists(enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<ServiceChecklistsResponse>({
    queryKey: ['field-services', 'checklists', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    staleTime: 5 * 60_000,
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_service_list_checklists',
        undefined,
        serviceChecklistsResponseSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading checklists.', 'AbortError')
      }
      return res
    },
  })
}

export function useDispatchCandidates(enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<DispatchCandidate[]>({
    queryKey: ['field-services', 'dispatch-candidates', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    staleTime: 60_000,
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_service_list_dispatch_candidates',
        undefined,
        dispatchCandidatesResponseSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading candidates.', 'AbortError')
      }
      return res
    },
  })
}

export function useServiceOverviewCounts(enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<ServiceOverviewCounts>({
    queryKey: ['field-services', 'overview-counts', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_service_get_overview_counts',
        undefined,
        serviceOverviewCountsSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading service counts.', 'AbortError')
      }
      return res
    },
  })
}

export interface ServiceRequestsFilter {
  requestType?: ServiceRequestType | null
  status?: ServiceRequestStatus | null
  statuses?: readonly ServiceRequestStatus[] | null
  urgentOnly?: boolean
  overdueOnly?: boolean
  search?: string | null
  limit?: number
  offset?: number
}

export function useServiceRequests(filters: ServiceRequestsFilter = {}, enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  const requestType = filters.requestType ?? null
  const status = filters.status ?? null
  const statuses =
    filters.statuses && filters.statuses.length > 0 ? [...filters.statuses] : null
  const urgentOnly = Boolean(filters.urgentOnly)
  const overdueOnly = Boolean(filters.overdueOnly)
  const search = filters.search?.trim() || null
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0

  return useQuery<ServiceRequestsListResponse>({
    queryKey: [
      'field-services',
      'requests',
      { requestType, status, statuses, urgentOnly, overdueOnly, search, limit, offset },
      identityKey ?? 'anonymous',
      authEpoch,
    ],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_service_list_requests',
        {
          p_request_type: requestType,
          p_status: status,
          p_search: search,
          p_limit: limit,
          p_offset: offset,
          p_urgent_only: urgentOnly,
          p_statuses: statuses,
          p_overdue_only: overdueOnly,
        },
        serviceRequestsListResponseSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading requests.', 'AbortError')
      }
      return res
    },
  })
}

export type MyAssignedRequestsScope = 'active' | 'awaiting_review' | 'historical'

export function useMyAssignedRequests(
  limit = 50,
  offset = 0,
  optionsOrEnabled:
    | boolean
    | { enabled?: boolean; assignmentScope?: MyAssignedRequestsScope | null } = true,
) {
  const enabled = typeof optionsOrEnabled === 'boolean' ? optionsOrEnabled : (optionsOrEnabled.enabled ?? true)
  const assignmentScope =
    typeof optionsOrEnabled === 'boolean' ? null : (optionsOrEnabled.assignmentScope ?? null)
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<MyAssignedRequestsResponse>({
    queryKey: [
      'field-services',
      'my-jobs',
      { limit, offset, assignmentScope },
      identityKey ?? 'anonymous',
      authEpoch,
    ],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_get_my_assigned_requests',
        { p_limit: limit, p_offset: offset, p_assignment_scope: assignmentScope },
        myAssignedRequestsResponseSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading assigned jobs.', 'AbortError')
      }
      return res
    },
  })
}

export function useServiceRequestDetail(id: string | undefined, enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<ServiceRequestDetail>({
    queryKey: ['field-services', 'detail', id ?? '', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && Boolean(id) && isAuthReady && Boolean(identityKey),
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!id || !identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_get_service_request_detail',
        { p_id: id },
        serviceRequestDetailSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading service request.', 'AbortError')
      }
      return res
    },
  })
}

/* ─── Idempotent Mutation Engine & 16 RPC Mutations ───────────────────────── */

async function runServiceIdempotentOperation({
  identityScope,
  intentKey,
  operationType,
  rpcName,
  payloadWithoutRequestId,
  retryingOperation,
  pinnedSessionSnapshot,
}: {
  identityScope: IdentityScopeRef
  intentKey: string
  operationType: PendingServiceOperationType
  rpcName: string
  payloadWithoutRequestId: Record<string, unknown>
  retryingOperation?: PendingServiceOperation
  pinnedSessionSnapshot?: ProtectedSessionSnapshot
}): Promise<ServiceMutationEnvelope> {
  return executeIdempotentOperation({
    store: servicePendingStore,
    identityScope,
    intentKey,
    operationType,
    rpcName,
    payloadWithoutRequestId,
    retryingOperation,
    pinnedSessionSnapshot,
    extraDefiniteMarkers: SERVICE_DEFINITE_MESSAGE_MARKERS,
    invokeRpc: callServiceMutationRpc,
  })
}

function useIntentServiceMutation<TInput>(
  buildSpec: (input: TInput) => {
    intentKey: string
    operationType: PendingServiceOperationType
    rpcName: string
    payload: Record<string, unknown>
    retryingOperation?: PendingServiceOperation
    pinnedSessionSnapshot?: ProtectedSessionSnapshot
  },
) {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation({
    mutationFn: (input: TInput) => {
      const spec = buildSpec(input)
      return runServiceIdempotentOperation({
        identityScope,
        intentKey: spec.intentKey,
        operationType: spec.operationType,
        rpcName: spec.rpcName,
        payloadWithoutRequestId: spec.payload,
        retryingOperation: spec.retryingOperation,
        pinnedSessionSnapshot: spec.pinnedSessionSnapshot,
      })
    },
    onSuccess: async () => {
      if (identityScope.latestRef.current.isAuthReady && identityScope.latestRef.current.identityKey) {
        await queryClient.invalidateQueries({ queryKey: ['field-services'] })
      }
    },
  })
}

export interface SaveServiceDraftInput {
  id?: string | null
  providerName: string
  providerReference: string
  requestType: ServiceRequestType
  priority: ServicePriority
  siteName: string
  areaLabel: string
  physicalAddress: string
  accessInstructions?: string | null
  customerContactName: string
  customerContactPhone: string
  summary: string
  intakeInternalNotes?: string | null
  receivedSource: ServiceReceivedSource
  providerReceivedAt: string
  providerDeadlineAt?: string | null
  expectedVersion?: number | null
  confirmDuplicate?: boolean
  pinnedSessionSnapshot?: ProtectedSessionSnapshot
}

export function useSaveServiceDraft() {
  return useIntentServiceMutation<SaveServiceDraftInput>((input) => ({
    intentKey: `service:draft:${input.id ?? 'new'}`,
    operationType: 'service_save_draft',
    rpcName: 'rpc_service_save_draft',
    pinnedSessionSnapshot: input.pinnedSessionSnapshot,
    payload: {
      p_id: input.id ?? null,
      p_provider_name: input.providerName,
      p_provider_reference: input.providerReference,
      p_request_type: input.requestType,
      p_priority: input.priority,
      p_site_name: input.siteName,
      p_area_label: input.areaLabel,
      p_physical_address: input.physicalAddress,
      p_access_instructions: input.accessInstructions ?? null,
      p_customer_contact_name: input.customerContactName,
      p_customer_contact_phone: input.customerContactPhone,
      p_summary: input.summary,
      p_intake_internal_notes: input.intakeInternalNotes ?? null,
      p_received_source: input.receivedSource,
      p_provider_received_at: input.providerReceivedAt,
      p_provider_deadline_at: input.providerDeadlineAt ?? null,
      p_expected_version: input.expectedVersion ?? null,
      p_confirm_duplicate: input.confirmDuplicate ?? false,
    },
  }))
}

export function useSubmitServiceRequest() {
  return useIntentServiceMutation<{
    id: string
    expectedVersion: number
    confirmDuplicate?: boolean
    pinnedSessionSnapshot?: ProtectedSessionSnapshot
  }>((input) => ({
    intentKey: `service:submit:${input.id}`,
    operationType: 'service_submit_request',
    rpcName: 'rpc_service_submit_request',
    pinnedSessionSnapshot: input.pinnedSessionSnapshot,
    payload: {
      p_id: input.id,
      p_expected_version: input.expectedVersion,
      p_confirm_duplicate: input.confirmDuplicate ?? false,
    },
  }))
}

export function useCancelServiceRequest() {
  return useIntentServiceMutation<{
    id: string
    reason: string
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:cancel:${input.id}`,
    operationType: 'service_cancel_request',
    rpcName: 'rpc_service_cancel_request',
    payload: {
      p_id: input.id,
      p_reason: input.reason,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useAcceptServiceRequest() {
  return useIntentServiceMutation<{ id: string; expectedVersion: number }>((input) => ({
    intentKey: `service:accept:${input.id}`,
    operationType: 'service_accept_request',
    rpcName: 'rpc_service_accept_request',
    payload: {
      p_id: input.id,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useAssignServiceRequest() {
  return useIntentServiceMutation<{
    id: string
    leadProfileId: string
    assistantProfileIds: string[]
    note?: string | null
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:assign:${input.id}`,
    operationType: 'service_assign_request',
    rpcName: 'rpc_service_assign_request',
    payload: {
      p_id: input.id,
      p_lead_profile_id: input.leadProfileId,
      p_assistant_profile_ids: input.assistantProfileIds,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useAddAssignmentAssistant() {
  return useIntentServiceMutation<{
    id: string
    assistantProfileId: string
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:add-assistant:${input.id}:${input.assistantProfileId}`,
    operationType: 'service_add_assignment_assistant',
    rpcName: 'rpc_service_add_assignment_assistant',
    payload: {
      p_id: input.id,
      p_assistant_profile_id: input.assistantProfileId,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useStartServiceVisit() {
  return useIntentServiceMutation<{
    serviceRequestId: string
    expectedRequestVersion: number
    clientCapturedAt?: string | null
  }>((input) => ({
    intentKey: `service:visit:start:${input.serviceRequestId}`,
    operationType: 'service_start_visit',
    rpcName: 'rpc_service_start_visit',
    payload: {
      p_service_request_id: input.serviceRequestId,
      p_expected_request_version: input.expectedRequestVersion,
      p_client_captured_at: input.clientCapturedAt ?? new Date().toISOString(),
    },
  }))
}

function assertPreUploadIntentClear({
  profileId,
  intentKey,
}: {
  profileId: string | null
  intentKey: string
}) {
  if (!profileId) return
  const existing = readPendingServiceOperationByIntent(profileId, intentKey)
  if (existing) {
    throw new PendingOperationConflictError(
      existing,
      formatPendingOperationConflictMessage(
        existing,
        isServiceOperationActivelyInFlight(existing),
      ),
    )
  }
}

async function executeVisitUploadAndIdempotentMutation({
  identityScope,
  buildIntentKey,
  operationType,
  rpcName,
  visitId,
  keptPhotoPaths,
  newPhotoFiles,
  buildPayload,
  pinnedSessionSnapshot,
}: {
  identityScope: IdentityScopeRef
  buildIntentKey: (actorId: string) => string
  operationType: PendingServiceOperationType
  rpcName: string
  visitId: string
  keptPhotoPaths: string[]
  newPhotoFiles?: File[]
  buildPayload: (combinedPhotoPaths: string[]) => Record<string, unknown>
  pinnedSessionSnapshot?: ProtectedSessionSnapshot
}): Promise<ServiceMutationEnvelope> {
  const startSnap =
    pinnedSessionSnapshot ??
    captureProtectedSessionSnapshot({
      identityKey: identityScope.identityKey,
      authEpoch: identityScope.authEpoch,
      isReady: identityScope.isAuthReady,
    })
  assertProtectedSessionCurrent(
    startSnap,
    identityScope.latestRef.current,
    'Authenticated session is unavailable.',
  )

  const ownerId = startSnap.identityKey!
  const intentKey = buildIntentKey(ownerId)
  const filesToUpload = newPhotoFiles ?? []
  if (filesToUpload.length > 0) {
    assertPreUploadIntentClear({ profileId: ownerId, intentKey })
  }

  const isStillStartSession = () =>
    isProtectedSessionCurrent(startSnap, identityScope.latestRef.current)

  const uploadedPaths = await uploadServiceEvidencePhotos({
    ownerId,
    visitId,
    files: filesToUpload,
    existingPathsCount: keptPhotoPaths.length,
    isSessionCurrent: isStillStartSession,
  })

  // Always re-verify after async upload (even 0-file array yields a microtask).
  if (!isStillStartSession()) {
    throw new DOMException('Account session changed before submitting visit update.', 'AbortError')
  }

  const combinedPhotoPaths = [...keptPhotoPaths, ...uploadedPaths]

  try {
    return await runServiceIdempotentOperation({
      identityScope,
      pinnedSessionSnapshot: startSnap,
      intentKey,
      operationType,
      rpcName,
      payloadWithoutRequestId: buildPayload(combinedPhotoPaths),
    })
  } catch (error) {
    if (
      !isAbortError(error) &&
      classifyServiceRpcError(error) === 'definite' &&
      isStillStartSession()
    ) {
      await removeServiceEvidencePaths(uploadedPaths)
    }
    throw error
  }
}

export function useSaveServiceVisit() {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation({
    mutationFn: async (input: {
      visitId: string
      checklist: Record<string, boolean>
      workNotes: string
      keptPhotoPaths: string[]
      newPhotoFiles?: File[]
      expectedVisitVersion: number
      pinnedSessionSnapshot?: ProtectedSessionSnapshot
    }) =>
      executeVisitUploadAndIdempotentMutation({
        identityScope,
        buildIntentKey: () => `service:visit:save:${input.visitId}`,
        operationType: 'service_save_visit',
        rpcName: 'rpc_service_save_visit',
        visitId: input.visitId,
        keptPhotoPaths: input.keptPhotoPaths,
        newPhotoFiles: input.newPhotoFiles,
        pinnedSessionSnapshot: input.pinnedSessionSnapshot,
        buildPayload: (combinedPhotoPaths) => ({
          p_visit_id: input.visitId,
          p_checklist: input.checklist,
          p_work_notes: input.workNotes,
          p_photo_paths: combinedPhotoPaths,
          p_expected_visit_version: input.expectedVisitVersion,
        }),
      }),
    onSuccess: async () => {
      if (identityScope.latestRef.current.isAuthReady && identityScope.latestRef.current.identityKey) {
        await queryClient.invalidateQueries({ queryKey: ['field-services'] })
      }
    },
  })
}

export function useCompleteServiceVisit() {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation({
    mutationFn: async (input: {
      visitId: string
      outcome: 'completed' | 'follow_up_required'
      checklist: Record<string, boolean>
      workNotes: string
      keptPhotoPaths: string[]
      newPhotoFiles?: File[]
      followUpReason?: string | null
      expectedVisitVersion: number
      expectedRequestVersion: number
      pinnedSessionSnapshot?: ProtectedSessionSnapshot
    }) =>
      executeVisitUploadAndIdempotentMutation({
        identityScope,
        buildIntentKey: () => `service:visit:complete:${input.visitId}`,
        operationType: 'service_complete_visit',
        rpcName: 'rpc_service_complete_visit',
        visitId: input.visitId,
        keptPhotoPaths: input.keptPhotoPaths,
        newPhotoFiles: input.newPhotoFiles,
        pinnedSessionSnapshot: input.pinnedSessionSnapshot,
        buildPayload: (combinedPhotoPaths) => ({
          p_visit_id: input.visitId,
          p_outcome: input.outcome,
          p_checklist: input.checklist,
          p_work_notes: input.workNotes,
          p_photo_paths: combinedPhotoPaths,
          p_follow_up_reason: input.followUpReason ?? null,
          p_expected_visit_version: input.expectedVisitVersion,
          p_expected_request_version: input.expectedRequestVersion,
        }),
      }),
    onSuccess: async () => {
      if (identityScope.latestRef.current.isAuthReady && identityScope.latestRef.current.identityKey) {
        await queryClient.invalidateQueries({ queryKey: ['field-services'] })
      }
    },
  })
}

export function useLogAssistantVisitContribution() {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation({
    mutationFn: async (input: {
      visitId: string
      note: string
      keptPhotoPaths: string[]
      newPhotoFiles?: File[]
      expectedVisitVersion: number
      clientCapturedAt?: string | null
      pinnedSessionSnapshot?: ProtectedSessionSnapshot
    }) =>
      executeVisitUploadAndIdempotentMutation({
        identityScope,
        buildIntentKey: (actorId) => `service:visit:contrib:${input.visitId}:${actorId}`,
        operationType: 'service_log_assistant_visit_contribution',
        rpcName: 'rpc_service_log_assistant_visit_contribution',
        visitId: input.visitId,
        keptPhotoPaths: input.keptPhotoPaths,
        newPhotoFiles: input.newPhotoFiles,
        pinnedSessionSnapshot: input.pinnedSessionSnapshot,
        buildPayload: (combinedPhotoPaths) => ({
          p_visit_id: input.visitId,
          p_note: input.note,
          p_photo_paths: combinedPhotoPaths,
          p_expected_visit_version: input.expectedVisitVersion,
          p_client_captured_at: input.clientCapturedAt ?? new Date().toISOString(),
        }),
      }),
    onSuccess: async () => {
      if (identityScope.latestRef.current.isAuthReady && identityScope.latestRef.current.identityKey) {
        await queryClient.invalidateQueries({ queryKey: ['field-services'] })
      }
    },
  })
}

export function useReviewServiceRequest() {
  return useIntentServiceMutation<{
    id: string
    decision: 'approve' | 'request_rework'
    note?: string | null
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:review:${input.id}`,
    operationType: 'service_review_request',
    rpcName: 'rpc_service_review_request',
    payload: {
      p_id: input.id,
      p_decision: input.decision,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useReportServiceToProvider() {
  return useIntentServiceMutation<{
    id: string
    note?: string | null
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:report:${input.id}`,
    operationType: 'service_report_to_provider',
    rpcName: 'rpc_service_report_to_provider',
    payload: {
      p_id: input.id,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useConfirmProviderHandoff() {
  return useIntentServiceMutation<{
    id: string
    decision: 'confirmed' | 'revisit_required'
    note?: string | null
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:handoff:${input.id}`,
    operationType: 'service_confirm_provider_handoff',
    rpcName: 'rpc_service_confirm_provider_handoff',
    payload: {
      p_id: input.id,
      p_decision: input.decision,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useRaiseUrgentFlag() {
  return useIntentServiceMutation<{
    serviceRequestId: string
    visitId?: string | null
    reasonCode: ServiceUrgentReasonCode
    summary: string
  }>((input) => ({
    intentKey: `service:urgent:raise:${input.serviceRequestId}:${input.visitId ?? 'req'}`,
    operationType: 'service_raise_urgent_flag',
    rpcName: 'rpc_service_raise_urgent_flag',
    payload: {
      p_service_request_id: input.serviceRequestId,
      p_visit_id: input.visitId ?? null,
      p_reason_code: input.reasonCode,
      p_summary: input.summary,
    },
  }))
}

export function useAckUrgentFlag() {
  return useIntentServiceMutation<{
    flagId: string
    note?: string | null
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:urgent:ack:${input.flagId}`,
    operationType: 'service_ack_urgent_flag',
    rpcName: 'rpc_service_ack_urgent_flag',
    payload: {
      p_flag_id: input.flagId,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
    },
  }))
}

export function useResolveUrgentFlag() {
  return useIntentServiceMutation<{
    flagId: string
    note?: string | null
    expectedVersion: number
  }>((input) => ({
    intentKey: `service:urgent:resolve:${input.flagId}`,
    operationType: 'service_resolve_urgent_flag',
    rpcName: 'rpc_service_resolve_urgent_flag',
    payload: {
      p_flag_id: input.flagId,
      p_note: input.note ?? null,
      p_expected_version: input.expectedVersion,
    },
  }))
}

/* ─── Batch 6 Monitor Queries, Urgent Queue & Email Delivery Recovery ─────── */

export function useServiceMonitorSnapshot(enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<ServiceMonitorSnapshot>({
    queryKey: ['field-services', 'monitor-snapshot', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_get_service_monitor_snapshot',
        undefined,
        serviceMonitorSnapshotSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading monitor snapshot.', 'AbortError')
      }
      return res
    },
  })
}

export function useServiceMonitorQueue({
  bucket = 'all',
  limit = 50,
  offset = 0,
  enabled = true,
}: {
  bucket?: ServiceMonitorBucket
  limit?: number
  offset?: number
  enabled?: boolean
} = {}) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<ServiceMonitorQueueResponse>({
    queryKey: [
      'field-services',
      'monitor-queue',
      { bucket, limit, offset },
      identityKey ?? 'anonymous',
      authEpoch,
    ],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_get_service_monitor_queue',
        { p_bucket: bucket, p_limit: limit, p_offset: offset },
        serviceMonitorQueueResponseSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading monitor queue.', 'AbortError')
      }
      return res
    },
  })
}

export type UrgentFlagQueueStatusFilter =
  | 'unresolved'
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'delivery_failed'
  | null

export function useServiceUrgentFlags({
  status = 'unresolved',
  limit = 25,
  offset = 0,
  enabled = true,
}: {
  status?: UrgentFlagQueueStatusFilter
  limit?: number
  offset?: number
  enabled?: boolean
} = {}) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()
  return useQuery<CoordinatorUrgentFlagsListResponse>({
    queryKey: [
      'field-services',
      'urgent-flags',
      { status, limit, offset },
      identityKey ?? 'anonymous',
      authEpoch,
    ],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_service_list_urgent_flags',
        { p_status: status, p_limit: limit, p_offset: offset },
        coordinatorUrgentFlagsListResponseSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading urgent flags.', 'AbortError')
      }
      return res
    },
  })
}

export function useRetryUrgentNotification() {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation<RetryUrgentDeliveryResult, Error, { flagId: string }>({
    mutationFn: async ({ flagId }) => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: identityScope.identityKey,
        authEpoch: identityScope.authEpoch,
        isReady: identityScope.isAuthReady,
      })
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
      const res = await callServiceReadRpc(
        'rpc_retry_urgent_notification_delivery',
        { p_flag_id: flagId },
        retryUrgentDeliveryResultSchema,
      )
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
      return res
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['field-services'] })
    },
  })
}

export function useReissueUrgentNotification() {
  const queryClient = useQueryClient()
  const identityScope = useIdentityScope()

  return useMutation<
    ReissueUrgentDeliveryResult,
    Error,
    { flagId: string; confirmDuplicateRisk: boolean; reason: string }
  >({
    mutationFn: async ({ flagId, confirmDuplicateRisk, reason }) => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: identityScope.identityKey,
        authEpoch: identityScope.authEpoch,
        isReady: identityScope.isAuthReady,
      })
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
      const res = await callServiceReadRpc(
        'rpc_reissue_exhausted_urgent_notification_delivery',
        {
          p_flag_id: flagId,
          p_confirm_duplicate_risk: confirmDuplicateRisk,
          p_reason: reason,
        },
        reissueUrgentDeliveryResultSchema,
      )
      assertProtectedSessionCurrent(snapshot, identityScope.latestRef.current)
      return res
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['field-services'] })
    },
  })
}

export interface ServiceActivityCounts {
  fromDate: string
  toDate: string
  label: string
  submittedCount: number
  visitsCompletedCount: number
  providerConfirmedCount: number
}

export interface ServiceActivitySummary {
  today: string
  yesterday: ServiceActivityCounts
  last7Days: ServiceActivityCounts
}

function formatShortIsoDay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0))
  return new Intl.DateTimeFormat('en-UG', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(date)
}

export function formatServiceActivitySummary(
  response: ServiceActivitySummaryResponse,
): ServiceActivitySummary {
  return {
    today: response.today,
    yesterday: {
      fromDate: response.yesterday.from_date,
      toDate: response.yesterday.to_date,
      label: formatShortIsoDay(response.yesterday.from_date),
      submittedCount: response.yesterday.submitted_count,
      visitsCompletedCount: response.yesterday.visits_completed_count,
      providerConfirmedCount: response.yesterday.provider_confirmed_count,
    },
    last7Days: {
      fromDate: response.last_7_days.from_date,
      toDate: response.last_7_days.to_date,
      label: `${formatShortIsoDay(response.last_7_days.from_date)} – ${formatShortIsoDay(response.last_7_days.to_date)}`,
      submittedCount: response.last_7_days.submitted_count,
      visitsCompletedCount: response.last_7_days.visits_completed_count,
      providerConfirmedCount: response.last_7_days.provider_confirmed_count,
    },
  }
}

export function useServiceActivityWindow(enabled = true) {
  const { identityKey, authEpoch, isAuthReady, latestRef } = useIdentityScope()

  return useQuery<ServiceActivitySummary>({
    queryKey: ['field-services', 'activity-summary', identityKey ?? 'anonymous', authEpoch],
    enabled: enabled && isAuthReady && Boolean(identityKey),
    retry: (failureCount, error) =>
      classifyServiceRpcError(error) === 'uncertain' && failureCount < 1,
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }
      const res = await callServiceReadRpc(
        'rpc_service_get_activity_summary',
        undefined,
        serviceActivitySummaryResponseSchema,
      )
      const latest = latestRef.current
      if (!latest.isAuthReady || latest.identityKey !== identityKey || latest.authEpoch !== authEpoch) {
        throw new DOMException('Account session changed while loading service activity.', 'AbortError')
      }
      return formatServiceActivitySummary(res)
    },
  })
}
