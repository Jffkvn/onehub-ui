import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  classifyRpcError,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

const decimal = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/
const ledgerAmount = z.union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d{1,2})?$/)]).transform(Number)
const requestRow = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  amount_requested: ledgerAmount,
  status: z.string(),
})

export type CashFinanceAction =
  | { kind: 'approve'; overrideReason: string }
  | { kind: 'reject' }
  | { kind: 'disburse'; amount: number; reference: string }
  | { kind: 'close' }

type RpcResult = { data: unknown; error: { code?: string } | null; status: number }

const expectedStatus = {
  approve: 'pending_approval',
  reject: 'pending_approval',
  disburse: 'approved',
  close: 'disbursed',
} as const

export class CashFinanceOutcomeUnknown extends Error {
  constructor() {
    super('OneHub could not confirm the action. Refresh the advance and check its status before submitting again.')
    this.name = 'CashFinanceOutcomeUnknown'
  }
}

export class CashFinanceStatusChanged extends Error {
  constructor() {
    super('This advance changed. Refresh it before taking another finance action.')
    this.name = 'CashFinanceStatusChanged'
  }
}

export function parseCashFinanceAmount(value: string): number | null {
  const input = value.trim()
  if (!decimal.test(input)) return null
  const amount = Number(input)
  // The cash ledger uses numeric(15,2).
  return amount > 0 && amount < 10_000_000_000_000 ? amount : null
}

function sessionGuard(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  check()
  return check
}

async function readRpc(
  client: ReturnType<typeof getSupabaseClient>,
  check: () => void,
  name: string,
  args: Record<string, unknown>,
  failureMessage: string,
): Promise<unknown> {
  check()
  let result: RpcResult
  try {
    result = await client.rpc(name, args)
  } catch {
    check()
    throw new Error(failureMessage)
  }
  check()
  if (result.error) throw new Error(failureMessage)
  return result.data
}

async function readOutstanding(client: ReturnType<typeof getSupabaseClient>, check: () => void, recipientId: string) {
  const message = 'Could not verify outstanding advances for the recipient.'
  const result = await readRpc(client, check, 'has_outstanding_advances', { p_user_id: recipientId }, message)
  if (typeof result !== 'boolean') throw new Error(message)
  return result
}

async function readClosure(client: ReturnType<typeof getSupabaseClient>, check: () => void, advanceId: string) {
  const message = 'Could not verify the ledger balance and pending expenses.'
  check()

  try {
    const [balance, result] = await Promise.all([
      readRpc(client, check, 'get_cash_advance_balance', { p_advance_id: advanceId }, message),
      client.from('cash_advance_expenses').select('id', { count: 'exact', head: true })
        .eq('cash_advance_id', advanceId).eq('status', 'pending_review'),
    ])
    check()
    const parsed = ledgerAmount.safeParse(balance)
    const count = result.count
    if (!parsed.success || result.error || count === null || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(message)
    }
    return { balance: parsed.data, pendingCount: count }
  } catch {
    check()
    throw new Error(message)
  }
}

export function checkCashFinanceOutstanding(scope: IdentityScopeRef, recipientId: string) {
  const check = sessionGuard(scope)
  return readOutstanding(getSupabaseClient(), check, recipientId)
}

export function readCashFinanceClosure(scope: IdentityScopeRef, advanceId: string) {
  const check = sessionGuard(scope)
  return readClosure(getSupabaseClient(), check, advanceId)
}

async function mutateFinance(
  client: ReturnType<typeof getSupabaseClient>,
  check: () => void,
  name: string,
  args: Record<string, unknown>,
) {
  check()
  let result: RpcResult
  try {
    result = await client.rpc(name, args)
  } catch {
    check()
    throw new CashFinanceOutcomeUnknown()
  }
  check()
  if (!result.error) return

  const { code } = result.error
  if (code === '42501') throw new Error('You do not have permission for this finance action.')
  if (code === 'W0001') {
    throw new Error('The recipient now has an outstanding cash advance. Enter an override reason to continue.')
  }
  if (code === 'B0001') throw new Error('Resolve the outstanding balance before closing this advance.')
  if (code === 'B0002') throw new Error('Review all pending expenses before closing this advance.')
  if (code === 'P0002' || code === 'L0001' || code === 'L0002' || code === 'L0006') {
    throw new CashFinanceStatusChanged()
  }
  if (classifyRpcError({ ...result.error, status: result.status }) === 'uncertain') {
    throw new CashFinanceOutcomeUnknown()
  }
  throw new Error('OneHub could not save this finance action. Check the details and try again.')
}

export async function writeCashFinanceAction(
  scope: IdentityScopeRef,
  advanceId: string,
  recipientId: string,
  action: CashFinanceAction,
) {
  const check = sessionGuard(scope)
  const client = getSupabaseClient()
  const result = await readRpc(client, check, 'rpc_list_cash_advances', { p_request_id: advanceId }, 'Could not verify the current advance.')
  const rows = requestRow.array().safeParse(result)
  if (!rows.success) throw new Error('Could not verify the current advance.')
  const request = rows.data.find((row) => row.id === advanceId && row.user_id === recipientId)
  if (!request || request.status !== expectedStatus[action.kind]) throw new CashFinanceStatusChanged()

  const base = { p_advance_id: advanceId }
  switch (action.kind) {
    case 'approve': {
      const outstanding = await readOutstanding(client, check, recipientId)
      const reason = action.overrideReason.trim()
      if (outstanding && !reason) {
        throw new Error('The recipient now has an outstanding cash advance. Enter an override reason to continue.')
      }
      return mutateFinance(client, check, 'rpc_approve_cash_advance', {
        ...base, p_override_reason: outstanding ? reason : null,
      })
    }
    case 'reject':
      return mutateFinance(client, check, 'rpc_reject_cash_advance', base)
    case 'disburse': {
      const reference = action.reference.trim()
      const amount = parseCashFinanceAmount(String(action.amount))
      if (amount === null || amount > request.amount_requested || !reference) {
        throw new Error('Enter a positive amount up to the requested amount and a payment reference.')
      }
      return mutateFinance(client, check, 'rpc_disburse_cash_advance', { ...base, p_amount: amount, p_reference: reference })
    }
    case 'close': {
      const closure = await readClosure(client, check, advanceId)
      if (closure.balance !== 0 || closure.pendingCount !== 0) {
        throw new Error('Resolve the balance and any pending expenses before closing this advance.')
      }
      return mutateFinance(client, check, 'rpc_close_cash_advance', base)
    }
  }
}
