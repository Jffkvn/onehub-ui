import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

const id = z.string().uuid()
const namedOption = z.object({ id, name: z.string() })
const warehouseOption = namedOption.extend({ code: z.string() })
const materialOption = namedOption.extend({ sku: z.string() })

const receiptSchema = z.object({
  id,
  reference_number: z.string(),
  supplier_name: z.string().nullable(),
  invoice_number: z.string().nullable(),
  received_date: z.string(),
  purchase_value: z.coerce.number().finite().nonnegative(),
  warehouses: z.object({ name: z.string() }).nullable(),
})

export type StockReceipt = z.infer<typeof receiptSchema>

export type StockCommand = {
  name: 'rpc_receive_consumable_inline' | 'rpc_receive_new_equipment_inline' | 'rpc_adjust_stock'
    | 'rpc_bulk_import_item_master' | 'rpc_bulk_receive_stock' | 'rpc_bulk_opening_stock' | 'rpc_bulk_adjust_stock'
  args: Record<string, unknown>
}

export class UnconfirmedStockWrite extends Error {
  constructor() {
    super('The warehouse service could not confirm this operation. Check the stock ledger and relevant records before submitting again.')
    this.name = 'UnconfirmedStockWrite'
  }
}

function currentSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })

  return () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
}

type OptionTable = 'warehouses' | 'consumable_items' | 'item_categories'

async function readOptions<T>(
  scope: IdentityScopeRef,
  signal: AbortSignal,
  table: OptionTable,
  columns: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const check = currentSession(scope)
  const rows: T[] = []
  const client = getSupabaseClient()
  const pageSize = 500

  for (let offset = 0; ; offset += pageSize) {
    check()
    const query = client.from(table).select(columns).order('name').order('id')
    if (table === 'warehouses') query.eq('status', 'active')
    const { data, error } = await query.range(offset, offset + pageSize - 1).abortSignal(signal)
    check()
    if (error) throw new Error('Warehouse options could not be loaded.')
    const page = schema.array().parse(data)
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

export function readActiveWarehouses(scope: IdentityScopeRef, signal: AbortSignal) {
  return readOptions(scope, signal, 'warehouses', 'id,name,code', warehouseOption)
}

export function readMaterialOptions(scope: IdentityScopeRef, signal: AbortSignal) {
  return readOptions(scope, signal, 'consumable_items', 'id,name,sku', materialOption)
}

export function readCategoryOptions(scope: IdentityScopeRef, signal: AbortSignal) {
  return readOptions(scope, signal, 'item_categories', 'id,name', namedOption)
}

export async function readRecentReceipts(scope: IdentityScopeRef, signal: AbortSignal) {
  const check = currentSession(scope)
  check()
  const { data, error } = await getSupabaseClient().from('stock_receipts')
    .select('id,reference_number,supplier_name,invoice_number,received_date,purchase_value,warehouses(name)')
    .order('received_at', { ascending: false }).order('id', { ascending: false }).limit(20).abortSignal(signal)
  check()
  if (error) throw new Error('Recent receipts could not be loaded.')
  return receiptSchema.array().parse(data)
}

export async function executeStockCommand(scope: IdentityScopeRef, { name, args }: StockCommand) {
  const check = currentSession(scope)
  check()

  let response
  try {
    response = await getSupabaseClient().rpc(name, args)
  } catch {
    check()
    throw new UnconfirmedStockWrite()
  }

  check()
  if (!response.error) return
  if (response.error.code === '42501') throw new Error('You do not have permission for this stock operation.')
  if (response.status === 0 || response.status >= 500) throw new UnconfirmedStockWrite()

  // The known inventory functions return actionable business-rule errors.
  if (['22000', '22003', '22023', '23505', 'L0103'].includes(response.error.code)) {
    throw new Error(response.error.message)
  }
  throw new Error('The warehouse rejected the operation. Review the information and try again.')
}
