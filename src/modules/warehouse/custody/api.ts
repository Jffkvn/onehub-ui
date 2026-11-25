import { getSupabaseClient } from '@/lib/supabase/client'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'

type Related<T> = T | T[] | null

export interface ActiveCustody {
  id: string
  equipment_asset_id: string
  stock_request_id: string | null
  project_name: string | null
  custody_origin?: 'stock_request' | 'warehouse_handover' | 'customer_collection'
  float_state?: 'pending_handover' | 'with_technician' | 'faulty_to_return' | null
  issued_from_warehouse_id: string
  issue_condition: string
  issued_at: string
  expected_return_date: string | null
  equipment: Related<{ model_name: string; serial_number: string; mac_address?: string | null }>
  custodian: Related<{ display_name: string }>
  source_warehouse: Related<{ name: string }>
}

export interface ReturnWarehouse {
  id: string
  name: string
}

export type ReturnCondition = 'good' | 'damaged' | 'lost'

const custodyColumns = `
  id, equipment_asset_id, stock_request_id, project_name, custody_origin, float_state, issued_from_warehouse_id,
  issue_condition, issued_at, expected_return_date,
  equipment:equipment_assets!equipment_asset_id(model_name,serial_number,mac_address),
  custodian:profiles!custodian_profile_id(display_name),
  source_warehouse:warehouses!issued_from_warehouse_id(name)
`

export function related<T>(value: Related<T>): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined
}

function sessionCheck(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  const assertCurrent = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  assertCurrent()
  return assertCurrent
}

export async function listActiveCustody(scope: IdentityScopeRef, signal: AbortSignal) {
  const assertCurrent = sessionCheck(scope)
  const client = getSupabaseClient()
  const rows: ActiveCustody[] = []
  const pageSize = 500

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from('asset_custody').select(custodyColumns)
      .is('ended_at', null).order('issued_at', { ascending: false }).order('id')
      .range(offset, offset + pageSize - 1).abortSignal(signal)
    assertCurrent()
    if (error) throw error

    const page = (data ?? []) as unknown as ActiveCustody[]
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

export async function listReturnWarehouses(scope: IdentityScopeRef, signal: AbortSignal) {
  const assertCurrent = sessionCheck(scope)
  const { data, error } = await getSupabaseClient().from('warehouses').select('id,name')
    .eq('status', 'active').order('name').abortSignal(signal)
  assertCurrent()
  if (error) throw error
  return (data ?? []) as ReturnWarehouse[]
}

export async function recordAssetReturn(
  scope: IdentityScopeRef,
  custody: ActiveCustody,
  condition: ReturnCondition,
  warehouseId: string,
  notes: string,
) {
  const assertCurrent = sessionCheck(scope)
  const client = getSupabaseClient()
  const { data: active, error: lookupError } = await client.from('asset_custody').select('id')
    .eq('id', custody.id).eq('equipment_asset_id', custody.equipment_asset_id).is('ended_at', null).maybeSingle()
  assertCurrent()
  if (lookupError) throw lookupError
  if (!active) throw new Error('This custody record has changed. Close this form and reopen the current record.')

  let result
  try {
    result = await client.rpc('rpc_return_asset', {
      p_equipment_asset_id: custody.equipment_asset_id,
      p_condition: condition,
      p_warehouse_id: warehouseId,
      p_notes: notes.trim(),
    })
  } catch {
    assertCurrent()
    throw new Error('Could not verify the return. Refresh the custody list before trying again.')
  }
  assertCurrent()
  if (result.error) {
    if (result.status === 0 || result.status >= 500) {
      throw new Error('Could not verify the return. Refresh the custody list before trying again.')
    }
    throw result.error
  }
}
