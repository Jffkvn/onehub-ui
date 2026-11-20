import { z } from 'zod'

import { assertProtectedSessionCurrent, captureProtectedSessionSnapshot, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const money = z.union([z.number(), z.string().regex(/^\d+(?:\.\d{1,2})?$/).transform(Number)]).pipe(z.number().positive().finite())
const day = z.string().date()
const receiptMime = z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export const cashReceiptAccept = receiptMime.options.join(',')

const expenseRow = z.object({
  id: uuid,
  cash_advance_id: uuid,
  expense_date: day,
  category: z.string(),
  amount: money,
  vendor: z.string(),
  explanation: z.string(),
  receipt_url: z.string().nullable(),
  receipt_unavailable: z.boolean(),
  receipt_unavailable_explanation: z.string().nullable(),
  status: z.enum(['pending_review', 'accepted', 'rejected', 'reversed']),
  rejection_reason: z.string().nullable(),
  reversal_reason: z.string().nullable(),
})

const returnRow = z.object({
  id: uuid,
  cash_advance_id: uuid,
  return_date: day,
  amount: money,
  receipt_reference: z.string(),
  notes: z.string().nullable(),
  reversed_at: z.string().nullable(),
  reversal_reason: z.string().nullable(),
})

export type CashExpense = z.infer<typeof expenseRow>
export type CashReturn = z.infer<typeof returnRow>

interface ExpenseInput {
  date: string
  category: string
  amount: number
  vendor: string
  explanation: string
  file: File | null
  missingReason: string | null
}

interface ReturnInput {
  date: string
  amount: number
  reference: string
  notes: string | null
}

export class UnconfirmedLedgerChange extends Error {
  constructor() {
    super('The ledger change could not be confirmed. Reload the advance and check its entries before submitting again.')
    this.name = 'UnconfirmedLedgerChange'
  }
}

function pinSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  const check = () => {
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    if (snapshot.identityKey !== scope.identityKey) {
      throw new DOMException('The active account changed.', 'AbortError')
    }
  }
  check()
  return check
}

function matchesReceipt(path: string, advanceId: string, recipientId: string) {
  const [owner, category, record, filename, ...extra] = path.split('/')
  return !extra.length && owner === recipientId && category === 'cash-receipts'
    && record === advanceId && /\.(pdf|jpe?g|png|webp)$/i.test(filename ?? '')
}

const safeLedgerErrors: Record<string, string> = {
  '42501': 'You do not have permission to make this change.',
  '22023': 'Check the amount, required details and available advance balance.',
  '23514': 'The server rejected the submitted details. Check the advance and try again.',
  L0003: 'Expenses can only be added to a disbursed advance.',
  L0004: 'This expense has already been reviewed. Check the updated ledger.',
  L0005: 'Returned cash can only be recorded for a disbursed advance.',
  P0002: 'The advance or expense is no longer available.',
  V0001: 'Provide a valid receipt or explain why the receipt is unavailable.',
}

async function writeLedger(check: () => void, name: string, args: Record<string, string | number | boolean | null>, returnsId = false) {
  check()
  const result = await getSupabaseClient().rpc(name, args).then(
    (response) => response,
    () => null,
  )
  check()

  if (!result || result.status === 0 || result.status >= 500) throw new UnconfirmedLedgerChange()
  if (result.error) {
    const message = safeLedgerErrors[result.error.code]
    if (message) throw new Error(message)
    throw new UnconfirmedLedgerChange()
  }
  if (returnsId && !uuid.safeParse(result.data).success) throw new UnconfirmedLedgerChange()
}

export async function readCashAccountability(scope: IdentityScopeRef, advanceId: string) {
  const check = pinSession(scope)
  const client = getSupabaseClient()
  const id = uuid.parse(advanceId)

  const [expenses, returns] = await Promise.all([
    client.from('cash_advance_expenses')
      .select('id,cash_advance_id,expense_date,category,amount,vendor,explanation,receipt_url,receipt_unavailable,receipt_unavailable_explanation,status,rejection_reason,reversal_reason')
      .eq('cash_advance_id', id).order('expense_date', { ascending: false }),
    client.from('cash_advance_returns')
      .select('id,cash_advance_id,return_date,amount,receipt_reference,notes,reversed_at,reversal_reason')
      .eq('cash_advance_id', id).order('return_date', { ascending: false }),
  ])

  check()
  if (expenses.error || returns.error) throw new Error('The accountability ledger could not be loaded.')
  return {
    expenses: expenseRow.array().parse(expenses.data).filter((entry) => entry.cash_advance_id === id),
    returns: returnRow.array().parse(returns.data).filter((entry) => entry.cash_advance_id === id),
  }
}

export async function submitCashExpense(scope: IdentityScopeRef, advanceId: string, recipientId: string, input: ExpenseInput) {
  const check = pinSession(scope)
  if (scope.identityKey !== recipientId) throw new Error('Only the recipient can submit an expense.')

  const id = uuid.parse(advanceId)
  const date = day.parse(input.date)
  const amount = money.parse(input.amount)
  const storage = getSupabaseClient().storage.from('private-files')
  let path: string | null = null

  if (input.missingReason === null) {
    const file = input.file
    const mime = receiptMime.safeParse(file?.type.toLowerCase())
    const validation = (file && mime.success) ? await validatePrivateFileForUpload(file) : null
    check()
    if (!file || !mime.success || !validation?.ok) {
      throw new Error('Choose a valid PDF, JPG, PNG or WebP receipt up to 10 MB.')
    }

    path = createPrivateObjectPath({ ownerId: recipientId, category: 'cash-receipts', recordId: id, extension: validation.extension })
    const uploaded = await storage.upload(path, file, { contentType: mime.data, upsert: false }).catch(() => null)
    check()
    if (!uploaded || uploaded.error) {
      throw new Error('The receipt upload could not be confirmed. Check your connection and try again.')
    }
  }

  try {
    await writeLedger(check, 'rpc_submit_cash_expense', {
      p_advance_id: id,
      p_date: date,
      p_category: input.category,
      p_amount: amount,
      p_vendor: input.vendor,
      p_explanation: input.explanation,
      p_receipt_url: path,
      p_receipt_unavailable: input.missingReason !== null,
      p_receipt_unavailable_explanation: input.missingReason,
    }, true)
  } catch (error) {
    check()
    if (path && !(error instanceof UnconfirmedLedgerChange)) {
      await storage.remove([path]).catch(() => null)
      check()
    }
    throw error
  }
}

export async function reviewCashExpense(scope: IdentityScopeRef, expenseId: string, accept: boolean, rejectionReason: string | null) {
  await writeLedger(pinSession(scope), 'rpc_review_cash_expense', {
    p_expense_id: uuid.parse(expenseId),
    p_accept: accept,
    p_rejection_reason: rejectionReason,
  })
}

export async function recordCashReturn(scope: IdentityScopeRef, advanceId: string, input: ReturnInput) {
  await writeLedger(pinSession(scope), 'rpc_return_cash', {
    p_advance_id: uuid.parse(advanceId),
    p_date: day.parse(input.date),
    p_amount: money.parse(input.amount),
    p_reference: input.reference,
    p_notes: input.notes,
  }, true)
}

export async function openCashReceipt(scope: IdentityScopeRef, path: string, advanceId: string, recipientId: string) {
  const check = pinSession(scope)
  if (!matchesReceipt(path, advanceId, recipientId)) throw new Error('The receipt path does not match this advance.')
  const url = await createPrivateDownloadUrl(path, {
    allowedOrigin: new URL(import.meta.env.VITE_SUPABASE_URL).origin,
    createSignedUrl: (objectPath, expiresIn) =>
      getSupabaseClient().storage.from('private-files').createSignedUrl(objectPath, expiresIn),
  })
  check()
  return url
}
