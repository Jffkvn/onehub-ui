import { z } from 'zod'

import { assertProtectedSessionCurrent, captureProtectedSessionSnapshot, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

const uuid = z.string().uuid()
const status = z.enum(['draft', 'pending_approval', 'approved', 'fulfilled', 'rejected'])
const requestSchema = z.object({
  id: uuid,
  project_name: z.string(),
  requester_name: z.string().nullish(),
  requester_role: z.string().nullish(),
  status,
  escalated_to_cfo: z.boolean(),
  total_estimated_value: z.coerce.number().finite().nonnegative(),
  created_at: z.string().datetime({ offset: true }),
})
const lineSchema = z.object({
  id: uuid,
  quantity: z.number().int().positive(),
  quantity_issued: z.number().int().nonnegative(),
  estimated_unit_price: z.coerce.number().finite().nonnegative(),
  expected_return_date: z.string().nullish(),
  consumable_items: z.object({ name: z.string(), sku: z.string(), unit_of_measure: z.string() }).nullable(),
  equipment_assets: z.object({ model_name: z.string(), serial_number: z.string() }).nullable(),
})
const option = z.object({ id: uuid, name: z.string() })
const stockOption = z.object({ id: uuid, name: z.string(), sku: z.string() })
const equipmentOption = z.object({ id: uuid, model_name: z.string(), serial_number: z.string(), is_sensitive: z.boolean() })

export type StockRequest = z.infer<typeof requestSchema>
export type StockLine = z.infer<typeof lineSchema>
export type StockRequestInput = {
  consumable_item_id: string | null
  equipment_asset_id: string | null
  quantity: number
  expected_return_date: string | null
}

type ApprovalCommand = { kind: 'approve' | 'escalate'; requestId: string }
type IssueCommand =
  | { kind: 'issue-all'; requestId: string; warehouseId: string }
  | { kind: 'issue-line'; lineId: string; warehouseId: string; condition: string }
export type StockCommand = ApprovalCommand | IssueCommand

type BackendResponse = { data: unknown; error: { code?: string } | null }

function unpack(response: BackendResponse) {
  if (!response.error) return response.data
  switch (response.error.code) {
    case '42501': throw new Error('You do not have permission for this warehouse action.')
    case 'L0101':
    case 'L0102':
    case 'L0104':
    case '40001': throw new Error('The request changed. Review its latest status before continuing.')
    case '22000':
    case '22023': throw new Error('Check that the project, stock, warehouse and return date are still valid.')
    default: throw new Error('The warehouse service could not confirm the action. Review the current record before trying again.')
  }
}

export function stockRequestsApi(scope: IdentityScopeRef) {
  async function call<T>(work: (client: ReturnType<typeof getSupabaseClient>) => PromiseLike<T>) {
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey, authEpoch: scope.authEpoch, isReady: scope.isAuthReady,
    })
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    const response = await work(getSupabaseClient())
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    return response
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const response: BackendResponse = await call((client) => client.rpc(name, args))
    return unpack(response)
  }

  return {
    async list(requestId: string | null = null) {
      return requestSchema.array().parse(await rpc('rpc_list_stock_requests', { p_request_id: requestId }))
    },
    async lines(requestId: string) {
      const response: BackendResponse = await call((client) => client.from('stock_request_items')
        .select('id,quantity,quantity_issued,estimated_unit_price,expected_return_date,consumable_items(name,sku,unit_of_measure),equipment_assets(model_name,serial_number)')
        .eq('request_id', requestId).order('id'))
      return lineSchema.array().parse(unpack(response))
    },
    async choices(assignedProjectsOnly: boolean) {
      const [projects, consumables, equipment, assignments] = await Promise.all([
        call<BackendResponse>((client) => client.from('projects').select('id,name').in('status', ['planned', 'active', 'on_hold']).order('name')),
        call<BackendResponse>((client) => client.from('consumable_items').select('id,name,sku').order('name')),
        call<BackendResponse>((client) => client.from('equipment_assets').select('id,model_name,serial_number,is_sensitive')
          .eq('asset_kind', 'general').eq('status', 'available').order('model_name')),
        assignedProjectsOnly
          ? call<BackendResponse>((client) => client.from('project_assignments').select('project_id')
            .eq('user_id', scope.identityKey ?? '').is('unassigned_at', null))
          : null,
      ])
      const assignedIds = assignments && new Set(z.array(z.object({ project_id: uuid }))
        .parse(unpack(assignments)).map((row) => row.project_id))
      return {
        projects: option.array().parse(unpack(projects)).filter(({ id }) => !assignedIds || assignedIds.has(id)),
        consumables: stockOption.array().parse(unpack(consumables)),
        equipment: equipmentOption.array().parse(unpack(equipment)),
      }
    },
    async warehouses() {
      const response: BackendResponse = await call((client) => client.from('warehouses').select('id,name')
        .eq('status', 'active').order('name'))
      return option.array().parse(unpack(response))
    },
    async create(projectId: string, items: StockRequestInput[]) {
      return uuid.parse(await rpc('rpc_request_stock', { p_project_id: projectId, p_items: items }))
    },
    async act(command: StockCommand) {
      switch (command.kind) {
        case 'approve':
          await rpc('rpc_approve_stock_request', { p_request_id: command.requestId })
          break
        case 'escalate':
          await rpc('rpc_escalate_stock_request', { p_request_id: command.requestId })
          break
        case 'issue-all':
          await rpc('rpc_issue_stock', { p_request_id: command.requestId, p_warehouse_id: command.warehouseId })
          break
        case 'issue-line':
          await rpc('rpc_issue_request_item', {
            p_request_item_id: command.lineId, p_warehouse_id: command.warehouseId, p_issue_condition: command.condition,
          })
          break
      }
    },
  }
}
