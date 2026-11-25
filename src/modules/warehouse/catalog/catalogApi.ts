import { z } from 'zod'
import { assertProtectedSessionCurrent, captureProtectedSessionSnapshot, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

export const catalogPageSize = 25

export type InventoryOverview = {
  activeWarehouses: number
  consumableTypes: number
  totalEquipment: number
  availableEquipment: number
  requestsPendingApproval: number
}

export type CatalogPage<T> = { rows: T[]; count: number }

export type Consumable = {
  id: string
  name: string
  sku: string
  unit_of_measure: string
  reorder_level: number
  item_categories: { name: string } | null
  balance: number
}

export type Equipment = {
  id: string
  model_name: string
  serial_number: string
  mac_address?: string | null
  asset_kind?: 'general' | 'cpe_router'
  status: 'available' | 'assigned' | 'maintenance' | 'damaged' | 'lost' | 'installed'
  is_sensitive: boolean
  item_categories: { name: string } | null
  warehouses: { name: string } | null
}

export type StockMovement = {
  id: string
  movement_type: 'receipt' | 'issue' | 'return' | 'adjustment_add' | 'adjustment_remove'
  created_at: string
  quantity: number
  reference_id: string
  warehouses: { name: string } | null
  consumable_items: { name: string; sku: string } | null
  equipment_assets: { model_name: string; serial_number: string } | null
  profiles_performed_by: { display_name: string | null } | null
}

type CountResult = { count: number | null; error: unknown }
type RowResult = { data: unknown; error: unknown }

const requestStatuses = z.array(z.object({ status: z.string() }))
const balanceMovements = z.array(z.object({ id: z.string(), consumable_item_id: z.string(), quantity: z.number() }))

function readCount(result: CountResult) {
  if (result.error || result.count == null) throw new Error('Inventory count is unavailable.')
  return result.count
}

function readPage<T>(result: CountResult & RowResult): CatalogPage<T> {
  if (!Array.isArray(result.data)) throw new Error('Inventory rows are unavailable.')
  return { rows: result.data as T[], count: readCount(result) }
}

function protect(scope: IdentityScopeRef, signal: AbortSignal) {
  const session = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  const check = () => {
    signal.throwIfAborted()
    assertProtectedSessionCurrent(session, scope.latestRef.current)
  }
  check()
  return check
}

function searchPattern(search: string) {
  return '%' + search.replace(/[\\%_]/g, '\\$&') + '%'
}

export async function readInventoryOverview(scope: IdentityScopeRef, signal: AbortSignal): Promise<InventoryOverview> {
  const assertCurrent = protect(scope, signal)
  const db = getSupabaseClient()
  const countOptions = { count: 'exact', head: true } as const
  const [warehouses, consumables, equipment, available, requests] = await Promise.all([
    db.from('warehouses').select('id', countOptions).eq('status', 'active').abortSignal(signal),
    db.from('consumable_items').select('id', countOptions).abortSignal(signal),
    db.from('equipment_assets').select('id', countOptions).abortSignal(signal),
    db.from('equipment_assets').select('id', countOptions).eq('status', 'available').abortSignal(signal),
    db.rpc('rpc_list_stock_requests', { p_request_id: null }).abortSignal(signal),
  ])
  assertCurrent()
  if (requests.error) throw new Error('Stock request count is unavailable.')
  return {
    activeWarehouses: readCount(warehouses),
    consumableTypes: readCount(consumables),
    totalEquipment: readCount(equipment),
    availableEquipment: readCount(available),
    requestsPendingApproval: requestStatuses.parse(requests.data).filter(({ status }) => status === 'pending_approval').length,
  }
}

export async function readConsumables(page: number, search: string, scope: IdentityScopeRef, signal: AbortSignal): Promise<CatalogPage<Consumable>> {
  const assertCurrent = protect(scope, signal)
  const db = getSupabaseClient()
  const first = page * catalogPageSize
  const query = db.from('consumable_items')
    .select('id,name,sku,unit_of_measure,reorder_level,item_categories(name)', { count: 'exact' })
  if (search) query.ilike('sku', searchPattern(search))
  const result = await query.order('name').order('id').range(first, first + catalogPageSize - 1).abortSignal(signal)
  assertCurrent()
  const { rows, count } = readPage<Omit<Consumable, 'balance'>>(result)
  const ids = rows.map(({ id }) => id)
  const balances = new Map<string, number>()

  // Limit the scan to the visible items and continue past the API's row cap.
  // These immutable movements already store the signed quantity.
  let afterId = ''
  while (ids.length > 0) {
    const history = db.from('stock_movements')
      .select('id,consumable_item_id,quantity')
      .in('consumable_item_id', ids)
      .order('id')
      .limit(500)
    if (afterId) history.gt('id', afterId)
    const movements = await history.abortSignal(signal)
    assertCurrent()
    if (movements.error) throw new Error('Stock balances are unavailable.')
    const batch = balanceMovements.parse(movements.data)
    if (batch.length === 0) break

    for (const movement of batch) {
      const { consumable_item_id, quantity } = movement
      balances.set(consumable_item_id, (balances.get(consumable_item_id) ?? 0) + quantity)
    }
    afterId = batch[batch.length - 1].id
  }

  return { rows: rows.map((row) => ({ ...row, balance: balances.get(row.id) ?? 0 })), count }
}

export async function readEquipment(page: number, search: string, scope: IdentityScopeRef, signal: AbortSignal): Promise<CatalogPage<Equipment>> {
  const assertCurrent = protect(scope, signal)
  const query = getSupabaseClient().from('equipment_assets')
    .select('id,model_name,serial_number,mac_address,asset_kind,status,is_sensitive,item_categories(name),warehouses(name)', { count: 'exact' })
  if (search) {
    const pattern = searchPattern(search)
    query.or(`serial_number.ilike.${pattern},mac_address.ilike.${pattern}`)
  }
  const first = page * catalogPageSize
  const result = await query.order('model_name').order('id').range(first, first + catalogPageSize - 1).abortSignal(signal)
  assertCurrent()
  return readPage<Equipment>(result)
}

export async function readStockMovements(page: number, pageSize: number, scope: IdentityScopeRef, signal: AbortSignal): Promise<CatalogPage<StockMovement>> {
  const assertCurrent = protect(scope, signal)
  const first = page * pageSize
  const result = await getSupabaseClient().from('stock_movements')
    .select('id,movement_type,created_at,quantity,reference_id,warehouses(name),consumable_items(name,sku),equipment_assets(model_name,serial_number),profiles_performed_by:profiles!performed_by(display_name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(first, first + pageSize - 1)
    .abortSignal(signal)
  assertCurrent()
  return readPage<StockMovement>(result)
}
