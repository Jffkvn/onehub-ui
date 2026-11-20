import { z } from 'zod'
import { validatePrivateFileForUpload } from '@/lib/security/filePolicy'
import { createPrivateDownloadUrl, createPrivateObjectPath } from '@/lib/security/privateFiles'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const num = z.coerce.number().finite()

export const REIMBURSEMENT_CATEGORIES = [
  { value: 'travel', label: 'Travel' },
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'meals', label: 'Meals' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'training', label: 'Training' },
  { value: 'airtime', label: 'Airtime / Data' },
  { value: 'medical', label: 'Medical' },
  { value: 'other', label: 'Other' },
] as const

export const REIMBURSEMENT_CURRENCIES = ['UGX', 'USD'] as const
export const REIMBURSEMENT_STATUSES = [
  'pending',
  'needs_information',
  'approved',
  'rejected',
  'paid',
  'withdrawn',
] as const
export const REIMBURSEMENT_PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'cash', label: 'Cash' },
] as const

export type ReimbursementCategory = (typeof REIMBURSEMENT_CATEGORIES)[number]['value']
export type ReimbursementCurrency = (typeof REIMBURSEMENT_CURRENCIES)[number]
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number]
export type ReimbursementPaymentMethod = (typeof REIMBURSEMENT_PAYMENT_METHODS)[number]['value']

export const reimbursementReceiptSchema = z.object({
  id: uuid.optional(),
  storage_path: z.string(),
  original_file_name: z.string(),
  mime_type: z.string(),
  size_bytes: num.int().positive(),
})

export const reimbursementEventSchema = z.object({
  id: uuid,
  event_type: z.string(),
  from_status: z.string().nullable(),
  to_status: z.string(),
  note: z.string().nullable(),
  actor_name: z.string().nullable(),
  occurred_at: z.string(),
})

export const reimbursementClaimSchema = z.object({
  id: uuid,
  employee_id: uuid,
  employee_number: z.string(),
  employee_name: z.string(),
  is_own_claim: z.boolean().optional().default(false),
  can_self_handle: z.boolean().optional().default(false),
  category: z.enum(['travel', 'accommodation', 'meals', 'fuel', 'training', 'airtime', 'medical', 'other']),
  amount: num.positive(),
  currency_code: z.enum(REIMBURSEMENT_CURRENCIES),
  spent_on: z.string(),
  description: z.string(),
  status: z.enum(REIMBURSEMENT_STATUSES),
  reviewed_by: uuid.nullable(),
  reviewed_by_name: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  review_note: z.string().nullable(),
  paid_by: uuid.nullable(),
  paid_by_name: z.string().nullable(),
  paid_at: z.string().nullable(),
  payment_method: z.enum(['bank_transfer', 'mobile_money', 'cash']).nullable(),
  payment_reference: z.string().nullable(),
  created_at: z.string(),
  version: num.int().positive(),
  receipts: z.array(reimbursementReceiptSchema),
  events: z.array(reimbursementEventSchema),
})

export const reimbursementSummarySchema = z.object({
  pendingCount: num.int().nonnegative(),
  pendingAmountUgx: num.nonnegative(),
  approvedUnpaidCount: num.int().nonnegative(),
  approvedUnpaidAmountUgx: num.nonnegative(),
  needsInfoCount: num.int().nonnegative(),
  paidThisYearUgx: num.nonnegative(),
  paidCountThisYear: num.int().nonnegative(),
})

export const reimbursementListResponseSchema = z.object({
  linked: z.boolean(),
  summary: reimbursementSummarySchema.nullable(),
  items: z.array(reimbursementClaimSchema),
})

export type ReimbursementReceipt = z.infer<typeof reimbursementReceiptSchema>
export type ReimbursementEvent = z.infer<typeof reimbursementEventSchema>
export type ReimbursementClaim = z.infer<typeof reimbursementClaimSchema>
export type ReimbursementSummary = z.infer<typeof reimbursementSummarySchema>
export type ReimbursementListResponse = z.infer<typeof reimbursementListResponseSchema>

export interface ReceiptPayload {
  storage_path: string
  original_file_name: string
  mime_type: string
  size_bytes: number
}

export function todayKampalaIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function readableReimbursementError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'The reimbursement request could not be completed.'
  const code = 'code' in err && typeof err.code === 'string' ? err.code : ''
  const msg = 'message' in err && typeof err.message === 'string' ? err.message : ''
  if (code === '40001') {
    return 'This claim changed since you opened it. Refresh and review the latest version.'
  }
  if (code === '42501') {
    return 'You do not have permission for this reimbursement action.'
  }
  return msg || 'The reimbursement request could not be completed.'
}

const EXTENSION_TO_MIME: Record<
  'pdf' | 'jpg' | 'jpeg' | 'png' | 'webp' | 'heic' | 'heif' | 'avif',
  string
> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
}

async function uploadReceiptFiles(
  ownerProfileId: string,
  claimId: string,
  files: File[],
): Promise<ReceiptPayload[]> {
  if (files.length === 0) return []
  const storage = getSupabaseClient().storage.from('reimbursement-receipts')
  const uploaded: ReceiptPayload[] = []

  try {
    for (const file of files) {
      const check = await validatePrivateFileForUpload(file)
      if (!check.ok) {
        throw new Error(
          `${file.name}: choose a genuine PDF or image (JPEG, PNG, WebP, HEIC, AVIF) up to 10 MB.`,
        )
      }
      const verifiedMime = EXTENSION_TO_MIME[check.extension]
      const path = createPrivateObjectPath({
        ownerId: ownerProfileId,
        category: 'reimbursement-receipts',
        recordId: claimId,
        extension: check.extension,
      })
      const res = await storage.upload(path, file, {
        contentType: verifiedMime,
        upsert: false,
      })
      if (res.error) {
        throw new Error(`Could not upload "${file.name}".`)
      }
      uploaded.push({
        storage_path: path,
        original_file_name: file.name,
        mime_type: verifiedMime,
        size_bytes: file.size,
      })
    }
    return uploaded
  } catch (err) {
    if (uploaded.length > 0) {
      void storage.remove(uploaded.map((item) => item.storage_path))
    }
    throw err
  }
}

async function callReimbursementRpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const response = (await getSupabaseClient().rpc(name, args)) as {
    data: unknown
    error: unknown
  }
  if (response.error) throw new Error(readableReimbursementError(response.error))
  return response.data
}

export const reimbursementsApi = {
  async listClaims(manage: boolean, status?: ReimbursementStatus | null): Promise<ReimbursementListResponse> {
    const data = await callReimbursementRpc('rpc_list_reimbursement_claims', {
      p_manage: manage,
      p_status: status ?? null,
    })
    return reimbursementListResponseSchema.parse(data)
  },

  async submitClaim(input: {
    claimId: string
    ownerProfileId: string
    category: ReimbursementCategory
    amount: number
    currencyCode: ReimbursementCurrency
    spentOn: string
    description: string
    files: File[]
  }): Promise<string> {
    const newReceipts = await uploadReceiptFiles(input.ownerProfileId, input.claimId, input.files)
    const response = (await getSupabaseClient().rpc('rpc_submit_reimbursement_claim', {
      p_claim_id: input.claimId,
      p_category: input.category,
      p_amount: input.amount,
      p_currency_code: input.currencyCode,
      p_spent_on: input.spentOn,
      p_description: input.description.trim(),
      p_receipts: newReceipts,
    })) as { data: unknown; error: unknown }
    if (response.error) {
      if (newReceipts.length > 0) {
        void getSupabaseClient()
          .storage.from('reimbursement-receipts')
          .remove(newReceipts.map((r) => r.storage_path))
      }
      throw new Error(readableReimbursementError(response.error))
    }
    return uuid.parse(response.data)
  },

  async resubmitClaim(input: {
    claimId: string
    expectedVersion: number
    ownerProfileId: string
    category: ReimbursementCategory
    amount: number
    currencyCode: ReimbursementCurrency
    spentOn: string
    description: string
    keptReceipts: ReceiptPayload[]
    newFiles: File[]
  }): Promise<number> {
    const uploaded = await uploadReceiptFiles(input.ownerProfileId, input.claimId, input.newFiles)
    const allReceipts = [...input.keptReceipts, ...uploaded]
    const response = (await getSupabaseClient().rpc('rpc_resubmit_reimbursement_claim', {
      p_claim_id: input.claimId,
      p_expected_version: input.expectedVersion,
      p_category: input.category,
      p_amount: input.amount,
      p_currency_code: input.currencyCode,
      p_spent_on: input.spentOn,
      p_description: input.description.trim(),
      p_receipts: allReceipts,
    })) as { data: unknown; error: unknown }
    if (response.error) {
      if (uploaded.length > 0) {
        void getSupabaseClient()
          .storage.from('reimbursement-receipts')
          .remove(uploaded.map((r) => r.storage_path))
      }
      throw new Error(readableReimbursementError(response.error))
    }
    return Number(response.data)
  },

  async withdrawClaim(claimId: string, expectedVersion: number): Promise<void> {
    await callReimbursementRpc('rpc_withdraw_reimbursement_claim', {
      p_claim_id: claimId,
      p_expected_version: expectedVersion,
    })
  },

  async decideClaim(input: {
    claimId: string
    expectedVersion: number
    decision: 'approved' | 'needs_information' | 'rejected'
    note?: string | null
  }): Promise<number> {
    const data = await callReimbursementRpc('rpc_decide_reimbursement_claim', {
      p_claim_id: input.claimId,
      p_expected_version: input.expectedVersion,
      p_decision: input.decision,
      p_note: input.note?.trim() || null,
    })
    return Number(data)
  },

  async markPaid(input: {
    claimId: string
    expectedVersion: number
    paymentMethod: ReimbursementPaymentMethod
    paidAt: string
    paymentReference?: string | null
    selfPaymentNote?: string | null
  }): Promise<number> {
    const data = await callReimbursementRpc('rpc_mark_reimbursement_paid', {
      p_claim_id: input.claimId,
      p_expected_version: input.expectedVersion,
      p_payment_method: input.paymentMethod,
      p_paid_at: input.paidAt,
      p_payment_reference: input.paymentReference?.trim() || null,
      p_self_payment_note: input.selfPaymentNote?.trim() || null,
    })
    return Number(data)
  },

  async getReceiptDownloadUrl(storagePath: string): Promise<string> {
    const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
    if (!envUrl) throw new Error('Supabase URL is not configured.')
    return createPrivateDownloadUrl(storagePath, {
      allowedOrigin: new URL(envUrl).origin,
      createSignedUrl: (path, expiresIn) =>
        getSupabaseClient().storage.from('reimbursement-receipts').createSignedUrl(path, expiresIn),
    })
  },
}
