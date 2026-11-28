import { CalendarCheck, CalendarDays, CalendarRange, CircleCheck, ClockAlert, ClipboardList, Info, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getSupabaseClient } from '@/lib/supabase/client'
import { readAttendanceRegisterPage, useAttendanceSetupOverview } from '@/modules/attendance/api/attendance'
import { formatTimeInZone, getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import type { RegisterRow } from '@/modules/attendance/schemas/attendance'
import { leaveRpc, workspaceSchema } from '@/modules/leave/api/leave'
import { useAdvances } from '@/modules/staff-advances/api'
import { dayLabel, fallsOnDay, previousWorkDate, readPages, workTimezone } from './workDashboardData'
import { QueuePanel, QueueState, WorkDashboard, type WorkQueue, type WorkRow, workPanel } from './WorkDashboardLayout'
import { useWorkRead, type WorkAccess } from './useWorkRead'

type PendingLeave = {
  id: string
  created_at: string
  employees: { legal_name: string } | null
  leave_types: { name: string; requires_evidence: boolean } | null
  leave_documents: { id: string }[]
}

type EmployeeMilestones = {
  id: string
  legal_name: string
  date_of_birth: string | null
  employment_periods: { start_date: string; end_date: string | null }[]
}

function requestAge(timestamp: string | null | undefined, today: string, yesterday: string) {
  if (!timestamp) return undefined
  if (fallsOnDay(timestamp, today)) return 'Today'
  if (fallsOnDay(timestamp, yesterday)) return 'Yesterday'
  return dayLabel(getTodayIsoInZone(workTimezone, new Date(timestamp)))
}

function registerLink(day: string, employee?: string, status?: string) {
  const params = new URLSearchParams({ from: day, to: day })
  if (employee) params.set('employee', employee)
  if (status) params.set('status', status)
  return '/people/attendance?' + params.toString()
}

function attendanceRow(row: RegisterRow, detail?: string): WorkRow {
  return {
    id: row.employee_id,
    title: row.employee_name,
    detail: [detail, row.department_name].filter(Boolean).join(' · '),
    href: registerLink(row.local_date, row.employee_id),
  }
}

export function HrWorkDashboard({ scope, canOpen }: WorkAccess) {
  const today = getTodayIsoInZone(workTimezone)
  const yesterday = previousWorkDate(today)
  const canAttendance = canOpen('attendance')
  const canLeave = canOpen('leave')
  const canAdvances = canOpen('advances')
  const setup = useAttendanceSetupOverview(canAttendance)
  const register = useWorkRead(scope, ['hr-attendance', yesterday, today], canAttendance, (signal, check) =>
    readPages(async (offset) => {
      check()
      const page = await readAttendanceRegisterPage({ from: yesterday, to: today, limit: 100, offset })
      return { rows: page.rows, total: page.total_count }
    }, signal), 60_000)

  const leave = useWorkRead(scope, ['hr-leave', today], canLeave, async (signal, check) => {
    const db = getSupabaseClient()
    const pending = readPages(async (offset) => {
      check()
      const response = await db.from('leave_requests').select(
        'id,created_at,employees(legal_name),leave_types(name,requires_evidence),leave_documents(id)', { count: 'exact' },
      ).eq('status', 'pending').order('created_at').order('id')
        .range(offset, offset + 99).abortSignal(signal)
      if (response.error || response.count === null) throw new Error('Pending leave could not be loaded.')
      return { rows: response.data as unknown as PendingLeave[], total: response.count }
    }, signal)
    const approved = readPages(async (offset) => {
      check()
      const page = workspaceSchema.parse(await leaveRpc('rpc_leave_workspace', {
        p_manage: true, p_employee_id: null, p_year: Number(today.slice(0, 4)),
        p_filter: { status: 'approved', offset },
      }))
      return { rows: page.requests, total: page.request_total }
    }, signal)
    const [waiting, approvedRows] = await Promise.all([pending, approved])
    return { waiting, onLeave: approvedRows.filter((row) => row.allocations?.some((allocation) => allocation.leave_date === today)) }
  }, 60_000)
  const people = useWorkRead(scope, ['hr-dates', today], canOpen('employees'), (signal, check) =>
    readPages<EmployeeMilestones>(async (offset) => {
      check()
      const response = await getSupabaseClient().from('employees').select(
        'id,legal_name,date_of_birth,employment_periods(start_date,end_date)', { count: 'exact' },
      ).is('archived_at', null).order('id').range(offset, offset + 99).abortSignal(signal)
      if (response.error || response.count === null) throw new Error('Employee dates could not be loaded.')
      return { rows: response.data, total: response.count }
    }, signal))

  const advances = useAdvances(scope, true, canAdvances)
  const rows = register.data ?? []
  const todayRows = rows.filter((row) => row.local_date === today)
  const waitingLeave = leave.data?.waiting ?? []
  const onLeave = Array.from(new Map(leave.data?.onLeave.map((row) => [row.employee_id, row])).values())
  const queues: WorkQueue[] = []
  const followUps: WorkQueue[] = []

  if (canAttendance) {
    queues.push(
      {
        key: 'clocked-in', title: 'Clocked in', context: 'Today', load: register,
        accent: { icon: CircleCheck, tone: 'teal' },
        rows: todayRows.filter((row) => row.clock_in_at).map((row) =>
          attendanceRow(row, formatTimeInZone(row.clock_in_at, row.timezone))),
        empty: 'No clock-ins recorded today.', href: registerLink(today),
      },
      {
        key: 'late', title: 'Late arrivals', context: 'Today', load: register, priority: true,
        accent: { icon: ClockAlert, tone: 'amber' },
        rows: todayRows.filter((row) => row.clock_in_at && row.punctuality === 'late').map((row) =>
          attendanceRow(row, formatTimeInZone(row.clock_in_at, row.timezone))),
        empty: 'No late arrivals recorded today.',
      },
    )
    const missed: WorkQueue = {
      key: 'missed-clock-outs', title: 'Missed clock-outs', context: 'Yesterday · ' + dayLabel(yesterday),
      accent: { icon: ClockAlert, tone: 'amber' },
      load: register, priority: true, href: registerLink(yesterday, undefined, 'missing_clock_out'),
      rows: rows.filter((row) => row.local_date === yesterday && row.effective_state === 'missing_clock_out')
        .map((row) => attendanceRow(row, row.clock_in_at ? 'In at ' + formatTimeInZone(row.clock_in_at, row.timezone) : undefined)),
      empty: 'No missed clock-outs recorded yesterday.',
    }
    followUps.push(missed)
  }
  if (canLeave) {
    queues.splice(Math.min(2, queues.length), 0, {
      key: 'on-leave', title: 'On leave', context: 'Today', load: leave,
      accent: { icon: CalendarCheck, tone: 'blue' },
      rows: onLeave.map((row) => ({
        id: row.id, title: row.employee_name, detail: row.leave_type_name,
        href: '/people/leave?request=' + row.id, action: 'View',
      })),
      empty: 'Nobody is on approved leave today.',
    })
    const leaveQueue: WorkQueue = {
      key: 'leave-requests', title: 'Leave requests to review', context: 'New and carried over', load: leave,
      accent: { icon: CalendarRange, tone: 'blue' },
      rows: waitingLeave.map((row) => ({
        id: row.id, title: row.employees?.legal_name ?? 'Employee leave request',
        detail: [
          row.leave_types?.name,
          requestAge(row.created_at, today, yesterday),
          row.leave_types?.requires_evidence
            ? row.leave_documents.length ? 'Supporting note attached' : 'Supporting note missing'
            : null,
        ].filter(Boolean).join(' · '),
        href: '/people/leave?request=' + row.id, action: 'Review',
      })),
      empty: 'No leave requests are waiting for a decision.',
    }
    followUps.unshift(leaveQueue)
  }
  if (canAdvances) {
    const advancesQueue: WorkQueue = {
      key: 'advance-requests', title: 'Salary advances to review', context: 'New and carried over', load: advances,
      accent: { icon: Wallet, tone: 'violet' },
      rows: (advances.data ?? []).filter((row) => row.status === 'pending').reverse().map((row) => ({
        id: row.id, title: row.employee_name,
        detail: ['UGX ' + row.amount.toLocaleString('en-UG'), requestAge(row.submitted_at, today, yesterday)].filter(Boolean).join(' · '),
        href: '/finance/advances?advance=' + row.id, action: 'Review',
      })),
      empty: 'No salary advances are waiting for a decision.',
    }
    followUps.splice(canLeave ? 1 : 0, 0, advancesQueue)
  }

  const reviewQueues = followUps.filter((queue) => queue.key !== 'missed-clock-outs')
  const clockOuts = followUps.find((queue) => queue.key === 'missed-clock-outs')
  const milestones: WorkRow[] = []
  for (const person of people.data ?? []) {
    const employment = person.employment_periods.find((period) =>
      period.start_date <= today && (!period.end_date || period.end_date >= today))
    if (!employment) continue
    const date = new Date(today + 'T00:00:00Z')
    for (let offset = 0; offset < 7; offset += 1) {
      const day = date.toISOString().slice(0, 10)
      const anniversaryYears = Number(day.slice(0, 4)) - Number(employment.start_date.slice(0, 4))
      const birthday = day.slice(5) === person.date_of_birth?.slice(5)
      const anniversary = day.slice(5) === employment.start_date.slice(5) && anniversaryYears > 0
      if (birthday || anniversary) milestones.push({
        id: person.id + day, title: person.legal_name,
        detail: [
          dayLabel(day), birthday && 'Birthday',
          anniversary && (anniversaryYears + (anniversaryYears === 1 ? ' year' : ' years') + ' with the company'),
        ].filter(Boolean).join(' · '),
        href: '/people/employees/' + person.id, action: 'View',
      })
      date.setUTCDate(date.getUTCDate() + 1)
    }
  }

  return (
    <WorkDashboard title="People today"
      queues={queues} overviewQueues={followUps}
      action={canOpen('reports') && <Link className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300" to="/system/reports">HR reports</Link>}>
      {canAttendance && !setup.isError && setup.data?.policy.enabled === false && (
        <p role="status" className="flex items-start gap-2.5 rounded-lg border border-blue/20 bg-blue-tint/60 px-4 py-3 text-sm text-soft">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-blue-700 dark:text-blue-300" />
          <span>Live clock-ins are paused. The dashboard shows attendance already recorded.</span>
        </p>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {reviewQueues.length > 0 && <section className={workPanel} aria-label="Waiting for HR">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <ClipboardList aria-hidden="true" className="size-5 text-teal-700 dark:text-teal-300" /> Waiting for HR
          </h2>
          <div className="space-y-4 divide-y divide-line">
            {reviewQueues.map((queue, index) => <div key={queue.key} className={index ? 'pt-4' : undefined}>
              <QueuePanel queue={queue} limit={3} embedded />
            </div>)}
          </div>
        </section>}
        <div className="space-y-4">
          {clockOuts && <QueuePanel queue={clockOuts} limit={3} />}
          {canOpen('employees') && <section className={workPanel} aria-label="Coming up">
            <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-semibold text-ink">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-tint text-emerald-800 dark:text-emerald-300">
                <CalendarDays aria-hidden="true" className="size-5" />
              </span>
              Coming up this week
            </h2>
            <QueueState load={people}>
              {milestones.length > 0
                ? <ul className="divide-y divide-line">{milestones.map((row) => <li key={row.id} className="py-2 text-sm">
                  <Link className="font-medium hover:underline" to={row.href ?? '/people/employees'}>{row.title}</Link>
                  <p className="text-sm text-soft">{row.detail}</p>
                </li>)}</ul>
                : <p className="text-sm text-soft">No birthdays or work anniversaries this week.</p>}
            </QueueState>
          </section>}
        </div>
      </div>
    </WorkDashboard>
  )
}
