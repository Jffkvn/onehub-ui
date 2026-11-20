import { FileDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'

import { downloadEmployeeDossier } from '../api/dossierExport'
import type { EmployeeSummary } from '../api/employees'

interface ExportProps { employee: EmployeeSummary }

function DossierExportDialog({ employee, scope, canIncludePay }: ExportProps & {
  scope: IdentityScopeRef
  canIncludePay: boolean
}) {
  const [open, setOpen] = useState(false)
  const [includePay, setIncludePay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const payChoiceId = useId()
  const payDescriptionId = useId()
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  function toggle(nextOpen: boolean) {
    if (!nextOpen) {
      request.current?.abort()
      request.current = null
    }
    setOpen(nextOpen)
    setIncludePay(false)
    setBusy(false)
    setError('')
  }

  async function download() {
    if (request.current) return
    const operation = new AbortController()
    request.current = operation
    setBusy(true)
    setError('')
    try {
      await downloadEmployeeDossier(employee.id, canIncludePay && includePay, scope, operation.signal)
      toggle(false)
    } catch (cause) {
      if (operation.signal.aborted || isAbortError(cause)) return
      const message = cause instanceof Error && (
        cause.message.startsWith('Your account no longer has access') ||
        cause.message.startsWith('Could not record this export')
      ) ? cause.message : 'Could not create the dossier PDF. Please try again.'
      setError(message)
    } finally {
      if (request.current === operation) {
        request.current = null
        setBusy(false)
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={toggle}
      title="Export employee dossier"
      description={employee.legalName + ' · ' + employee.employeeNumber}
      trigger={<Button variant="outline" leftIcon={<FileDown size={16} />}>Export dossier PDF</Button>}
      footer={(
        <>
          <Button variant="outline" onClick={() => toggle(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => { void download() }}>{busy ? 'Creating PDF…' : 'Download PDF'}</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-muted">The PDF contains confidential personal and employment information.</p>
        {canIncludePay && (
          <label className="flex items-start gap-2 rounded-md border border-line p-3">
            <input type="checkbox" checked={includePay} disabled={busy} className="mt-0.5 size-4 accent-emerald"
              onChange={(event) => setIncludePay(event.target.checked)} aria-labelledby={payChoiceId} aria-describedby={payDescriptionId} />
            <span>
              <span id={payChoiceId} className="block font-semibold text-ink">Include pay details</span>
              <span id={payDescriptionId} className="block text-xs text-muted">Adds salary and masked bank and statutory identifiers.</span>
            </span>
          </label>
        )}
        {error && <p role="alert" className="text-rose-600">{error}</p>}
      </div>
    </Dialog>
  )
}

export function EmployeeDossierExport({ employee }: ExportProps) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permissions = auth.access?.permissionKeys ?? []
  if (!scope.isAuthReady || !scope.identityKey || !permissions.includes('employees.read') || !permissions.includes('reports.export')) return null
  const canIncludePay = permissions.includes('payroll.read')
  return <DossierExportDialog key={`${scope.identityKey}:${scope.authEpoch}:${employee.id}:${canIncludePay}`}
    employee={employee} scope={scope} canIncludePay={canIncludePay} />
}
