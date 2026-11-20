import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  createPendingOperationStore,
  executeIdempotentOperation,
  type IdentityScopeRef,
  type PendingOperationRecord,
  type ProtectedSessionSnapshot,
  UncertainTransportError,
  useProtectedIdentityScope,
} from '@/lib/idempotency/pendingOperations'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'

const number = z.coerce.number().finite()
const allocation = z.object({ leave_date: z.string(), days: number })
export const leaveRequestSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  employee_name: z.string(),
  leave_type_id: z.string().uuid(),
  leave_type_name: z.string(),
  leave_type_code: z.string(),
  requires_evidence: z.boolean(),
  start_date: z.string(),
  end_date: z.string(),
  day_portion: z.enum(['full', 'morning', 'afternoon', 'exact']),
  total_days: number,
  requested_minutes: number.nullable(),
  scheduled_minutes: number.nullable(),
  exact_start_at: z.string().nullable(),
  exact_end_at: z.string().nullable(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'cancelled']),
  source: z.string(),
  created_at: z.string(),
  allocations: z.array(allocation).nullable(),
})
const typeSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  is_paid: z.boolean(),
  default_entitlement_days: number.nullable(),
  requires_evidence: z.boolean(),
})
export const workspaceSchema = z.object({
  employee_id: z.string().nullable(),
  gender: z.string().nullable(),
  year: number,
  employees: z.array(z.object({ id: z.string(), name: z.string(), gender: z.string().nullable() })),
  request_total: number,
  summary: z.object({ total: number, pending: number, approved: number, on_leave_today: number }),
  requests: z.array(leaveRequestSchema),
  types: z.array(typeSchema),
  balances: z.array(
    z.object({
      leave_type_id: z.string(),
      name: z.string(),
      code: z.string(),
      entitled_days: number.nullable(),
      adjustment_days: number,
      used_days: number,
      pending_days: number,
      available_days: number.nullable(),
    }),
  ),
  holidays: z.array(
    z.object({
      id: z.string(),
      holiday_date: z.string(),
      name: z.string(),
      is_active: z.boolean(),
    }),
  ),
})
const detailSchema = z.object({
  documents: z.array(
    z.object({
      id: z.string(),
      storage_path: z.string(),
      original_file_name: z.string(),
      mime_type: z.string(),
      size_bytes: number,
      created_at: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      event_type: z.string(),
      reason: z.string().nullable(),
      actor_name: z.string().nullable(),
      occurred_at: z.string(),
    }),
  ),
})
export const previewSchema = z.object({
  allocations: z.array(allocation),
  schedule: z.object({
    is_workday: z.boolean(),
    timezone: z.string(),
    start_at: z.string().nullable(),
    end_at: z.string().nullable(),
    local_end: z.string().nullable(),
    scheduled_minutes: number.nullable(),
  }),
})
const envelopeSchema = z.object({
  request_id: z.string().uuid(),
  replayed: z.boolean(),
  result: z.object({
    id: z.string().uuid().optional(),
    sent: number.optional(),
    skipped: number.optional(),
  }),
})
export type LeaveWorkspace = z.infer<typeof workspaceSchema>
export type LeaveRequest = z.infer<typeof leaveRequestSchema>
export type LeaveDetail = z.infer<typeof detailSchema>
export type LeavePreview = z.infer<typeof previewSchema>
export type LeaveAction =
  | 'submit'
  | 'log'
  | 'approve'
  | 'reject'
  | 'withdraw'
  | 'cancel'
  | 'attach'
  | 'remove_document'
  | 'adjust'
  | 'entitlement'
  | 'type'
  | 'holiday'
  | 'reminders'
export const leavePendingStore = createPendingOperationStore<LeaveAction>({
  storagePrefix: 'onehub.leave.pending.',
  defaultIntentKey: 'leave:command',
  formatLabel: (action) => `Leave ${action.replaceAll('_', ' ')}`,
})
export type LeaveOperation = PendingOperationRecord<LeaveAction>

export async function leaveRpc(name: string, args: Record<string, unknown>) {
  const response = await getSupabaseClient().rpc(name, args)
  if (response.error) throw Object.assign(new Error(response.error.message), response.error)
  const data: unknown = response.data
  return data
}
export function useLeaveWorkspace(
  manage: boolean,
  employeeId: string,
  year: number,
  filters: { offset?: number; status?: string; search?: string; request?: string | null } = {},
) {
  const scope = useProtectedIdentityScope(useAuth())
  return useQuery({
    queryKey: [
      'leave',
      scope.identityKey,
      scope.authEpoch,
      'workspace',
      manage,
      employeeId,
      year,
      filters,
    ],
    enabled: scope.isAuthReady,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === scope.identityKey && query.queryKey[2] === scope.authEpoch
        ? previous
        : undefined,
    queryFn: async () => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: scope.identityKey,
        authEpoch: scope.authEpoch,
        isReady: scope.isAuthReady,
      })
      const data = await leaveRpc('rpc_leave_workspace', {
        p_manage: manage,
        p_employee_id: manage && employeeId ? employeeId : null,
        p_year: year,
        p_filter: {
          ...filters,
          request: z.string().uuid().safeParse(filters.request).success ? filters.request : null,
        },
      })
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      return workspaceSchema.parse(data)
    },
  })
}
export function useLeaveDetail(requestId: string | null) {
  const scope = useProtectedIdentityScope(useAuth())
  return useQuery({
    queryKey: ['leave', scope.identityKey, scope.authEpoch, 'detail', requestId],
    enabled: scope.isAuthReady && Boolean(requestId),
    queryFn: async () => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: scope.identityKey,
        authEpoch: scope.authEpoch,
        isReady: scope.isAuthReady,
      })
      const data = await leaveRpc('rpc_leave_detail', { p_request_id: requestId })
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      return detailSchema.parse(data)
    },
  })
}
export async function runLeaveCommand(
  scope: IdentityScopeRef,
  action: LeaveAction,
  payload: Record<string, unknown>,
  retry?: LeaveOperation,
  pinned?: ProtectedSessionSnapshot,
) {
  return executeIdempotentOperation({
    store: leavePendingStore,
    identityScope: scope,
    intentKey: 'leave:command',
    operationType: action,
    rpcName: 'rpc_leave_execute',
    payloadWithoutRequestId: { p_action: action, p_payload: payload },
    retryingOperation: retry,
    pinnedSessionSnapshot: pinned,
    invokeRpc: async (name, args) => {
      const raw = await leaveRpc(name, args)
      const parsed = envelopeSchema.safeParse(raw)
      if (
        !parsed.success || parsed.data.request_id !== args.p_request_id ||
        (['submit', 'log', 'attach', 'adjust'].includes(String(args.p_action)) &&
          !parsed.data.result.id) ||
        (args.p_action === 'reminders' &&
          (!Number.isInteger(parsed.data.result.sent) ||
            !Number.isInteger(parsed.data.result.skipped) || (parsed.data.result.sent ?? -1) < 0 ||
            (parsed.data.result.skipped ?? -1) < 0))
      ) {
        throw new UncertainTransportError(
          'The confirmation could not be verified. Retry the saved action to check its result.',
        )
      }
      return parsed.data
    },
  })
}
export function useLeaveCommand() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const client = useQueryClient()
  const pending = leavePendingStore.useOperations(auth)
  const mutation = useMutation({
    mutationFn: (
      { action, payload, retry, pinned }: {
        action: LeaveAction
        payload: Record<string, unknown>
        retry?: LeaveOperation
        pinned?: ProtectedSessionSnapshot
      },
    ) => runLeaveCommand(scope, action, payload, retry, pinned),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['leave'] })
      await client.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
  return { ...mutation, scope, pending }
}

// The snapshot is captured BEFORE signature inspection. A logout/account switch
// during any preparation or upload cannot adopt the old file into a new account.
export async function uploadLeaveEvidence(
  scope: IdentityScopeRef,
  requestId: string,
  file: File,
  snapshot?: ProtectedSessionSnapshot,
) {
  const pinned = snapshot ??
    captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
  assertProtectedSessionCurrent(pinned, scope.latestRef.current)
  const policy = await validatePrivateFileForUpload(file)
  assertProtectedSessionCurrent(pinned, scope.latestRef.current)
  if (!policy.ok) throw new Error('Choose a genuine PDF or supported image, no larger than 10 MB.')
  if (leavePendingStore.readByIntent(pinned.identityKey, 'leave:command')) {
    throw new Error('Resolve the saved leave action before uploading another document.')
  }
  const path = createPrivateObjectPath({
    ownerId: pinned.identityKey!,
    category: 'leave-evidence',
    recordId: requestId,
    extension: policy.extension,
  })
  const storage = getSupabaseClient().storage.from('private-files')
  const uploaded = await storage.upload(path, file, { contentType: file.type, upsert: false })
  assertProtectedSessionCurrent(pinned, scope.latestRef.current)
  if (uploaded.error) {
    throw new Error('The document could not be uploaded. Check the connection and try again.')
  }
  // A timeout after metadata submission retains the private object and frozen
  // command for reconciliation. Never delete a potentially committed attachment.
  return runLeaveCommand(
    scope,
    'attach',
    {
      id: requestId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    },
    undefined,
    pinned,
  )
}
export async function downloadLeaveEvidence(scope: IdentityScopeRef, path: string) {
  const pinned = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  assertProtectedSessionCurrent(pinned, scope.latestRef.current)
  const url = await createPrivateDownloadUrl(path, {
    allowedOrigin: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
    createSignedUrl: (objectPath, expiry) =>
      getSupabaseClient().storage.from('private-files').createSignedUrl(objectPath, expiry),
  })
  assertProtectedSessionCurrent(pinned, scope.latestRef.current)
  return url
}
export function useLeavePreview(
  employeeId: string,
  start: string,
  end: string,
  portion: string,
  leaving: string,
  enabled: boolean,
) {
  const scope = useProtectedIdentityScope(useAuth())
  return useQuery({
    queryKey: [
      'leave',
      scope.identityKey,
      scope.authEpoch,
      'preview',
      employeeId,
      start,
      end,
      portion,
      leaving,
    ],
    enabled: scope.isAuthReady && enabled,
    retry: false,
    queryFn: async () => {
      const snapshot = captureProtectedSessionSnapshot({
        identityKey: scope.identityKey,
        authEpoch: scope.authEpoch,
        isReady: scope.isAuthReady,
      })
      const raw = await leaveRpc('rpc_leave_preview', {
        p_employee_id: employeeId,
        p_start_date: start,
        p_end_date: end,
        p_day_portion: portion,
        p_leaving_time: leaving || null,
      })
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      return previewSchema.parse(raw)
    },
  })
}
