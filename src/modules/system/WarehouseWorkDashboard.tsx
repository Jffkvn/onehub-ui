import { Link } from 'react-router-dom'
import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { catalogPageSize, readConsumables } from '@/modules/warehouse/catalog/catalogApi'
import { listActiveCustody, related } from '@/modules/warehouse/custody/api'
import { employeeEquipmentApi } from '@/modules/warehouse/employee-equipment/api'
import { stockRequestsApi } from '@/modules/warehouse/requests/requestApi'
import { readRouterFloatOverview } from '@/modules/warehouse/router-float/routerFloatApi'
import { dayLabel, lateReturn, pendingEquipmentRequests, readPages, runningLow, workTimezone } from './workDashboardData'
import { QueuePanel, WorkDashboard, type WorkQueue } from './WorkDashboardLayout'
import { useWorkRead, type WorkAccess } from './useWorkRead'

export function WarehouseWorkDashboard({ scope, canOpen, hasPermission }: WorkAccess) {
  const today = getTodayIsoInZone(workTimezone)
  const canRequests = canOpen('requests')
  const canEquipment = canOpen('employee-equipment')
  const canReturns = canOpen('returns')
  const canStock = canOpen('consumables')
  const canFloat = canOpen('router-float')
  const requests = useWorkRead(scope, ['warehouse-requests'], canRequests || canEquipment, async (signal, check) => {
    const stock = canRequests ? stockRequestsApi(scope).list() : []
    const employee = canEquipment ? readPages(async (offset) => {
      check()
      const page = await employeeEquipmentApi(scope).list(true, offset, signal)
      return { rows: page.requests, total: page.total }
    }, signal) : []
    const [stockRows, employeeRows] = await Promise.all([stock, employee])
    return { stock: stockRows, employee: pendingEquipmentRequests(employeeRows) }
  })
  const returns = useWorkRead(scope, ['warehouse-returns'], canReturns, (signal) => listActiveCustody(scope, signal))
  const stock = useWorkRead(scope, ['warehouse-low-stock'], canStock, (signal) => readPages(async (offset) => {
    const page = await readConsumables(offset / catalogPageSize, '', scope, signal)
    return { rows: page.rows, total: page.count }
  }, signal))
  const routers = useWorkRead(scope, ['warehouse-pickups'], canFloat, (signal) => readRouterFloatOverview(scope, signal))
  const queues: WorkQueue[] = []

  if (canRequests || canEquipment) queues.push({
    key: 'pending-requests', title: 'Pending requests', context: 'Review or prepare for issue', priority: true, load: requests,
    rows: [
      ...(requests.data?.stock ?? []).filter((row) => row.status === 'pending_approval' || row.status === 'approved')
        .map((row) => ({
          id: row.id, title: row.project_name,
          detail: [row.requester_name, row.status === 'approved' ? 'Approved' : row.escalated_to_cfo ? 'Awaiting CFO approval' : 'Awaiting approval'].filter(Boolean).join(' · '),
          href: '/inventory/requests/' + row.id,
          action: row.status === 'approved' && hasPermission('inventory.issue') ? 'Issue'
            : row.status === 'pending_approval' && (hasPermission('inventory.approve') ||
              (hasPermission('inventory.issue') && !row.escalated_to_cfo)) ? 'Review approval' : 'View',
        })),
      ...(requests.data?.employee ?? []).map((row) => ({
        id: row.id, title: row.description,
        detail: [row.employee_name, row.status === 'needs_information' ? 'Waiting on employee' : 'Employee equipment'].filter(Boolean).join(' · '),
        href: '/inventory/employee-requests?request=' + row.id, action: row.status === 'needs_information' ? 'View' : 'Review',
      })),
    ],
    empty: 'No stock or equipment requests are waiting.',
  })
  if (canReturns) queues.push({
    key: 'returns-due', title: 'Returns due', context: 'Due today or overdue', priority: true, load: returns,
    href: '/custody/returns?due=due',
    rows: (returns.data ?? []).filter((row) => row.expected_return_date !== null && row.expected_return_date <= today)
      .sort((a, b) => (a.expected_return_date ?? '').localeCompare(b.expected_return_date ?? '')).map((row) => ({
        id: row.id, title: related(row.equipment)?.model_name ?? 'Equipment',
        detail: [
          related(row.custodian)?.display_name,
          lateReturn(row.expected_return_date, today) ? 'Overdue · ' + dayLabel(row.expected_return_date ?? today) : 'Due today',
        ].filter(Boolean).join(' · '),
        href: '/custody/returns?asset=' + row.equipment_asset_id, action: 'Open return',
      })),
    empty: 'No equipment returns are due.',
  })
  if (canStock) queues.push({
    key: 'running-low', title: 'Running low', context: 'At or below reorder level', priority: true, load: stock,
    rows: (stock.data ?? []).filter(runningLow)
      .sort((a, b) => a.balance - a.reorder_level - (b.balance - b.reorder_level))
      .map((row) => ({
        id: row.id, title: row.name,
        detail: row.balance + ' ' + row.unit_of_measure + ' on hand · Reorder at ' + row.reorder_level,
        href: '/inventory/consumables?sku=' + encodeURIComponent(row.sku), action: 'View stock',
      })),
    empty: 'All consumables are above their reorder levels.',
  })
  if (canFloat) queues.push({
    key: 'router-pickup', title: 'Router pickups', context: 'Waiting for technician confirmation', load: routers,
    rows: (routers.data?.active_float ?? []).filter((row) => row.float_state === 'pending_handover').map((row) => ({
      id: row.custody_id, title: 'CPE Router (' + row.model_name + ')',
      detail: row.custodian_name + ' · ' + row.serial_number,
      href: '/inventory/router-float?serial=' + encodeURIComponent(row.serial_number), action: 'Open float',
    })),
    empty: 'No router pickups are awaiting confirmation.',
  })

  return <WorkDashboard title="Warehouse today" description={dayLabel(today) + ' · Kampala'} queues={queues}
    action={<div className="flex flex-wrap items-center gap-3">
      {canFloat && <Link to="/inventory/router-float" className="text-sm font-medium text-emerald-600 hover:underline">Router Float</Link>}
      {canOpen('receiving') && <Link className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700" to="/inventory/receiving">Receive stock</Link>}
    </div>}>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {queues.filter((queue) => queue.key === 'pending-requests' || queue.key === 'returns-due').map((queue) =>
        <QueuePanel key={queue.key} queue={queue} limit={5} />)}
    </div>
  </WorkDashboard>
}
