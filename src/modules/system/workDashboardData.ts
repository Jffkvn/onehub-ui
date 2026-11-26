import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import type { ServiceRequestListRow } from '@/modules/field-services/schemas/services'
import type { Consumable } from '@/modules/warehouse/catalog/catalogApi'
import type { EmployeeEquipmentRequest } from '@/modules/warehouse/employee-equipment/api'

export const workTimezone = 'Africa/Kampala'

export function previousWorkDate(day: string) {
  const date = new Date(day + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export function fallsOnDay(timestamp: string | null | undefined, day: string) {
  return Boolean(timestamp && getTodayIsoInZone(workTimezone, new Date(timestamp)) === day)
}

export function dayLabel(day: string) {
  return new Intl.DateTimeFormat('en-UG', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(new Date(day + 'T12:00:00Z'))
}

export function lateReturn(due: string | null, today: string) {
  return due !== null && due < today
}

export function runningLow(item: Pick<Consumable, 'balance' | 'reorder_level'>) {
  return item.balance <= item.reorder_level
}

export function pendingEquipmentRequests<T extends Pick<EmployeeEquipmentRequest, 'stock_request_id' | 'status'>>(rows: readonly T[]) {
  return rows.filter((row) => !row.stock_request_id &&
    ['pending', 'needs_information', 'awaiting_approval', 'approved'].includes(row.status))
}

type Closure = Pick<ServiceRequestListRow, 'provider_received_at' | 'provider_confirmed_at' | 'provider_deadline_at'>

export function closureStats(rows: readonly Closure[]) {
  let elapsed = 0
  let timed = 0
  let onTime = 0
  let withDeadline = 0
  for (const row of rows) {
    if (!row.provider_confirmed_at) continue
    const confirmation = Date.parse(row.provider_confirmed_at)
    const receipt = Date.parse(row.provider_received_at)
    if (!Number.isFinite(confirmation - receipt) || confirmation < receipt) continue
    elapsed += confirmation - receipt
    timed += 1
    const deadline = Date.parse(row.provider_deadline_at ?? '')
    if (!Number.isFinite(deadline)) continue
    withDeadline += 1
    if (confirmation <= deadline) onTime += 1
  }
  return { hours: timed ? elapsed / timed / 3_600_000 : null, timed, onTime, withDeadline }
}

export async function readPages<T>(
  read: (offset: number) => Promise<{ rows: T[]; total: number }>,
  signal: AbortSignal,
): Promise<T[]> {
  const result: T[] = []
  while (true) {
    signal.throwIfAborted()
    const page = await read(result.length)
    if (page.rows.length === 0) {
      if (result.length < page.total) throw new Error('Could not load the full list.')
      return result
    }
    result.push(...page.rows)
    if (result.length >= page.total) return result
  }
}
