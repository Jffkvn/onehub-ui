import { Link } from 'react-router-dom'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { readCashAdvances, readCashBalance } from '@/modules/project-cash/projectCashApi'
import { stockRequestsApi } from '@/modules/warehouse/requests/requestApi'
import { dayLabel, previousWorkDate, readPages, workTimezone } from './workDashboardData'
import { QueuePanel, WorkDashboard, type WorkQueue } from './WorkDashboardLayout'
import { useWorkRead, type WorkAccess } from './useWorkRead'

type Assignment = {
  project_id: string
  assigned_at: string
  role_on_project: 'pm' | 'coordinator'
  projects: { name: string; status: 'planned' | 'active' | 'on_hold'; planned_start_date: string | null }
}

export function TowerWorkDashboard({ scope, canOpen, hasPermission }: WorkAccess) {
  const today = getTodayIsoInZone(workTimezone)
  const yesterday = previousWorkDate(today)
  const canReport = hasPermission('daily_updates.create') || hasPermission('daily_updates.read')
  const projects = useWorkRead(scope, ['tower-assignments'], canOpen('projects'), (signal, check) =>
    readPages(async (offset) => {
      check()
      const response = await getSupabaseClient().from('project_assignments')
        .select('project_id,assigned_at,role_on_project,projects!inner(name,status,planned_start_date)', { count: 'exact' })
        .eq('user_id', scope.identityKey ?? '').is('unassigned_at', null)
        .in('projects.status', ['planned', 'active', 'on_hold'])
        .order('project_id').order('id').range(offset, offset + 99).abortSignal(signal)
      if (response.error || response.count === null) throw new Error('Assigned projects could not be loaded.')
      return { rows: response.data as unknown as Assignment[], total: response.count }
    }, signal))
  const updates = useWorkRead(scope, ['tower-updates', yesterday, today], canReport && canOpen('projects'), (signal, check) =>
    readPages(async (offset) => {
      check()
      const response = await getSupabaseClient().from('daily_updates')
        .select('project_id,update_date,status', { count: 'exact' })
        .eq('submitted_by', scope.identityKey ?? '').gte('update_date', yesterday).lte('update_date', today)
        .neq('status', 'draft').order('id').range(offset, offset + 99).abortSignal(signal)
      if (response.error || response.count === null) throw new Error('Your recent daily updates could not be loaded.')
      return { rows: response.data, total: response.count }
    }, signal))
  const stock = useWorkRead(scope, ['tower-stock'], canOpen('requests'), () => stockRequestsApi(scope).list())
  const cash = useWorkRead(scope, ['tower-cash'], canOpen('cash'), async (_signal, check) => {
    const disbursed = (await readCashAdvances(scope)).filter((row) =>
      row.status === 'disbursed' && row.user_id === scope.identityKey)
    return Promise.all(disbursed.map(async (row) => {
      check()
      return { row, balance: await readCashBalance(scope, row.id) }
    }))
  })

  const byProject = new Map((projects.data ?? []).map((entry) => [entry.project_id, entry]))
  const assigned = [...byProject.values()].sort((a, b) => a.projects.name.localeCompare(b.projects.name))
  const queues: WorkQueue[] = []
  if (canOpen('projects')) queues.push({
    key: 'assigned-projects', title: 'Assigned projects', context: 'Planned, active or on hold', load: projects,
    rows: assigned.map((entry) => ({
      id: entry.project_id, title: entry.projects.name,
      detail: { active: 'Active', planned: 'Planned', on_hold: 'On hold' }[entry.projects.status],
      href: '/projects/' + entry.project_id + '/summary', action: 'View project',
    })),
    empty: 'You have no current construction projects assigned.',
  })
  if (canOpen('projects') && canReport) queues.push({
    key: 'updates-due', title: 'Daily updates due', context: 'Today and yesterday', priority: true,
    load: {
      isPending: projects.isPending || updates.isPending, isError: projects.isError || updates.isError,
      refetch: () => Promise.all([projects.refetch(), updates.refetch()]),
    },
    rows: [yesterday, today].flatMap((date) => assigned.filter((entry) =>
      entry.role_on_project === 'coordinator' && entry.projects.status === 'active' &&
      (!entry.projects.planned_start_date || entry.projects.planned_start_date <= date) &&
      getTodayIsoInZone(workTimezone, new Date(entry.assigned_at)) <= date &&
      !updates.data?.some((update) => update.project_id === entry.project_id && update.update_date === date))
      .map((entry) => ({
        id: entry.project_id + date, title: entry.projects.name,
        detail: date === today ? 'Today' : 'Yesterday · ' + dayLabel(date),
        href: '/projects/' + entry.project_id + '/updates?date=' + date, action: 'Open tracker',
      }))),
    empty: 'Your active sites are up to date for both days.',
  })
  if (canOpen('requests')) queues.push({
    key: 'open-stock', title: 'Open stock requests', context: 'Waiting for approval or issue', load: stock,
    rows: (stock.data ?? []).filter((row) => row.status === 'pending_approval' || row.status === 'approved').map((row) => ({
      id: row.id, title: row.project_name,
      detail: row.status === 'approved' ? 'Approved. Waiting for issue' : 'Awaiting approval',
      href: '/inventory/requests/' + row.id, action: 'View request',
    })),
    empty: 'You have no project stock requests awaiting approval or issue.',
  })
  if (canOpen('cash')) queues.push({
    key: 'cash-to-account', title: 'Project cash to account for', context: 'Disbursed cash with a balance', load: cash, priority: true,
    rows: (cash.data ?? []).filter(({ balance }) => balance > 0).map(({ row, balance }) => ({
      id: row.id, title: row.projects?.name ?? row.purpose,
      detail: 'UGX ' + balance.toLocaleString('en-UG') + ' outstanding · ' + row.purpose,
      href: '/ops/cash/' + row.id, action: 'Open accountability',
    })),
    empty: 'You have no outstanding disbursed project cash.',
  })
  return <WorkDashboard title="Construction today" queues={queues}
    action={canOpen('projects') && <Link className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300" to="/ops/projects/tracker">Daily tracker</Link>}>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {queues.filter((queue) => queue.key === 'updates-due' || queue.key === 'cash-to-account').map((queue) =>
        <QueuePanel key={queue.key} queue={queue} limit={4} />)}
    </div>
  </WorkDashboard>
}
