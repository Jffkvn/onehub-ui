import { z } from 'zod'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const num = z.coerce.number().finite()

export const POLICY_STATUSES = ['active', 'lapsed', 'cancelled'] as const
export type PolicyStatus = (typeof POLICY_STATUSES)[number]

export const DISPLAY_STATUSES = ['active', 'expired', 'lapsed', 'cancelled'] as const
export type PolicyDisplayStatus = (typeof DISPLAY_STATUSES)[number]

export const myInsurancePolicySchema = z.object({
  id: uuid,
  insurer: z.string(),
  plan_tier: z.string().nullable(),
  policy_number: z.string().nullable(),
  member_number: z.string().nullable(),
  start_date: z.string().nullable(),
  renewal_date: z.string().nullable(),
  status: z.enum(POLICY_STATUSES),
  display_status: z.enum(DISPLAY_STATUSES),
  is_expired: z.boolean(),
  renewing_soon: z.boolean(),
  days_to_renewal: num.int().nullable(),
})

export const myInsuranceResponseSchema = z.object({
  asOf: z.string(),
  linked: z.boolean(),
  items: z.array(myInsurancePolicySchema),
})

export const manageInsurancePolicySchema = myInsurancePolicySchema.extend({
  employee_id: uuid,
  employee_number: z.string(),
  employee_name: z.string(),
  premium_amount_ugx: num.nullable(),
  dependants_count: num.int().nonnegative(),
  dependant_names: z.string().nullable(),
  notes: z.string().nullable(),
  version: num.int().positive(),
})

export const insuranceSummarySchema = z.object({
  activePolicies: num.int().nonnegative(),
  coveredEmployees: num.int().nonnegative(),
  activeEmployees: num.int().nonnegative(),
  renewingSoonCount: num.int().nonnegative(),
  expiredActiveCount: num.int().nonnegative(),
  annualPremiumUgx: num.nonnegative(),
})

export const manageInsuranceResponseSchema = z.object({
  asOf: z.string(),
  summary: insuranceSummarySchema,
  items: z.array(manageInsurancePolicySchema),
})

export type MyInsurancePolicy = z.infer<typeof myInsurancePolicySchema>
export type MyInsuranceResponse = z.infer<typeof myInsuranceResponseSchema>
export type ManageInsurancePolicy = z.infer<typeof manageInsurancePolicySchema>
export type InsuranceSummary = z.infer<typeof insuranceSummarySchema>
export type ManageInsuranceResponse = z.infer<typeof manageInsuranceResponseSchema>

export interface SaveInsurancePolicyInput {
  policyId?: string | null
  expectedVersion?: number | null
  employeeId: string
  insurer: string
  planTier?: string | null
  policyNumber?: string | null
  memberNumber?: string | null
  startDate?: string | null
  renewalDate?: string | null
  premiumAmountUgx?: number | null
  dependantsCount?: number
  dependantNames?: string | null
  status: PolicyStatus
  notes?: string | null
}

function readableInsuranceError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'The health insurance request could not be completed.'
  const code = 'code' in err && typeof err.code === 'string' ? err.code : ''
  const msg = 'message' in err && typeof err.message === 'string' ? err.message : ''
  if (code === '40001') {
    return 'This policy was updated by someone else. Refresh and review the latest version.'
  }
  if (code === '42501') return 'You do not have permission for this health insurance action.'
  return msg || 'The health insurance request could not be completed.'
}

async function callInsuranceRpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const response = (await getSupabaseClient().rpc(name, args)) as {
    data: unknown
    error: unknown
  }
  if (response.error) throw new Error(readableInsuranceError(response.error))
  return response.data
}

export const insuranceApi = {
  async listManage(employeeId?: string | null): Promise<ManageInsuranceResponse> {
    const data = await callInsuranceRpc('rpc_list_employee_insurance', {
      p_employee_id: employeeId ?? null,
    })
    return manageInsuranceResponseSchema.parse(data)
  },

  async listMine(): Promise<MyInsuranceResponse> {
    const data = await callInsuranceRpc('rpc_list_my_insurance')
    return myInsuranceResponseSchema.parse(data)
  },

  async savePolicy(input: SaveInsurancePolicyInput): Promise<string> {
    const data = await callInsuranceRpc('rpc_save_employee_insurance', {
      p_policy_id: input.policyId ?? null,
      p_expected_version: input.policyId ? (input.expectedVersion ?? null) : null,
      p_employee_id: input.employeeId,
      p_insurer: input.insurer.trim(),
      p_plan_tier: input.planTier?.trim() || null,
      p_policy_number: input.policyNumber?.trim() || null,
      p_member_number: input.memberNumber?.trim() || null,
      p_start_date: input.startDate || null,
      p_renewal_date: input.renewalDate || null,
      p_premium_amount_ugx: input.premiumAmountUgx ?? null,
      p_dependants_count: input.dependantsCount ?? 0,
      p_dependant_names: input.dependantNames?.trim() || null,
      p_status: input.status,
      p_notes: input.notes?.trim() || null,
    })
    return uuid.parse(data)
  },

  async archivePolicy(policyId: string, expectedVersion: number): Promise<void> {
    await callInsuranceRpc('rpc_archive_employee_insurance', {
      p_policy_id: policyId,
      p_expected_version: expectedVersion,
    })
  },
}
