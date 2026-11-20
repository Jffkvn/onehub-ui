import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

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
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/modules/auth/AuthProvider'

const number = z.coerce.number().finite()
const advanceSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  employee_name: z.string(),
  employee_number: z.string().optional(),
  amount: number,
  reason: z.string(),
  date_issued: z.string(),
  deduction_start_month: z.string(),
  num_instalments: number,
  monthly_deduction: number,
  balance_remaining: number,
  status: z.enum(['pending', 'active', 'paid_off', 'rejected', 'written_off', 'flagged', 'voided']),
  notes: z.string().nullable(),
})
const eventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  amount: number.nullable(),
  reason: z.string().nullable(),
  occurred_at: z.string(),
})
const employeeSchema = z.object({
  id: z.string().uuid(),
  legal_name: z.string(),
  employee_number: z.string(),
})
const confirmationSchema = z.object({ request_id: z.string().uuid(), result_id: z.string().uuid() })

export type StaffAdvance = z.infer<typeof advanceSchema>
export type AdvanceAction = 'submit' | 'log' | 'decide' | 'repay' | 'transition'
type SavedAction = PendingOperationRecord<AdvanceAction>

export const advancePendingStore = createPendingOperationStore<AdvanceAction>({
  storagePrefix: 'onehub.staff-advances.pending.',
  defaultIntentKey: 'staff-advance:command',
  formatLabel: (action) => action === 'repay' ? 'Staff advance repayment' : 'Staff advance update',
})

async function advanceRpc(name: string, args?: Record<string, unknown>) {
  const response = await getSupabaseClient().rpc(name, args)
  if (response.error) throw Object.assign(new Error(response.error.message), response.error)
  const data: unknown = response.data
  return data
}

function advanceKey(scope: IdentityScopeRef) {
  return ['staff-advances', scope.identityKey, scope.authEpoch]
}

async function readForSession<T>(scope: IdentityScopeRef, read: () => Promise<T>) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  const data = await read()
  assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  return data
}

export function useAdvances(scope: IdentityScopeRef, manage: boolean) {
  return useQuery({
    queryKey: [...advanceKey(scope), 'list', manage],
    enabled: scope.isAuthReady,
    queryFn: () => readForSession(scope, async () => advanceSchema.array().parse(
      await advanceRpc(manage ? 'rpc_list_hr_staff_advances' : 'rpc_list_my_staff_advances'),
    )),
  })
}

export function useAdvanceHistory(scope: IdentityScopeRef, id: string | undefined, manage: boolean) {
  return useQuery({
    queryKey: [...advanceKey(scope), 'events', id, manage],
    enabled: scope.isAuthReady && Boolean(id),
    queryFn: () => readForSession(scope, async () => eventSchema.array().parse(
      await advanceRpc('rpc_list_staff_advance_events', { p_advance_id: id }),
    )),
  })
}

export function useAdvanceEmployees(scope: IdentityScopeRef, enabled: boolean) {
  return useQuery({
    queryKey: [...advanceKey(scope), 'employees'],
    enabled: scope.isAuthReady && enabled,
    queryFn: () => readForSession(scope, async () => {
      const { data, error } = await getSupabaseClient().from('employees')
        .select('id,legal_name,employee_number')
        .is('archived_at', null)
        .order('legal_name')
      if (error) throw new Error(error.message)
      return employeeSchema.array().parse(data)
    }),
  })
}

export function useAdvanceCommand() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const pending = advancePendingStore.useOperations(auth)[0]
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ action, payload, retry, snapshot }: {
      action: AdvanceAction
      payload: Record<string, unknown>
      retry?: SavedAction
      snapshot: ProtectedSessionSnapshot
    }) => executeIdempotentOperation({
      store: advancePendingStore,
      identityScope: scope,
      intentKey: 'staff-advance:command',
      operationType: action,
      rpcName: 'rpc_execute_staff_advance',
      payloadWithoutRequestId: { p_action: action, p_payload: payload },
      retryingOperation: retry,
      pinnedSessionSnapshot: snapshot,
      invokeRpc: async (name, args) => {
        const parsed = confirmationSchema.safeParse(await advanceRpc(name, args))
        if (!parsed.success || parsed.data.request_id !== args.p_request_id) {
          throw new UncertainTransportError('The confirmation could not be verified. Retry the saved action.')
        }
        return parsed.data
      },
    }),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: advanceKey(scope) }),
      client.invalidateQueries({ queryKey: ['notifications'] }),
    ]),
  })
  return { ...mutation, scope, pending }
}
