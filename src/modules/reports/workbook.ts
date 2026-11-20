import type { Report, ReportFilters } from './api'
import { employmentTypes } from './api'
import { operationalTable } from './operationalTable'

export async function prepareWorkbook(report: Report, filters: ReportFilters) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  function addSheet(name: string, rows: (string | number)[][]) {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = rows[0].map((header) => ({ wch: Math.max(20, String(header).length + 2) }))
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }

  const { fromDate, toDate } = report.data
  const fileLabel = report.kind === 'workforce' ? 'Workforce'
    : report.kind === 'payroll' ? 'Payroll-and-Advances' : report.kind
  const summary: (string | number)[][] = [['From', fromDate], ['To', toDate]]
  if (report.kind === 'workforce') {
    const data = report.data
    const department = data.departmentOptions.find(({ id }) => id === filters.department)?.label
    const employmentType = employmentTypes.find(([value]) => value === filters.employmentType)?.[1]
    summary.push(
      ['Department', department ?? (filters.department ? 'Selected department' : 'All departments')],
      ['Employment type', employmentType ?? 'All employment types'],
      ['Headcount at end of period', data.headcount],
      ['Average monthly headcount', data.averageHeadcount],
      ['Hires', data.hires],
      ['Exits', data.exits],
      ['Turnover (%)', data.turnoverRate ?? 'Unavailable'],
      ['Missing birth date', data.coverage.missingBirthdate],
      ['Missing gender', data.coverage.missingGender],
    )
    if (!filters.department && !filters.employmentType) summary.push(['Missing employment periods', data.coverage.missingEmploymentPeriods])
    addSheet('Summary', summary)
    addSheet('Monthly movement', [
      ['Month', 'Headcount', 'Hires', 'Exits'],
      ...data.monthly.map(({ month, headcount, hires, exits }) => [month.slice(0, 7), headcount, hires, exits]),
    ])
    addSheet('Breakdowns', [
      ['Breakdown', 'Group', 'Count'],
      ...data.departments.map(({ label, count }) => ['Department', label, count]),
      ...data.genders.map(({ label, count }) => ['Gender', label, count]),
      ...data.ageBands.map(({ label, count }) => ['Age', label, count]),
      ...data.employmentTypes.map(({ label, count }) => ['Employment type', label, count]),
      ...data.exitReasons.map(({ label, count }) => ['Exit reason', label, count]),
    ])
  } else if (report.kind === 'payroll') {
    addSheet('Summary', summary)
    const { payroll, advances } = report.data
    if (payroll) {
      addSheet('Approved payroll runs', [
        ['Period start', 'Period', 'Run', 'Run type', 'Gross (UGX)', 'Net (UGX)', 'Employer NSSF (UGX)'],
        ...payroll.runs.map((run) => [
          run.periodStart, run.periodLabel, run.runNumber, run.runType, run.gross, run.net, run.employerNssf,
        ]),
      ])
    }
    if (advances) {
      addSheet('Current staff advances', [
        ['As of', 'Open advances', 'Pending requests', 'Outstanding balance (UGX)'],
        [advances.asOf, advances.openCount, advances.pendingCount, advances.outstandingBalance],
      ])
    }
  } else {
    const { headers, rows } = operationalTable(report)
    const department = report.data.departmentOptions.find(({ id }) => id === filters.department)?.label
    summary.push(['Department', department ?? (filters.department ? 'Selected department' : 'All departments')])
    if (filters.employmentType) {
      summary.push(['Employment type', employmentTypes.find(([value]) => value === filters.employmentType)?.[1] ?? filters.employmentType])
    }
    if (report.kind === 'leave-year-end') {
      summary.push(['Weeks to year-end', report.data.weeksLeft], ['Working weekdays left', report.data.weekdaysLeft])
    }
    addSheet('Summary', summary)
    addSheet('Figures', [headers, ...rows])
  }
  return () => {
    XLSX.writeFile(workbook, `OneHub-${fileLabel}-${fromDate}-to-${toDate}.xlsx`, { compression: true })
  }
}
