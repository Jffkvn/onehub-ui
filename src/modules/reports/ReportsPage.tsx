import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, ClipboardCheck, Clock3, FileSpreadsheet, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { FieldError, Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'
import { employmentTypes, exportReport, readReport, reportFilterError, ReportsAccessError, type ReportFilters, type ReportKind, type WorkforceReport } from './api'
import { FinancialView, WorkforceView } from './ReportViews'
import { OperationalReportView } from './OperationalReportView'

const reportOptions = {
  workforce: {
    title: 'Workforce',
    question: 'How is our workforce changing?',
    subtitle: 'Headcount, hires, exits and workforce composition.',
    icon: Users,
    tone: 'bg-violet-tint text-violet',
  },
  'employment-changes': {
    title: 'Employment changes',
    question: 'What changed in our workforce?',
    subtitle: 'Hires, rehires, exits and assignment changes by effective date.',
    icon: Users,
    tone: 'bg-violet-tint text-violet',
  },
  'record-completeness': {
    title: 'Employee record completeness',
    question: 'Which employee records need attention?',
    subtitle: 'See which required profile, employment and payment fields are missing.',
    icon: ClipboardCheck,
    tone: 'bg-violet-tint text-violet',
  },
  'salary-spread': {
    title: 'Salary spread',
    question: 'How are current salaries distributed?',
    subtitle: 'Active employees grouped into monthly gross salary bands.',
    icon: Banknote,
    tone: 'bg-emerald-tint text-emerald-600',
  },
  leave: {
    title: 'Leave utilization',
    question: 'How much leave has been approved?',
    subtitle: 'Approved leave days and requests by leave type.',
    icon: CalendarDays,
    tone: 'bg-emerald-tint text-emerald-600',
  },
  'leave-year-end': {
    title: 'Year-end leave balances',
    question: 'Who still has annual leave to plan?',
    subtitle: 'Leave taken, upcoming bookings and in-app reminders.',
    icon: CalendarDays,
    tone: 'bg-violet-tint text-violet',
  },
  'department-attendance': {
    title: 'Attendance by department',
    question: 'How are teams showing up for scheduled shifts?',
    subtitle: 'Arrivals, punctuality and missing punches across verified schedules.',
    icon: Clock3,
    tone: 'bg-violet-tint text-violet',
  },
  payroll: {
    title: 'Payroll and staff advances',
    question: 'What are our payroll and staff advance figures?',
    subtitle: 'Approved run totals and current outstanding staff advances.',
    icon: Banknote,
    tone: 'bg-emerald-tint text-emerald-600',
  },
}

const filterSelectClass = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald'
const labelClass = 'block space-y-1.5 text-sm font-semibold text-soft'

function isReportKind(kind: string | null): kind is ReportKind {
  return kind !== null && Object.hasOwn(reportOptions, kind)
}

function canOpenReport(kind: ReportKind, permissions: readonly string[]) {
  if (kind === 'salary-spread') return permissions.includes('payroll.read')
  if (kind === 'record-completeness') return permissions.includes('employees.read')
  if (kind === 'leave' || kind === 'leave-year-end') return permissions.includes('leave.manage')
  if (kind === 'department-attendance') {
    return permissions.includes('attendance.read_all') || permissions.includes('attendance.manage')
  }
  return true
}

function ReportsHub({ permissions }: { permissions: readonly string[] }) {
  return (
    <>
      <PageHeader title="Reports" />
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(reportOptions) as ReportKind[]).filter((kind) => canOpenReport(kind, permissions)).map((kind) => {
          const { icon: Icon, question, subtitle, tone } = reportOptions[kind]
          return (
            <Link key={kind} to={{ search: '?report=' + kind }}
              className="group flex min-w-0 items-start gap-4 rounded-lg border border-line bg-surface p-5 shadow-xs transition-colors hover:border-emerald/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald">
              <span className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ' + tone}>
                <Icon size={19} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-semibold text-ink sm:text-lg">{question}</h2>
                <p className="mt-1 text-sm text-muted">{subtitle}</p>
              </div>
              <ArrowRight size={18} className="mt-1 shrink-0 text-muted group-hover:text-emerald" aria-hidden="true" />
            </Link>
          )
        })}
      </div>
    </>
  )
}

function usesDateRange(kind: ReportKind) {
  return kind !== 'leave-year-end' && kind !== 'salary-spread' && kind !== 'record-completeness'
}

function usesEmploymentType(kind: ReportKind) {
  return kind === 'workforce' || kind === 'employment-changes' || kind === 'salary-spread' || kind === 'record-completeness'
}

function FiltersForm({ filters, kind, today, departments, onApply }: {
  filters: ReportFilters
  kind: ReportKind
  today: string
  departments: WorkforceReport['departmentOptions']
  onApply: (filters: ReportFilters) => void
}) {
  const [draft, setDraft] = useState(filters)
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const issue = reportFilterError(draft, kind, today)
    setError(issue)
    if (!issue) onApply(draft)
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <div className="grid grid-cols-1 items-end gap-3 min-[380px]:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        {usesDateRange(kind) && (
          <>
            <label className={labelClass}>
              <span>From date</span>
              <Input type="date" required value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
            </label>
            <label className={labelClass}>
              <span>To date</span>
              <Input type="date" required value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
            </label>
          </>
        )}
        {kind !== 'payroll' && (
            <label className={labelClass}>
              <span>Department</span>
              <select className={filterSelectClass} value={draft.department}
                onChange={(event) => setDraft({ ...draft, department: event.target.value })}>
                <option value="">All departments</option>
                {draft.department && !departments.some(({ id }) => id === draft.department) && (
                  <option value={draft.department}>Selected department</option>
                )}
                {departments.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
        )}
        {usesEmploymentType(kind) && (
            <label className={labelClass}>
              <span>Employment type</span>
              <select className={filterSelectClass} value={draft.employmentType}
                onChange={(event) => setDraft({ ...draft, employmentType: event.target.value })}>
                <option value="">All types</option>
                {employmentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
        )}
        <Button type="submit" className="justify-self-start">Apply filters</Button>
      </div>
      {error && <FieldError className="mt-2">{error}</FieldError>}
    </form>
  )
}

function ReportDetail({ kind, scope, canExport }: { kind: ReportKind; scope: IdentityScopeRef; canExport: boolean }) {
  const [search, setSearch] = useSearchParams()
  const [initialDate] = useState(() => getTodayIsoInZone('Africa/Kampala'))
  const attendanceStart = new Date(Date.parse(initialDate) - 29 * 86_400_000).toISOString().slice(0, 10)
  const filters: ReportFilters = {
    from: usesDateRange(kind)
      ? search.get('from') ?? (kind === 'department-attendance' ? attendanceStart : initialDate.slice(0, 4) + '-01-01')
      : initialDate,
    to: (usesDateRange(kind) ? search.get('to') : null) ?? initialDate,
    department: kind === 'payroll' ? '' : search.get('department') ?? '',
    employmentType: usesEmploymentType(kind) ? search.get('employmentType') ?? '' : '',
  }
  const issue = reportFilterError(filters, kind, initialDate)
  const query = useQuery({
    queryKey: ['hr-reports', scope.identityKey, scope.authEpoch, kind, filters] as const,
    enabled: !issue,
    retry: false,
    queryFn: ({ signal }) => readReport(kind, filters, scope, signal),
  })
  const report = !issue && !query.isError ? query.data : undefined
  const download = useMutation({
    mutationFn: ({ data, applied }: { data: NonNullable<typeof report>; applied: ReportFilters }) => exportReport(data, applied, scope),
  })

  function applyFilters(next: ReportFilters) {
    const updated = new URLSearchParams({ report: kind })
    if (usesDateRange(kind)) {
      updated.set('from', next.from)
      updated.set('to', next.to)
    }
    if (next.department) updated.set('department', next.department)
    if (next.employmentType) updated.set('employmentType', next.employmentType)
    download.reset()
    setSearch(updated)
  }

  const allowedExport = canExport && report && (report.kind !== 'payroll' || report.data.payroll || report.data.advances)
  return (
    <>
      <Link to="/system/reports" className="inline-flex items-center gap-2 rounded text-sm font-medium text-soft hover:text-ink focus-visible:outline-emerald">
        <ArrowLeft size={16} aria-hidden="true" /> All reports
      </Link>
      <PageHeader title={reportOptions[kind].title} actions={allowedExport && report && (
        <Button variant="outline" disabled={download.isPending} leftIcon={<FileSpreadsheet size={16} />}
          onClick={() => download.mutate({ data: report, applied: filters })}>
          {download.isPending ? 'Preparing Excel…' : 'Export Excel'}
        </Button>
      )} />
      {download.isError && !isAbortError(download.error) && (
        <FieldError>{download.error instanceof ReportsAccessError
          ? 'Your account does not have access to export this report.'
          : 'Could not export this report. Try again.'}</FieldError>
      )}
      <FiltersForm key={`filters:${JSON.stringify(filters)}`} filters={filters} kind={kind} today={initialDate}
        departments={report && report.kind !== 'payroll' ? report.data.departmentOptions : []} onApply={applyFilters} />
      {issue && <FieldError>{issue}</FieldError>}
      {!issue && query.isPending && (
        <div aria-busy="true">
          <p role="status" className="sr-only">Loading report…</p>
          <Skeleton shape="row" className="h-28" />
        </div>
      )}
      {!issue && query.isError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
          <FieldError>{query.error instanceof ReportsAccessError
            ? 'Your account does not have access to this report.'
            : 'Could not load this report.'}</FieldError>
          {!(query.error instanceof ReportsAccessError) && (
            <Button type="button" variant="outline" size="sm" onClick={() => { void query.refetch() }}>Retry</Button>
          )}
        </div>
      )}
      {report?.kind === 'workforce' && <WorkforceView data={report.data} showMissingEmployment={!filters.department && !filters.employmentType} />}
      {report?.kind === 'payroll' && <FinancialView data={report.data} />}
      {report && report.kind !== 'workforce' && report.kind !== 'payroll' && (
        <OperationalReportView key={`figures:${JSON.stringify(filters)}`} report={report} scope={scope} onRefresh={() => { void query.refetch() }} />
      )}
    </>
  )
}

export default function ReportsPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const [search] = useSearchParams()
  const permissions = auth.access?.permissionKeys ?? []
  if (!scope.isAuthReady || !scope.identityKey || !permissions.includes('reports.view')) return <ForbiddenPage />

  const kind = search.get('report')
  if (isReportKind(kind) && !canOpenReport(kind, permissions)) return <ForbiddenPage />
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      {isReportKind(kind) ? (
        <ReportDetail key={`${scope.identityKey}:${scope.authEpoch}:${kind}`} kind={kind} scope={scope}
          canExport={permissions.includes('reports.export')} />
      ) : <ReportsHub permissions={permissions} />}
    </main>
  )
}
