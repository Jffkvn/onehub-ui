import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { FieldError } from '@/components/ui/Input'
import { isAbortError, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { sendLeaveReminders, type OperationalReport } from './api'
import { operationalTable } from './operationalTable'

const figures = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 })
const descriptions = {
  'salary-spread': 'Counts use today’s salary settings for active employees. Employees without a recorded UGX salary appear in their own row.',
  'employment-changes': 'Counts use saved employment periods. Edits made to a period in place cannot be reconstructed from older records.',
  'record-completeness': 'Current employee records are checked for completion. Open an employee record to update the missing fields.',

  leave: 'Approved days are counted on the dates they were allocated. A request that spans this period contributes only its days inside the date range.',
  'leave-year-end': 'Remaining days are after approved bookings. Pending requests are shown separately. Review marks balances higher than the weeks left in the year.',
  'department-attendance': 'Rates use verified, scheduled shifts that finished or had a clock-in. Holidays and full-day approved leave are excluded. Departments match the current register. Untracked shifts are excluded. A scheduled shift with no punches needs review.',
}

export function OperationalReportView({ report, scope, onRefresh }: {
  report: OperationalReport
  scope: IdentityScopeRef
  onRefresh: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const yearEnd = report.kind === 'leave-year-end' ? report.data : null
  const eligible = selected.filter((id) => yearEnd?.rows.some((row) => row.id === id && row.canRemind))
  const remind = useMutation({
    mutationFn: (ids: string[]) => sendLeaveReminders(ids, scope),
    onSuccess() {
      setSelected([])
      onRefresh()
    },
  })
  const records = report.kind === 'record-completeness' ? report.data.rows : null
  const register = report.kind === 'department-attendance' ? report.data : null
  const { headers, rows } = operationalTable(report)
  return (
    <section aria-label="Report figures" className="space-y-3">
      <p className="text-sm text-muted">{descriptions[report.kind]}</p>
      {yearEnd && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm text-soft">{yearEnd.weeksLeft} weeks left · {yearEnd.weekdaysLeft} working weekdays left</p>
          <Button size="sm" variant="outline" disabled={!eligible.length || remind.isPending}
            onClick={() => remind.mutate(eligible)}>
            {remind.isPending ? 'Sending…' : eligible.length ? `Send in-app reminders (${eligible.length})` : 'Send in-app reminders'}
          </Button>
          {remind.data && <p role="status" className="text-sm text-soft">{remind.data.sent} sent · {remind.data.skipped} skipped</p>}
          {remind.isError && !isAbortError(remind.error) && <FieldError>Could not send reminders. Try again.</FieldError>}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">No records match this report.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label="Scrollable report table">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-soft">
              <tr>
                {yearEnd && <th scope="col" className="px-4 py-3">Remind</th>}
                {headers.map((header) => <th key={header} scope="col" className="px-4 py-3">{header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(([first, ...cells], index) => {
                const employee = yearEnd?.rows[index]
                const record = records?.[index]
                const departmentId = register?.rows[index].id
                const registerParams = register && departmentId
                  ? new URLSearchParams({ from: register.fromDate, to: register.toDate, department: departmentId })
                  : null
                return (
                  <tr key={employee?.id ?? record?.id ?? departmentId ?? index}>
                    {employee && (
                      <td className="px-4 py-3">
                        <input type="checkbox" aria-label={`Remind ${employee.label}`}
                          className="size-4 accent-emerald"
                          disabled={!employee.canRemind || remind.isPending || (eligible.length >= 200 && !eligible.includes(employee.id))}
                          checked={eligible.includes(employee.id)}
                          onChange={(event) => {
                            const checked = event.target.checked
                            setSelected((current) => checked ? [...current, employee.id] : current.filter((id) => id !== employee.id))
                          }} />
                      </td>
                    )}
                    <th scope="row" className="px-4 py-3 font-medium text-ink">
                      {record && <Link to={`/people/employees/${record.id}`} className="underline-offset-2 hover:underline">{first}</Link>}
                      {registerParams && <Link to={`/people/attendance?${registerParams}`} className="underline-offset-2 hover:underline">{first}</Link>}
                      {!record && !registerParams && first}
                    </th>
                    {cells.map((cell, column) => (
                      <td key={headers[column + 1]} className="px-4 py-3 tabular-nums text-soft">
                        {typeof cell === 'number' ? figures.format(cell) : cell}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
