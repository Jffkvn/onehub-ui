import { ArrowDownRight, ArrowUpRight, Banknote, Percent, Users } from 'lucide-react'

import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { KpiCard } from '@/components/patterns/KpiCard'
import type { FinancialReport, WorkforceReport } from './api'

const countFormat = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 })
const monthFormat = new Intl.DateTimeFormat('en-UG', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dateFormat = new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeZone: 'UTC' })
const monthLabel = (date: string) => monthFormat.format(new Date(date + 'T00:00:00Z'))

const sectionClass = 'min-w-0 rounded-lg border border-line bg-surface p-4 sm:p-5'
const headingClass = 'font-display text-lg font-semibold text-ink'
const quietText = 'text-sm text-muted'

type Movement = WorkforceReport['monthly'][number]
const movementColumns: ColumnDef<Movement>[] = [
  { key: 'month', header: 'Month', accessor: (row) => monthLabel(row.month) },
  { key: 'headcount', header: 'Closing headcount', align: 'right', accessor: (row) => countFormat.format(row.headcount) },
  { key: 'hires', header: 'Hires', align: 'right', accessor: (row) => countFormat.format(row.hires) },
  { key: 'exits', header: 'Exits', align: 'right', accessor: (row) => countFormat.format(row.exits) },
]

function Breakdown({ title, empty, rows }: { title: string; empty: string; rows: WorkforceReport['departments'] }) {
  const scale = Math.max(1, ...rows.map(({ count }) => count))
  return (
    <section className={sectionClass}>
      <h2 className={headingClass}>{title}</h2>
      {rows.length === 0 ? <p className={'mt-3 ' + quietText}>{empty}</p> : (
        <ul className="mt-4 space-y-4">
          {rows.map(({ label, count }) => (
            <li key={label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-sm text-soft">{label}</span>
                <strong className="text-sm tabular-nums text-ink">{countFormat.format(count)}</strong>
              </div>
              <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/60">
                <div className="h-full rounded-full bg-violet/85" style={{ width: `${(count / scale) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function WorkforceView({ data, showMissingEmployment }: { data: WorkforceReport; showMissingEmployment: boolean }) {
  const { coverage } = data
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Closing headcount" value={countFormat.format(data.headcount)} icon={<Users size={18} />} tone="violet" />
        <KpiCard title="Hires" value={countFormat.format(data.hires)} icon={<ArrowUpRight size={18} />} />
        <KpiCard title="Exits" value={countFormat.format(data.exits)} icon={<ArrowDownRight size={18} />} tone="amber" />
        <KpiCard title="Turnover" value={data.turnoverRate === null ? 'Unavailable' : countFormat.format(data.turnoverRate) + '%'}
          icon={<Percent size={18} />} tone="blue" />
      </div>
      <section aria-labelledby="report-workforce-monthly">
        <h2 id="report-workforce-monthly" className={headingClass}>Monthly workforce movement</h2>
        <p className={'mb-3 mt-1 ' + quietText}>Turnover uses average monthly headcount ({countFormat.format(data.averageHeadcount)}).</p>
        {!data.monthly.some(({ headcount, hires, exits }) => headcount || hires || exits) ? (
          <div className={sectionClass}><p className={quietText}>No workforce movement in this period.</p></div>
        ) : (
          <DataTable columns={movementColumns} data={data.monthly} keyExtractor={(row) => row.month}
            emptyTitle="No monthly figures" emptyDescription="There are no monthly figures for the selected dates." />
        )}
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="Departments" empty="No department figures for these filters." rows={data.departments} />
        <Breakdown title="Employment types" empty="No employment type figures for these filters." rows={data.employmentTypes} />
        <Breakdown title="Exit reasons" empty="No exits in this period." rows={data.exitReasons} />
        <Breakdown title="Gender" empty="No gender figures for these filters." rows={data.genders} />
        <Breakdown title="Age bands" empty="No age figures for these filters." rows={data.ageBands} />
        <section className={sectionClass}>
          <h2 className={headingClass}>Missing records and fields</h2>
          <dl className="mt-3 divide-y divide-line text-sm">
            {[
              ['Birth dates', coverage.missingBirthdate],
              ['Gender entries', coverage.missingGender],
              ...(showMissingEmployment ? [['Employment periods', coverage.missingEmploymentPeriods]] : []),
            ].map(([label, total]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="text-soft">{label}</dt>
                <dd className="font-semibold tabular-nums text-ink">{total}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  )
}

type PayrollRun = NonNullable<FinancialReport['payroll']>['runs'][number]
const payrollColumns: ColumnDef<PayrollRun>[] = [
  { key: 'periodLabel', header: 'Period', accessor: (row) => row.periodLabel || monthLabel(row.periodStart) },
  { key: 'run', header: 'Run', accessor: (row) => <span className="whitespace-nowrap capitalize">{row.runNumber} · {row.runType}</span> },
  { key: 'gross', header: 'Gross (UGX)', align: 'right', accessor: (row) => countFormat.format(row.gross) },
  { key: 'net', header: 'Net (UGX)', align: 'right', accessor: (row) => countFormat.format(row.net) },
  { key: 'employerNssf', header: 'Employer NSSF (UGX)', align: 'right', accessor: (row) => countFormat.format(row.employerNssf) },
]

export function FinancialView({ data }: { data: FinancialReport }) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="report-approved-payroll">
        <h2 id="report-approved-payroll" className={headingClass}>Approved payroll runs</h2>
        {data.payroll === null ? (
          <p className={'mt-2 ' + quietText}>Payroll figures require additional access.</p>
        ) : (
          <div className="mt-3">
            <DataTable columns={payrollColumns} data={data.payroll.runs} keyExtractor={(row) => row.id}
              emptyTitle="No approved payroll runs in this period." emptyDescription="Choose a different date range to see other runs." />
          </div>
        )}
      </section>
      <section aria-labelledby="report-current-advances">
        <h2 id="report-current-advances" className={headingClass}>Current staff advances</h2>
        {data.advances === null ? (
          <p className={'mt-2 ' + quietText}>Staff advance figures require additional access.</p>
        ) : (
          <>
            <p className={'mb-3 mt-1 ' + quietText}>As of {dateFormat.format(new Date(data.advances.asOf + 'T00:00:00Z'))}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiCard title="Open advances" value={countFormat.format(data.advances.openCount)} icon={<Banknote size={18} />} />
              <KpiCard title="Pending requests" value={countFormat.format(data.advances.pendingCount)} icon={<Banknote size={18} />} tone="amber" />
              <KpiCard title="Outstanding balance" value={'UGX ' + countFormat.format(data.advances.outstandingBalance)}
                icon={<Banknote size={18} />} tone="violet" />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
