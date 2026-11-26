import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText } from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import type { PayrollItem, PayrollRun } from '@/_contract/types/payroll.types'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  isAbortError,
  useProtectedIdentityScope,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import { selfServiceApi } from '../api/selfService'

const money = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 })

function PayLines({ rows }: { rows: ReadonlyArray<readonly [string, number]> }) {
  return <dl className="mt-2 divide-y divide-line text-sm">
    {rows.map(([label, amount], index) => <div key={label + index} className="flex justify-between gap-3 py-2">
      <dt className="text-soft">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums text-ink">UGX {money.format(amount)}</dd>
    </div>)}
  </dl>
}

function PayslipBreakdown({ item, id }: { item: PayrollItem; id: string }) {
  const otherLines = item.lineItems.filter((line) => line.kind === 'deduction')
  const itemized = otherLines.length > 0
    && Math.round(otherLines.reduce((sum, line) => sum + line.amount, 0) * 100) === Math.round(item.otherDeductions * 100)
  const deductions: Array<[string, number]> = [
    ['PAYE (income tax)', item.paye],
    ['Your NSSF contribution', item.nssfEmployee],
  ]
  if (item.wht !== 0) deductions.push(['Withholding tax', item.wht])
  if (item.salaryAdvanceDeduction !== 0) deductions.push(['Salary advance repayment', item.salaryAdvanceDeduction])
  if (itemized) deductions.push(...otherLines.map((line): [string, number] => [line.description, line.amount]))
  else if (item.otherDeductions !== 0) deductions.push(['Other deductions', item.otherDeductions])

  return <section id={id} aria-label="Payslip breakdown" className="mt-4 space-y-4 border-t border-line pt-4">
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <h3 className="font-semibold text-ink">Earnings</h3>
        {item.contractualGross !== item.proratedGross && (
          <p className="mt-1 text-xs text-muted">Monthly base salary · UGX {money.format(item.contractualGross)}</p>
        )}
        <PayLines rows={[
          ['Base pay for this period', item.proratedGross],
          ['Overtime pay', item.overtimePay],
          ['Allowances', item.allowances],
          ['Gross earnings', item.taxableGross],
        ]} />
      </div>
      <div>
        <h3 className="font-semibold text-ink">Deductions</h3>
        <PayLines rows={[...deductions, ['Total deductions', item.totalDeductions]]} />
      </div>
    </div>
    <div className="rounded-lg bg-canvas px-3">
      <PayLines rows={[['Net pay', item.netPay]]} />
    </div>
  </section>
}

function MyPayslips({ scope }: { scope: IdentityScopeRef }) {
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState(false)

  function pinSession() {
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
    return () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
  }

  const payslips = useQuery({
    queryKey: ['portal', 'my-payslips', scope.identityKey, scope.authEpoch],
    enabled: scope.isAuthReady,
    queryFn: async () => {
      const assertCurrent = pinSession()
      assertCurrent()
      const rows = await selfServiceApi.listPayslips()
      assertCurrent()
      return rows
    },
  })

  async function download(run: PayrollRun) {
    setDownloading(run.id)
    setDownloadError(false)
    try {
      await selfServiceApi.downloadPayslip(run, pinSession())
    } catch (error) {
      if (!isAbortError(error)) setDownloadError(true)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader title="My Pay" subtitle="Approved payslips" />
      {payslips.isLoading && <p className="text-sm text-soft">Loading payslips…</p>}
      {payslips.isError && <div role="alert" className="rounded-xl border border-line bg-surface p-4 text-sm text-rose">
        Payslips could not load. <Button variant="ghost" onClick={() => void payslips.refetch()}>Retry</Button>
      </div>}
      {downloadError && <p role="alert" className="text-sm text-rose">The payslip could not download. Please try again.</p>}
      {!payslips.isError && payslips.data?.length === 0 && <p className="rounded-xl border border-line bg-surface p-4 text-sm text-soft">
        Your approved payslips will appear here.
      </p>}
      {!payslips.isError && <ul className="space-y-3">
        {payslips.data?.map((run) => {
          const item = run.items[0]
          const expanded = openRunId === run.id
          const breakdownId = 'payslip-breakdown-' + run.id
          return <li key={run.id} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <FileText aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />
                <div>
                  <h2 className="font-semibold text-ink">{run.periodLabel}</h2>
                  <p className="text-xs capitalize text-soft">{run.runType} · Run {run.runNumber}</p>
                  <p className="mt-1 text-sm text-ink">Net pay · UGX {money.format(item.netPay)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone="success">Approved</StatusPill>
                <Button variant="outline" aria-expanded={expanded} aria-controls={expanded ? breakdownId : undefined}
                  aria-label={(expanded ? 'Hide' : 'View') + ' payslip for ' + run.periodLabel + ' run ' + run.runNumber}
                  onClick={() => setOpenRunId(expanded ? null : run.id)}>
                  {expanded ? 'Hide payslip' : 'View payslip'}
                </Button>
                <Button variant="outline" disabled={downloading !== null} loading={downloading === run.id}
                  leftIcon={<Download aria-hidden="true" className="size-4" />}
                  onClick={() => void download(run)} aria-label={'Download PDF for ' + run.periodLabel + ' run ' + run.runNumber}>
                  Download PDF
                </Button>
              </div>
            </div>
            {expanded && <PayslipBreakdown item={item} id={breakdownId} />}
          </li>
        })}
      </ul>}
    </div>
  )
}

export default function MyPayslipsPage() {
  const scope = useProtectedIdentityScope(useAuth())
  return <MyPayslips key={scope.identityKey + ':' + scope.authEpoch} scope={scope} />
}
