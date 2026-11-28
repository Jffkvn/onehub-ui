import { ArrowUpRight, Boxes, Building2, ClockAlert, Radio, Router, TrafficCone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { readServiceRequestPage, useServiceActivityWindow } from '@/modules/field-services/api/services'
import type { ServiceRequestListRow } from '@/modules/field-services/schemas/services'
import { readRouterFloatOverview } from '@/modules/warehouse/router-float/routerFloatApi'
import { closureStats, dayLabel, fallsOnDay, previousWorkDate, readPages, workTimezone } from './workDashboardData'
import { QueueState, WorkDashboard, WorkIcon, type WorkQueue, workPanel } from './WorkDashboardLayout'
import { useWorkRead, type WorkAccess } from './useWorkRead'

type LateProject = {
  id: string
  name: string
  expected_end_date: string | null
}

type SiteUpdate = {
  id: string
  project_id: string
  summary: string
  status: 'submitted' | 'revision_requested' | 'endorsed'
  projects: { name: string } | null
}

function ticketRow(row: ServiceRequestListRow) {
  return {
    id: row.id, title: row.site_name,
    detail: row.internal_code + ' · ' + row.area_label,
    href: '/services/requests/' + row.id + '?from=/dashboard',
  }
}

export function DirectorWorkDashboard({ scope, canOpen, hasPermission }: WorkAccess) {
  const today = getTodayIsoInZone(workTimezone)
  const yesterday = previousWorkDate(today)
  const canReadService = hasPermission('service_requests.read') && canOpen('service-dispatch')
  const canProjects = canOpen('projects')
  const canProjectDetails = canProjects && (hasPermission('projects.read_all') || hasPermission('projects.manage'))
  const canReadTracker = canProjects && hasPermission('daily_updates.read_all')
  const canFloat = canOpen('router-float')
  const activity = useServiceActivityWindow(canReadService)
  const confirmed = useWorkRead(scope, ['director-closed', today], canReadService, (signal, check) => readPages(async (offset) => {
    check()
    const page = await readServiceRequestPage({ status: 'provider_confirmed', limit: 100, offset })
    return { rows: page.rows, total: page.total_count }
  }, signal), 60_000)
  const overdue = useWorkRead(scope, ['director-overdue'], canReadService, (signal, check) => readPages(async (offset) => {
    check()
    const page = await readServiceRequestPage({ overdueOnly: true, limit: 100, offset })
    return { rows: page.rows, total: page.total_count }
  }, signal), 30_000)
  const projects = useWorkRead(scope, ['director-late-projects', today], canProjectDetails, (signal, check) =>
    readPages<LateProject>(async (offset) => {
      check()
      const response = await getSupabaseClient().from('projects')
        .select('id,name,expected_end_date', { count: 'exact' }).in('status', ['planned', 'active', 'on_hold'])
        .lt('expected_end_date', today).order('expected_end_date').order('id')
        .range(offset, offset + 99).abortSignal(signal)
      if (response.error || response.count === null) throw new Error('Projects past target could not be loaded.')
      return { rows: response.data, total: response.count }
    }, signal))
  const updates = useWorkRead(scope, ['director-site-updates', yesterday], canReadTracker, (signal, check) =>
    readPages(async (offset) => {
      check()
      const response = await getSupabaseClient().from('daily_updates')
        .select('id,project_id,summary,status,projects(name)', { count: 'exact' })
        .eq('update_date', yesterday).neq('status', 'draft').order('created_at', { ascending: false })
        .order('id').range(offset, offset + 99).abortSignal(signal)
      if (response.error || response.count === null) throw new Error('Daily site updates could not be loaded.')
      return { rows: response.data as unknown as SiteUpdate[], total: response.count }
    }, signal))
  const routers = useWorkRead(scope, ['director-router-float'], canFloat, (signal) => readRouterFloatOverview(scope, signal))
  const queues: WorkQueue[] = []

  const confirmations = (confirmed.data ?? []).filter((row) => fallsOnDay(row.provider_confirmed_at, yesterday))
  const closed = (confirmed.data ?? []).filter((row) =>
    row.provider_confirmed_at && Date.parse(row.provider_confirmed_at) < Date.parse(today + 'T00:00:00+03:00')
  )
  const stats = closureStats(closed)
  if (canReadService) queues.push({
    key: 'overdue-sla', title: 'Overdue SLA', context: 'Open service tickets past deadline', priority: 'danger', load: overdue,
    accent: { icon: ClockAlert, tone: 'blue' },
    rows: (overdue.data ?? []).map(ticketRow), empty: 'No open service tickets are past their deadline.',
    href: canOpen('service-monitor') ? '/services/monitor?bucket=overdue' : undefined,
  })
  if (canProjectDetails) queues.push({
    key: 'projects-past-target', title: 'Projects past target', context: 'Open sites past their expected end date', priority: 'warning', load: projects,
    accent: { icon: TrafficCone, tone: 'amber' },
    rows: (projects.data ?? []).map((row) => ({
      id: row.id, title: row.name, detail: row.expected_end_date
        ? dayLabel(row.expected_end_date) + ' target · ' + (Date.parse(today) - Date.parse(row.expected_end_date)) / 86_400_000 + ' days past target'
        : undefined,
      href: '/projects/' + row.id + '/summary',
    })),
    empty: 'No open construction projects are past their target date.',
  })
  if (canFloat) queues.push({
    key: 'faulty-routers', title: 'Faulty routers to return', context: 'Currently held by technicians', priority: 'warning', load: routers,
    accent: { icon: Router, tone: 'violet' },
    rows: (routers.data?.active_float ?? []).filter((row) => row.float_state === 'faulty_to_return').map((row) => ({
      id: row.custody_id, title: 'CPE Router (' + row.model_name + ')', detail: row.custodian_name + ' · ' + row.serial_number,
      href: '/inventory/router-float?serial=' + encodeURIComponent(row.serial_number),
    })),
    empty: 'No faulty routers are waiting to be returned.',
  })

  const focusQueues: WorkQueue[] = [
    ...(canReadService ? [{
      key: 'provider-confirmed', title: 'Provider confirmations', context: 'Yesterday · ' + dayLabel(yesterday), load: confirmed,
      rows: confirmations.map(ticketRow), empty: 'The provider confirmed no tickets yesterday.',
    }] : []),
    ...(canReadTracker ? [{
      key: 'construction-updates', title: 'Construction updates', context: 'Yesterday · ' + dayLabel(yesterday), load: updates,
      rows: (updates.data ?? []).map((row) => ({
        id: row.id, title: row.projects?.name ?? 'Construction project',
        detail: { endorsed: 'Endorsed', revision_requested: 'Revision requested', submitted: 'Submitted' }[row.status],
        href: '/projects/' + row.project_id + '/updates?date=' + yesterday, action: 'View tracker',
      })),
      empty: 'No daily site updates were recorded for yesterday.',
    }] : []),
    ...(canFloat ? [{
      key: 'router-handover', title: 'Router pickups confirmed', context: 'Yesterday · Units still in technician float', load: routers,
      rows: (routers.data?.active_float ?? []).filter((row) => fallsOnDay(row.confirmed_at, yesterday)).map((row) => ({
        id: row.custody_id, title: 'CPE Router (' + row.model_name + ')', detail: row.custodian_name + ' · ' + row.serial_number,
        href: '/inventory/router-float?serial=' + encodeURIComponent(row.serial_number),
      })),
      empty: 'No routers currently in float were picked up yesterday.',
    }] : []),
  ]

  return <WorkDashboard title="What happened yesterday?" description={dayLabel(yesterday) + ' · Kampala'}
    queues={queues} overviewQueues={focusQueues} queuesAfterContent
    action={canOpen('service-monitor') && <Link className="text-sm font-medium text-emerald-600 hover:underline" to="/services/monitor">Operations monitor</Link>}>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {canReadService && <section className={workPanel} aria-label="Fixed Internet">
        <h2 className="mb-4 flex items-center gap-3 font-display text-lg font-semibold text-ink">
          <WorkIcon icon={Radio} tone="blue" /> Fixed Internet
        </h2>
        <QueueState load={activity}>
          {activity.data && <dl className="grid gap-3 rounded-lg bg-blue-tint p-3 sm:grid-cols-3">
            <div><dt className="text-sm text-soft">Submitted</dt><dd className="font-display text-2xl font-semibold tabular-nums">{activity.data.yesterday.submittedCount}</dd></div>
            <div><dt className="text-sm text-soft">Visits completed</dt><dd className="font-display text-2xl font-semibold tabular-nums">{activity.data.yesterday.visitsCompletedCount}</dd></div>
            <div><dt className="text-sm text-soft">Provider confirmed</dt>
              <dd><Link to="?focus=provider-confirmed" className="inline-flex items-center gap-1 font-display text-2xl font-semibold tabular-nums text-teal-700 hover:underline dark:text-teal-300">
                {activity.data.yesterday.providerConfirmedCount} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link></dd></div>
          </dl>}
        </QueueState>
        <div className="mt-3">
          <QueueState load={confirmed}>
            <p className="text-sm text-soft">
              {stats.hours === null ? 'No confirmed tickets with receipt and confirmation times.' : <>
                <strong className="text-ink">{stats.hours.toFixed(1)} hours</strong> average from request received to provider confirmation
              </>}
            </p>
            {stats.withDeadline > 0 && <p className="mt-1 text-sm text-soft"><strong className="text-ink">
              {stats.onTime} of {stats.withDeadline}</strong> confirmed by deadline</p>}
            {stats.timed > 0 && <p className="mt-1 text-xs text-muted">All provider confirmations through yesterday · {stats.timed} timed tickets</p>}
          </QueueState>
        </div>
      </section>}
      <div className="space-y-4">
        {canReadTracker && <section className={workPanel} aria-label="Construction">
          <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-semibold text-ink">
            <WorkIcon icon={Building2} tone="teal" /> Construction
          </h2>
          <QueueState load={updates}>
            {updates.data?.length ? <>
              <Link to="?focus=construction-updates" className="text-sm font-medium text-emerald-600 hover:underline">{updates.data.length} site {updates.data.length === 1 ? 'update' : 'updates'}</Link>
              <p className="mt-1 line-clamp-2 break-words text-sm text-soft">{updates.data[0].projects?.name} · {updates.data[0].summary}</p>
            </> : <p className="text-sm text-soft">No site updates recorded for yesterday.</p>}
          </QueueState>
        </section>}
        {canFloat && <section className={workPanel} aria-label="Warehouse router float">
          <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-semibold text-ink">
            <WorkIcon icon={Boxes} tone="violet" /> Warehouse · Router float
          </h2>
          <QueueState load={routers}>
            <Link className="text-sm font-medium text-emerald-600 hover:underline" to="?focus=router-handover">
              {focusQueues.find((queue) => queue.key === 'router-handover')?.rows.length ?? 0} pickups yesterday still in float
            </Link>
            <p className="mt-1 text-xs text-muted">{routers.data?.available_routers.length} CPE routers in warehouse now</p>
          </QueueState>
        </section>}
      </div>
    </div>
    {queues.length > 0 && <h2 className="-mb-2 font-display text-lg font-semibold text-ink">Needs attention now</h2>}
  </WorkDashboard>
}
