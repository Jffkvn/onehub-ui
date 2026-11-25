import { z } from 'zod'

import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'

export const ROUTER_FLOAT_CAP = 5

const floatStateSchema = z.enum(['pending_handover', 'with_technician', 'faulty_to_return'])

export const routerTechnicianSchema = z.object({
  profile_id: z.string().uuid(),
  display_name: z.string(),
  employee_number: z.string().nullable(),
  pending_count: z.number().int().nonnegative(),
  confirmed_count: z.number().int().nonnegative(),
  faulty_count: z.number().int().nonnegative(),
  active_total: z.number().int().nonnegative(),
  remaining_slots: z.number().int().nonnegative(),
})

export const availableRouterSchema = z.object({
  id: z.string().uuid(),
  model_name: z.string(),
  serial_number: z.string(),
  mac_address: z.string().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  warehouse_name: z.string().nullable(),
})

export const activeFloatRouterSchema = z.object({
  custody_id: z.string().uuid(),
  equipment_asset_id: z.string().uuid(),
  model_name: z.string(),
  serial_number: z.string(),
  mac_address: z.string().nullable(),
  float_state: floatStateSchema,
  custodian_profile_id: z.string().uuid(),
  custodian_name: z.string(),
  warehouse_id: z.string().uuid(),
  warehouse_name: z.string(),
  issued_at: z.string(),
  confirmed_at: z.string().nullable(),
  faulty_reported_at: z.string().nullable(),
  faulty_notes: z.string().nullable(),
})

export const routerFloatOverviewSchema = z.object({
  cap: z.number().int().positive(),
  technicians: z.array(routerTechnicianSchema),
  available_routers: z.array(availableRouterSchema),
  active_float: z.array(activeFloatRouterSchema),
})

export const myFloatItemSchema = z.object({
  custody_id: z.string().uuid(),
  equipment_asset_id: z.string().uuid(),
  model_name: z.string(),
  serial_number: z.string(),
  mac_address: z.string().nullable(),
  float_state: floatStateSchema,
  warehouse_name: z.string(),
  issued_at: z.string(),
  confirmed_at: z.string().nullable(),
  faulty_reported_at: z.string().nullable(),
  faulty_notes: z.string().nullable(),
})

export const myRouterFloatSchema = z.object({
  cap: z.number().int().positive(),
  pending_count: z.number().int().nonnegative(),
  confirmed_count: z.number().int().nonnegative(),
  faulty_count: z.number().int().nonnegative(),
  active_total: z.number().int().nonnegative(),
  remaining_slots: z.number().int().nonnegative(),
  items: z.array(myFloatItemSchema),
})

export const serviceRequestRouterSchema = z.object({
  custody_id: z.string().uuid(),
  equipment_asset_id: z.string().uuid(),
  model_name: z.string(),
  serial_number: z.string(),
  mac_address: z.string().nullable(),
  installed_at: z.string(),
  installed_by_name: z.string().nullable(),
  installed_service_visit_id: z.string().uuid().nullable(),
  installed_site_name: z.string().nullable(),
  installed_area_label: z.string().nullable(),
})

export const receiveRouterBatchResultSchema = z.object({
  receipt_id: z.string().uuid(),
  asset_count: z.number().int().nonnegative(),
  total_value: z.coerce.number().nonnegative(),
  replayed: z.boolean(),
})

export const issueRouterFloatResultSchema = z.object({
  issued_count: z.number().int().nonnegative(),
  active_total: z.number().int().nonnegative(),
  remaining_slots: z.number().int().nonnegative(),
  custody_ids: z.array(z.string().uuid()),
})

export type RouterTechnician = z.infer<typeof routerTechnicianSchema>
export type AvailableRouter = z.infer<typeof availableRouterSchema>
export type ActiveFloatRouter = z.infer<typeof activeFloatRouterSchema>
export type RouterFloatOverview = z.infer<typeof routerFloatOverviewSchema>
export type MyFloatItem = z.infer<typeof myFloatItemSchema>
export type MyRouterFloat = z.infer<typeof myRouterFloatSchema>
export type ServiceRequestRouter = z.infer<typeof serviceRequestRouterSchema>
export type ReceiveRouterBatchResult = z.infer<typeof receiveRouterBatchResultSchema>
export type IssueRouterFloatResult = z.infer<typeof issueRouterFloatResultSchema>

export interface RouterDraftRow {
  id: string
  model_name: string
  serial_number: string
  mac_address: string
  unit_price: string
  condition_notes: string
}

export const existingRouterIdentifiersSchema = z.object({
  existing_serials: z.array(z.string()),
  existing_macs: z.array(z.string()),
  replays_existing_receipt: z.boolean().default(false),
  grn_conflict: z.boolean().default(false),
  existing_receipt_id: z.string().uuid().nullable().default(null),
  existing_asset_count: z.number().int().nullable().default(null),
  existing_total_value: z.coerce.number().nullable().default(null),
})

export interface RouterDraftConflicts {
  serials?: ReadonlySet<string>
  macs?: ReadonlySet<string>
}

export interface RouterDraftValidation {
  rowErrors: Record<string, string[]>
  hasErrors: boolean
  totalValue: number
}

function createDraftRowId(index: number) {
  return `draft-row-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`
}

function detectDelimiter(raw: string): '\t' | ';' | ',' {
  const firstLine = raw
    .replace(/^\uFEFF/, '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .find((line) => line.trim().length > 0) ?? ''

  let inQuotes = false
  let tabs = 0
  let semis = 0
  let commas = 0
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i]
    if (ch === '"') {
      if (inQuotes && firstLine[i + 1] === '"') {
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (inQuotes) continue
    if (ch === '\t') tabs += 1
    else if (ch === ';') semis += 1
    else if (ch === ',') commas += 1
  }
  if (tabs > 0 && tabs >= commas && tabs >= semis) return '\t'
  if (semis > 0 && semis >= commas) return ';'
  return ','
}

function parseDelimitedRows(raw: string): string[][] {
  const cleaned = raw.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  if (!cleaned.trim()) return []

  const delimiter = detectDelimiter(cleaned)
  const rows: string[][] = []
  let currentRow: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i]
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"' && cell.trim().length === 0) {
      cell = ''
      inQuotes = true
      continue
    }

    if (ch === delimiter) {
      currentRow.push(cell.trim())
      cell = ''
      continue
    }

    if (ch === '\n') {
      currentRow.push(cell.trim())
      if (currentRow.some((c) => c.length > 0)) rows.push(currentRow)
      currentRow = []
      cell = ''
      continue
    }

    cell += ch
  }

  currentRow.push(cell.trim())
  if (currentRow.some((c) => c.length > 0)) rows.push(currentRow)
  return rows
}

function normalizeHeaderToken(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function findColumnIndex(normalizedHeaders: readonly string[], candidates: readonly string[]): number {
  const exactIdx = normalizedHeaders.findIndex((h) => candidates.includes(h))
  if (exactIdx >= 0) return exactIdx
  return normalizedHeaders.findIndex((h) => candidates.some((c) => h.split(' ').includes(c) || h.includes(c)))
}

function normalizePriceCell(rawValue: string | undefined, fallbackPrice: string): string {
  const trimmed = (rawValue ?? '').trim()
  if (!trimmed) return fallbackPrice
  const stripped = trimmed.replace(/,/g, '').replace(/\s+/g, '')
  if (/^-?\d+(?:\.\d+)?$/.test(stripped)) return stripped
  return trimmed
}

function mapRowsToRouterDrafts(
  rawRows: readonly string[][],
  defaultModel: string,
  defaultPrice: string,
): RouterDraftRow[] {
  const rows = rawRows
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some((cell) => cell.length > 0))

  if (rows.length === 0) return []

  const fallbackModel = defaultModel.trim()
  const fallbackPrice = normalizePriceCell(defaultPrice, '0')
  const normalizedHeaders = rows[0].map(normalizeHeaderToken)

  const serialCol = findColumnIndex(normalizedHeaders, ['sn', 's n', 'serial', 'serial no', 'serial num', 'serial number', 'ont sn'])
  const modelCol = findColumnIndex(normalizedHeaders, ['model', 'model name', 'device', 'device model', 'router model', 'item'])
  const macCol = findColumnIndex(normalizedHeaders, ['mac', 'mac addr', 'mac address', 'eth mac', 'wan mac'])
  const priceCol = findColumnIndex(normalizedHeaders, ['unit price', 'price', 'unit cost', 'cost', 'value', 'amount', 'rate'])
  const notesCol = findColumnIndex(normalizedHeaders, ['condition notes', 'condition', 'notes', 'note', 'remarks'])

  const hasHeader =
    serialCol >= 0 &&
    (normalizedHeaders.length === 1 || modelCol >= 0 || macCol >= 0 || priceCol >= 0 || notesCol >= 0)

  if (hasHeader) {
    return rows.slice(1).map((row, idx) => {
      if (row.length === 1 && serialCol > 0) {
        return {
          id: createDraftRowId(idx),
          model_name: fallbackModel,
          serial_number: row[0] ?? '',
          mac_address: '',
          unit_price: fallbackPrice,
          condition_notes: '',
        }
      }
      return {
        id: createDraftRowId(idx),
        model_name: (modelCol >= 0 ? row[modelCol] : '') || fallbackModel,
        serial_number: (serialCol >= 0 ? row[serialCol] : '') ?? '',
        mac_address: macCol >= 0 ? row[macCol] ?? '' : '',
        unit_price: priceCol >= 0 ? normalizePriceCell(row[priceCol], fallbackPrice) : fallbackPrice,
        condition_notes: notesCol >= 0 ? row[notesCol] ?? '' : '',
      }
    })
  }

  return rows.map((parts, idx) => {
    if (parts.length === 1) {
      return {
        id: createDraftRowId(idx),
        model_name: fallbackModel,
        serial_number: parts[0],
        mac_address: '',
        unit_price: fallbackPrice,
        condition_notes: '',
      }
    }
    if (parts.length === 2) {
      return {
        id: createDraftRowId(idx),
        model_name: fallbackModel,
        serial_number: parts[0],
        mac_address: parts[1],
        unit_price: fallbackPrice,
        condition_notes: '',
      }
    }
    if (parts.length === 3) {
      // Deterministic headerless order: Model, Unit Price, SN
      return {
        id: createDraftRowId(idx),
        model_name: parts[0] || fallbackModel,
        serial_number: parts[2] ?? '',
        mac_address: '',
        unit_price: normalizePriceCell(parts[1], fallbackPrice),
        condition_notes: '',
      }
    }

    // Deterministic headerless 4+ order: Model, Unit Price, SN, optional MAC[, Notes]
    return {
      id: createDraftRowId(idx),
      model_name: parts[0] || fallbackModel,
      serial_number: parts[2] ?? '',
      mac_address: parts[3] ?? '',
      unit_price: normalizePriceCell(parts[1], fallbackPrice),
      condition_notes: parts[4] ?? '',
    }
  })
}

/**
 * Parse pasted CSV (with quoted-field support), TSV, semicolon-delimited manifests,
 * or bare USB-scanner serial lines into editable draft rows using shared header-aware mapping.
 */
export function parseRouterBatchText(
  raw: string,
  defaultModel: string,
  defaultPrice: string,
): RouterDraftRow[] {
  return mapRowsToRouterDrafts(parseDelimitedRows(raw), defaultModel, defaultPrice)
}

/** Convert parsed spreadsheet rows into editable router batch rows using shared header-aware mapping. */
export function parseRouterBatchWorkbookRows(
  rows: readonly string[][],
  defaultModel: string,
  defaultPrice: string,
): RouterDraftRow[] {
  return mapRowsToRouterDrafts(rows, defaultModel, defaultPrice)
}

/** Validate editable batch draft rows, flagging inline duplicates and existing inventory collisions before submit. */
export function validateRouterBatchDraft(
  rows: readonly RouterDraftRow[],
  existingConflicts?: RouterDraftConflicts,
): RouterDraftValidation {
  const rowErrors: Record<string, string[]> = {}
  const serialCounts = new Map<string, number>()
  const macCounts = new Map<string, number>()

  for (const row of rows) {
    const serialKey = row.serial_number.trim().toLowerCase()
    if (serialKey) serialCounts.set(serialKey, (serialCounts.get(serialKey) ?? 0) + 1)

    const macKey = row.mac_address.trim().toLowerCase()
    if (macKey) macCounts.set(macKey, (macCounts.get(macKey) ?? 0) + 1)
  }

  let totalValue = 0
  let hasErrors = rows.length === 0

  for (const row of rows) {
    const errors: string[] = []
    if (row.model_name.trim().length < 2) errors.push('Model name is required (min 2 chars).')

    const serialTrimmed = row.serial_number.trim()
    const serialLower = serialTrimmed.toLowerCase()
    if (serialTrimmed.length < 2) {
      errors.push('Serial number is required.')
    } else {
      if ((serialCounts.get(serialLower) ?? 0) > 1) {
        errors.push(`Duplicate serial "${serialTrimmed}" in this batch.`)
      }
      if (existingConflicts?.serials?.has(serialLower)) {
        errors.push(`Serial "${serialTrimmed}" already exists in inventory.`)
      }
    }

    const macTrimmed = row.mac_address.trim()
    const macLower = macTrimmed.toLowerCase()
    if (macTrimmed && macTrimmed.length < 4) {
      errors.push('MAC address must be at least 4 characters when provided.')
    } else if (macTrimmed) {
      if ((macCounts.get(macLower) ?? 0) > 1) {
        errors.push(`Duplicate MAC "${macTrimmed}" in this batch.`)
      }
      if (existingConflicts?.macs?.has(macLower)) {
        errors.push(`MAC "${macTrimmed}" already exists in inventory.`)
      }
    }

    const normalizedPrice = row.unit_price.replace(/,/g, '').trim()
    const price = Number(normalizedPrice || '0')
    if (!Number.isFinite(price) || price < 0) {
      errors.push('Unit price must be zero or positive.')
    } else {
      totalValue += price
    }

    if (errors.length > 0) {
      rowErrors[row.id] = errors
      hasErrors = true
    }
  }

  return { rowErrors, hasErrors, totalValue }
}

function currentSession(scope: IdentityScopeRef) {
  const snapshot = captureProtectedSessionSnapshot({
    identityKey: scope.identityKey,
    authEpoch: scope.authEpoch,
    isReady: scope.isAuthReady,
  })
  return (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  }
}

function mapRpcError(error: { code?: string; message?: string } | null, fallback: string): Error {
  if (!error) return new Error(fallback)
  if (error.code === '42501') return new Error(error.message || 'You do not have permission for this action.')
  if (error.message) return new Error(error.message)
  return new Error(fallback)
}

export async function readRouterFloatOverview(
  scope: IdentityScopeRef,
  signal: AbortSignal,
): Promise<RouterFloatOverview> {
  const check = currentSession(scope)
  check(signal)
  const response = await getSupabaseClient().rpc('rpc_list_router_float_overview').abortSignal(signal)
  check(signal)
  if (response.error) throw mapRpcError(response.error, 'Could not load router float overview.')
  return routerFloatOverviewSchema.parse(response.data)
}

export async function receiveRouterBatch(
  scope: IdentityScopeRef,
  input: {
    warehouseId: string
    categoryId: string | null
    categoryName: string | null
    supplierName: string
    grnNumber: string
    invoiceNumber: string
    receivedDate: string
    idempotencyKey: string
    rows: readonly RouterDraftRow[]
  },
): Promise<ReceiveRouterBatchResult> {
  const check = currentSession(scope)
  check()
  const items = input.rows.map((r) => ({
    model_name: r.model_name.trim(),
    serial_number: r.serial_number.trim(),
    mac_address: r.mac_address.trim() || null,
    unit_price: Number(r.unit_price.replace(/,/g, '').trim() || '0'),
    condition_notes: r.condition_notes.trim() || null,
  }))
  const response = await getSupabaseClient().rpc('rpc_receive_cpe_router_batch', {
    p_warehouse_id: input.warehouseId,
    p_category_id: input.categoryId,
    p_category_name: input.categoryName,
    p_supplier_name: input.supplierName.trim(),
    p_grn_number: input.grnNumber.trim(),
    p_invoice_number: input.invoiceNumber.trim(),
    p_received_date: input.receivedDate,
    p_idempotency_key: input.idempotencyKey,
    p_items: items,
  })
  check()
  if (response.error) throw mapRpcError(response.error, 'Could not receive router batch.')
  return receiveRouterBatchResultSchema.parse(response.data)
}

export async function issueRouterFloat(
  scope: IdentityScopeRef,
  input: {
    technicianProfileId: string
    warehouseId: string
    equipmentAssetIds: string[]
    issueCondition: string
  },
): Promise<IssueRouterFloatResult> {
  const check = currentSession(scope)
  check()
  const response = await getSupabaseClient().rpc('rpc_issue_router_float', {
    p_technician_profile_id: input.technicianProfileId,
    p_warehouse_id: input.warehouseId,
    p_equipment_asset_ids: input.equipmentAssetIds,
    p_issue_condition: input.issueCondition.trim() || 'Good working order',
  })
  check()
  if (response.error) throw mapRpcError(response.error, 'Could not issue routers to technician.')
  return issueRouterFloatResultSchema.parse(response.data)
}

export async function cancelRouterHandover(
  scope: IdentityScopeRef,
  custodyId: string,
  reason?: string,
) {
  const check = currentSession(scope)
  check()
  const response = await getSupabaseClient().rpc('rpc_cancel_router_handover', {
    p_custody_id: custodyId,
    p_reason: reason?.trim() || null,
  })
  check()
  if (response.error) throw mapRpcError(response.error, 'Could not cancel router handover.')
}

export async function receiveRouterFloatReturn(
  scope: IdentityScopeRef,
  input: {
    custodyId: string
    warehouseId: string
    condition: 'damaged' | 'good'
    notes: string
  },
) {
  const check = currentSession(scope)
  check()
  const response = await getSupabaseClient().rpc('rpc_receive_router_float_return', {
    p_custody_id: input.custodyId,
    p_warehouse_id: input.warehouseId,
    p_condition: input.condition,
    p_notes: input.notes.trim() || null,
  })
  check()
  if (response.error) throw mapRpcError(response.error, 'Could not confirm router return.')
}

export async function readMyRouterFloat(
  scope: IdentityScopeRef,
  signal: AbortSignal,
): Promise<MyRouterFloat> {
  const check = currentSession(scope)
  check(signal)
  const response = await getSupabaseClient().rpc('rpc_list_my_router_float').abortSignal(signal)
  check(signal)
  if (response.error) throw mapRpcError(response.error, 'Could not load your router float.')
  return myRouterFloatSchema.parse(response.data)
}

export async function confirmRouterHandover(scope: IdentityScopeRef, custodyIds: string[]) {
  const check = currentSession(scope)
  check()
  const response = await getSupabaseClient().rpc('rpc_confirm_router_handover', {
    p_custody_ids: custodyIds,
  })
  check()
  if (response.error) throw mapRpcError(response.error, 'Could not confirm router receipt.')
}

export async function reportRouterFaulty(
  scope: IdentityScopeRef,
  custodyId: string,
  notes: string,
) {
  const check = currentSession(scope)
  check()
  const response = await getSupabaseClient().rpc('rpc_report_router_faulty', {
    p_custody_id: custodyId,
    p_faulty_notes: notes.trim(),
  })
  check()
  if (response.error) throw mapRpcError(response.error, 'Could not mark router faulty.')
}

export async function installRouterOnServiceRequest(
  scope: IdentityScopeRef,
  input: {
    equipmentAssetId: string
    serviceRequestId: string
    serviceVisitId: string | null
  },
) {
  const check = currentSession(scope)
  check()
  const response = await getSupabaseClient().rpc('rpc_install_router_on_service_request', {
    p_equipment_asset_id: input.equipmentAssetId,
    p_service_request_id: input.serviceRequestId,
    p_service_visit_id: input.serviceVisitId,
  })
  check()
  if (response.error) throw mapRpcError(response.error, 'Could not record installed router.')
}

export async function listServiceRequestRouters(
  scope: IdentityScopeRef,
  serviceRequestId: string,
  signal: AbortSignal,
): Promise<ServiceRequestRouter[]> {
  const check = currentSession(scope)
  check(signal)
  const response = await getSupabaseClient()
    .rpc('rpc_list_service_request_routers', { p_service_request_id: serviceRequestId })
    .abortSignal(signal)
  check(signal)
  if (response.error) throw mapRpcError(response.error, 'Could not load installed routers.')
  return serviceRequestRouterSchema.array().parse(response.data)
}

export async function checkExistingRouterIdentifiers(
  scope: IdentityScopeRef,
  input: {
    serialNumbers: readonly string[]
    macAddresses: readonly string[]
    warehouseId?: string
    supplierName?: string
    grnNumber?: string
    invoiceNumber?: string
    receivedDate?: string
    rows?: readonly RouterDraftRow[]
  },
  signal?: AbortSignal,
): Promise<z.infer<typeof existingRouterIdentifiersSchema>> {
  const cleanSerials = [...new Set(input.serialNumbers.map((s) => s.trim()).filter((s) => s.length >= 2))]
  const cleanMacs = [...new Set(input.macAddresses.map((m) => m.trim()).filter((m) => m.length >= 4))]
  if (cleanSerials.length === 0 && cleanMacs.length === 0) {
    return {
      existing_serials: [],
      existing_macs: [],
      replays_existing_receipt: false,
      grn_conflict: false,
      existing_receipt_id: null,
      existing_asset_count: null,
      existing_total_value: null,
    }
  }

  const normalizedItems = input.rows?.length
    ? input.rows.map((r) => ({
        model_name: r.model_name.trim(),
        serial_number: r.serial_number.trim(),
        mac_address: r.mac_address.trim() || null,
        unit_price: r.unit_price.replace(/,/g, '').trim() || '0',
        condition_notes: r.condition_notes.trim() || null,
      }))
    : null

  const check = currentSession(scope)
  check(signal)
  const request = getSupabaseClient().rpc('rpc_check_existing_cpe_identifiers', {
    p_serial_numbers: cleanSerials,
    p_mac_addresses: cleanMacs,
    p_warehouse_id: input.warehouseId || null,
    p_supplier_name: input.supplierName?.trim() || null,
    p_grn_number: input.grnNumber?.trim() || null,
    p_invoice_number: input.invoiceNumber?.trim() || null,
    p_received_date: input.receivedDate || null,
    p_items: normalizedItems,
  })
  const response = await (signal ? request.abortSignal(signal) : request)
  check(signal)
  if (response.error) {
    throw mapRpcError(response.error, 'Could not verify existing inventory serials.')
  }
  return existingRouterIdentifiersSchema.parse(response.data)
}
