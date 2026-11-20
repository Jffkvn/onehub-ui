import type { OperationalReport } from './api'

type Table = { headers: string[]; rows: (string | number)[][] }

export function operationalTable(report: OperationalReport): Table {
  switch (report.kind) {
    case 'salary-spread':
      return {
        headers: ['Monthly gross salary (UGX)', 'Employees'],
        rows: report.data.rows.map((row) => [row.label, row.people]),
      }
    case 'employment-changes':
      return {
        headers: ['Month', 'Hires', 'Rehires', 'Assignment changes', 'Exits'],
        rows: report.data.rows.map((row) => [row.label.slice(0, 7), row.hires, row.rehires, row.assignmentChanges, row.exits]),
      }
    case 'record-completeness':
      return {
        headers: ['Employee', 'Employee number', 'Department', 'Fields to complete'],
        rows: report.data.rows.map((row) => [
          row.label, row.number, row.department, row.missing.length ? row.missing.join(', ') : 'Complete',
        ]),
      }
    case 'leave':
      return {
        headers: ['Leave type', 'Approved days', 'Requests'],
        rows: report.data.rows.map((row) => [row.label, row.days, row.requests]),
      }
    case 'leave-year-end':
      return {
        headers: ['Employee', 'Department', 'Entitlement', 'Taken', 'Booked', 'Remaining', 'Pending', 'Plan leave', 'Last reminded'],
        rows: report.data.rows.map((row) => [
          row.label, row.department, row.entitled, row.taken, row.booked, row.remaining, row.pending,
          row.flagged ? 'Review' : '', row.lastReminded ? row.lastReminded.slice(0, 10) : '—',
        ]),
      }
    case 'department-attendance':
      return {
        headers: ['Department', 'People', 'Days due', 'Arrivals', 'Arrival rate (%)', 'On time (%)', 'Late arrivals',
          'Avg minutes past grace', 'No punches', 'Missing clock-in', 'Unverified days', 'Untracked days'],
        rows: report.data.rows.map((row) => [
          row.label, row.people, row.due, row.arrivals, row.arrivalRate ?? '—', row.onTimeRate ?? '—',
          row.late, row.meanLateMinutes ?? '—', row.absent, row.missingIn, row.unverified, row.untracked,
        ]),
      }
  }
}
