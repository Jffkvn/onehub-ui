import { z } from 'zod'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

export type DossierSection = 'emergency_contacts' | 'previous_employment'

const positionSchema = z.union([z.literal(1), z.literal(2)])
const versionSchema = z.number().int().nonnegative()
const contactSchema = z.object({
  position: positionSchema,
  full_name: z.string(),
  relationship: z.string(),
  phone: z.string(),
  alt_phone: z.string().nullable(),
})
const employmentSchema = z.object({
  position: positionSchema,
  employer: z.string(),
  job_title: z.string().nullable(),
  started_on: z.string().date().nullable(),
  ended_on: z.string().date().nullable(),
  reason_for_leaving: z.string().nullable(),
})

export type DossierPosition = z.infer<typeof positionSchema>
export type DossierRecord = z.infer<typeof contactSchema> | z.infer<typeof employmentSchema>
export type DossierWriteRecord = { position: DossierPosition } & Record<string, number | string | null>

export interface DossierSectionSnapshot {
  version: number
  records: DossierRecord[]
}

export class DossierVersionConflict extends Error {}

async function dossierRpc(scope: IdentityScopeRef, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  const result = await getSupabaseClient().rpc(fn, args)
  assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  if (result.error?.code === '40001') throw new DossierVersionConflict()
  if (result.error) throw new Error('The dossier request failed.')
  const data: unknown = result.data
  return data
}

export async function getDossierSection(
  scope: IdentityScopeRef,
  employeeId: string,
  section: DossierSection,
): Promise<DossierSectionSnapshot> {
  const row = section === 'emergency_contacts' ? contactSchema : employmentSchema
  const data = await dossierRpc(scope, 'rpc_get_employee_dossier_section', {
    p_employee_id: employeeId,
    p_section: section,
  })
  return z.object({ version: versionSchema, records: row.array().max(2) }).parse(data)
}

export async function saveDossierSection(
  scope: IdentityScopeRef,
  employeeId: string,
  section: DossierSection,
  version: number,
  records: DossierWriteRecord[],
): Promise<void> {
  await dossierRpc(scope, 'rpc_save_employee_dossier_section', {
    p_employee_id: employeeId,
    p_section: section,
    p_expected_version: version,
    p_records: records,
  })
}
