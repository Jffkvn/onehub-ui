import { z } from 'zod'

import {
  assertProtectedSessionCurrent, captureProtectedSessionSnapshot, type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

export const cashStatuses = ['pending_approval', 'approved', 'disbursed', 'completed', 'rejected'] as const

const id = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const money = z.union([z.number(), z.string().trim().min(1).pipe(z.coerce.number())]).pipe(z.number().finite())
const name = z.object({ display_name: z.string() }).nullish()

const advance = z.object({
  id,
  project_id: id,
  user_id: id,
  entered_by: id,
  purpose: z.string(),
  status: z.enum(cashStatuses),
  requested_at: timestamp,
  amount_requested: money,
  amount_disbursed: money.nullish(),
  approved_at: timestamp.nullish(),
  disbursed_at: timestamp.nullish(),
  disbursement_reference: z.string().nullish(),
  closed_at: timestamp.nullish(),
  override_reason: z.string().nullish(),
  requester_role: z.string().nullish(),
  projects: z.object({ name: z.string() }).nullish(),
  profiles_user: name,
  profiles_entered_by: name,
  profiles_approved_by: name,
  profiles_disbursed_by: name,
  profiles_closed_by: name,
})

const project = z.object({ id, name: z.string(), project_code: z.string() })
const recipient = z.object({ id, display_name: z.string() })

export type CashAdvance = z.infer<typeof advance>
export type CashStatus = CashAdvance['status']
export type CashRequestOption = z.infer<typeof project>

export class CashRequestUnconfirmed extends Error {
  constructor() {
    super('OneHub could not confirm the request. Close this form and check the request list before submitting again.')
    this.name = 'CashRequestUnconfirmed'
  }
}

export function cashKey(scope: IdentityScopeRef) {
  return ['project-cash', scope.identityKey, scope.authEpoch] as const
}

function pinSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey, authEpoch: scope.authEpoch, isReady: scope.isAuthReady,
  })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  return check
}

type Result = { data: unknown; error: { code?: string; message?: string } | null; status: number }

async function cashRpc(
  scope: IdentityScopeRef, command: string, args: Record<string, unknown>, write = false,
): Promise<unknown> {
  const check = pinSession(scope)
  let result: Result
  try {
    result = await getSupabaseClient().rpc(command, args)
  } catch {
    check()
    if (write) throw new CashRequestUnconfirmed()
    throw new Error('Project cash could not be loaded.')
  }
  check()

  if (!result.error) return result.data
  if (write && (result.status === 0 || result.status >= 500)) throw new CashRequestUnconfirmed()
  if (result.error.code === '42501') throw new Error('You do not have access to this project cash action.')
  if (result.error.code === '23514' || result.error.code === '22003') throw new Error('Check the request amount before submitting.')
  if (result.error.code === '23503') throw new Error('The selected project or recipient is no longer available.')
  throw new Error(write ? 'OneHub could not save the cash request.' : 'Project cash could not be loaded.')
}

export async function readCashAdvances(scope: IdentityScopeRef, advanceId: string | null = null) {
  const data = await cashRpc(scope, 'rpc_list_cash_advances', { p_request_id: id.nullable().parse(advanceId) })
  return advance.array().parse(data)
}

export async function readCashBalance(scope: IdentityScopeRef, advanceId: string) {
  return money.parse(await cashRpc(scope, 'get_cash_advance_balance', { p_advance_id: id.parse(advanceId) }))
}

export async function readOutstandingCash(scope: IdentityScopeRef, recipientId: string) {
  return z.boolean().parse(await cashRpc(scope, 'has_outstanding_advances', { p_user_id: id.parse(recipientId) }))
}

const requestableStatuses = ['planned', 'active', 'on_hold']
const optionPageSize = 500

type Page = { data: unknown; error: unknown }

async function readOptions<T>(
  scope: IdentityScopeRef, signal: AbortSignal, read: (first: number, last: number) => PromiseLike<Page>,
  schema: z.ZodType<T>,
) {
  const check = pinSession(scope)
  const result: T[] = []

  for (let first = 0; ; first += optionPageSize) {
    signal.throwIfAborted()
    check()
    const { data, error } = await read(first, first + optionPageSize - 1)
    check()
    signal.throwIfAborted()
    if (error) throw new Error('Cash request options could not be loaded.')
    const page = schema.array().parse(data)
    result.push(...page)
    if (page.length < optionPageSize) return result
  }
}

export async function readCashRequestProjects(scope: IdentityScopeRef, canManage: boolean, signal: AbortSignal) {
  const client = getSupabaseClient()
  if (canManage) return readOptions(scope, signal, (first, last) => client.from('projects')
    .select('id,name,project_code').in('status', requestableStatuses)
    .order('name').order('id').range(first, last).abortSignal(signal), project)

  const assignments = await readOptions(scope, signal, (first, last) => client.from('project_assignments')
    .select('projects!inner(id,name,project_code)').eq('user_id', scope.identityKey ?? '').is('unassigned_at', null)
    .in('projects.status', requestableStatuses).order('id').range(first, last).abortSignal(signal), z.object({ projects: project }))
  return [...new Map(assignments.map(({ projects }) => [projects.id, projects])).values()]
    .sort((first, second) => first.name.localeCompare(second.name))
}

export function readCashRequestRecipients(scope: IdentityScopeRef, signal: AbortSignal) {
  return readOptions(scope, signal, (first, last) => getSupabaseClient().rpc('rpc_list_cash_request_recipients', {})
    .order('display_name').order('id').range(first, last).abortSignal(signal), recipient)
}

const cashRequest = z.object({
  projectId: id,
  recipientId: id,
  amount: z.number().finite().positive().max(9999999999999.99),
  purpose: z.string().trim().min(5).max(2000),
})

export async function submitCashRequest(scope: IdentityScopeRef, input: z.infer<typeof cashRequest>) {
  const { projectId, recipientId, amount, purpose } = cashRequest.parse(input)
  const result = await cashRpc(scope, 'rpc_request_cash_advance', {
    p_project_id: projectId, p_user_id: recipientId, p_amount: amount, p_purpose: purpose,
  }, true)
  const saved = id.safeParse(result)
  if (!saved.success) throw new CashRequestUnconfirmed()
  return saved.data
}
