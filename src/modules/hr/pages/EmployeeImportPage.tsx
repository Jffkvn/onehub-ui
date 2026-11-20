import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { KpiCard } from '@/components/patterns/KpiCard'
import { Button } from '@/components/ui/Button'
import { FieldError } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  useProtectedIdentityScope,
} from '@/lib/idempotency/pendingOperations'
import { readWorkbookFile } from '@/lib/security/workbookReader'
import { useAuth } from '@/modules/auth/AuthProvider'
import { useEmployeeSetup } from '../api/employees'
import {
  commitEmployeeImport,
  fetchEmployeesForImport,
  recordEmployeeExport,
  sha256Hex,
  type CommitEmployeeImportResult,
} from '../api/employeeImports'
import {
  downloadEmployeeTemplate,
  prepareEmployeesExportWorkbook,
} from '../import/employeeTemplate'
import {
  parseEmployeeImportWorkbook,
  type EmployeeImportPreview,
  type ParsedEmployeeImportRow,
} from '../import/employeeParser'

export default function EmployeeImportPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const setupQuery = useEmployeeSetup()

  const [parsing, setParsing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [staleConflict, setStaleConflict] = useState(false)
  const [sourceFileName, setSourceFileName] = useState<string>('')
  const [sourceFileHash, setSourceFileHash] = useState<string>('')
  const [lastRawRows, setLastRawRows] = useState<string[][] | null>(null)
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null)
  const [confirmClearedFields, setConfirmClearedFields] = useState(false)
  const [commitResult, setCommitResult] = useState<CommitEmployeeImportResult | null>(null)

  const requiresClearAck = (preview?.clearedFieldWarningCount ?? 0) > 0
  const canSubmit = Boolean(
    preview?.canCommit &&
      (!requiresClearAck || confirmClearedFields) &&
      !committing &&
      !parsing &&
      !staleConflict,
  )

  const previewRows = useMemo(() => preview?.rows ?? [], [preview])

  async function handleFileSelected(file: File | undefined) {
    if (!file) return
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
    setErrorMessage(null)
    setStaleConflict(false)
    setCommitResult(null)
    setConfirmClearedFields(false)
    setPreview(null)
    setParsing(true)

    try {
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      const setup = setupQuery.data
      if (!setup) {
        throw new Error('HR setup catalogs are still loading. Try again in a moment.')
      }

      const [parsedWorkbook, existingEmployees] = await Promise.all([
        readWorkbookFile(file, { preferredSheetName: 'Employees', maxRows: 1001 }),
        fetchEmployeesForImport(),
      ])
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)

      const fileHash = await sha256Hex(parsedWorkbook.buffer)
      const analyzed = parseEmployeeImportWorkbook(parsedWorkbook.rows, existingEmployees, setup)
      setLastRawRows(parsedWorkbook.rows)
      setSourceFileName(parsedWorkbook.fileName)
      setSourceFileHash(fileHash)
      setPreview(analyzed)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to process workbook.')
    } finally {
      setParsing(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function handleRevalidatePreview() {
    if (!lastRawRows) return
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
    setErrorMessage(null)
    setStaleConflict(false)
    setConfirmClearedFields(false)
    setParsing(true)

    try {
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      const setup = setupQuery.data
      if (!setup) {
        throw new Error('HR setup catalogs are still loading. Try again in a moment.')
      }
      const existingEmployees = await fetchEmployeesForImport()
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      const analyzed = parseEmployeeImportWorkbook(lastRawRows, existingEmployees, setup)
      setPreview(analyzed)
      toast('Preview refreshed', {
        description: 'Employee records and version tokens were re-checked.',
        tone: 'info',
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to re-validate workbook.')
    } finally {
      setParsing(false)
    }
  }

  async function handleExportEmployees() {
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
    setErrorMessage(null)
    setExporting(true)
    try {
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      const employees = await fetchEmployeesForImport()
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      const prepared = prepareEmployeesExportWorkbook(employees)
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      await recordEmployeeExport(prepared.exportedCount)
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      prepared.download()
      toast('Employees exported', {
        description: `${prepared.exportedCount} active employee records audited and exported.`,
        tone: 'success',
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not export employees.')
    } finally {
      setExporting(false)
    }
  }

  async function handleCommit() {
    if (!preview || !preview.canCommit || staleConflict) return
    if (requiresClearAck && !confirmClearedFields) return
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })

    setErrorMessage(null)
    setCommitting(true)
    try {
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      const importRows = preview.rows
        .map((row) => row.payload)
        .filter((payload): payload is NonNullable<ParsedEmployeeImportRow['payload']> => payload !== null)

      const result = await commitEmployeeImport({
        sourceFileName,
        sourceFileHash,
        importRows,
      })
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)

      setCommitResult(result)
      setPreview(null)
      setLastRawRows(null)
      setStaleConflict(false)
      setConfirmClearedFields(false)
      await queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] })
      toast('Import committed', {
        description: `Created ${result.created}, updated ${result.updated}.`,
        tone: 'success',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not commit employee import.'
      setErrorMessage(msg)
      if (/changed since you previewed|archived after preview|re-validate/i.test(msg)) {
        setStaleConflict(true)
      }
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People Operations"
        title="Employee Workbook Import & Export"
        subtitle="Validate .xlsx employee changes in an isolated worker before committing atomically."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="ghost"
              size="md"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => void navigate('/people/employees')}
            >
              Back to Employees
            </Button>
            <Button
              variant="outline"
              size="md"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={() => downloadEmployeeTemplate()}
            >
              Download Template
            </Button>
            <Button
              variant="outline"
              size="md"
              leftIcon={<FileSpreadsheet className="h-4 w-4" />}
              disabled={exporting}
              onClick={() => void handleExportEmployees()}
            >
              {exporting ? 'Exporting…' : 'Export Employees'}
            </Button>
          </div>
        }
      />

      {errorMessage && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose/30 bg-rose-tint p-4">
          <FieldError error={errorMessage} />
          {staleConflict && lastRawRows && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              disabled={parsing || committing}
              onClick={() => void handleRevalidatePreview()}
            >
              Re-validate workbook
            </Button>
          )}
        </div>
      )}

      {commitResult && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald/30 bg-emerald-tint px-4 py-3 text-sm text-ink"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <span>
              Import committed cleanly: <strong>{commitResult.created}</strong> created,{' '}
              <strong>{commitResult.updated}</strong> updated.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void navigate('/people/employees')}>
            View Employee Directory
          </Button>
        </div>
      )}

      <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-ink">Upload Employee Workbook</h2>
            <p className="text-xs text-muted mt-0.5">
              Accepts .xlsx workbooks up to 5 MB and 1,000 employee rows. Matches existing staff strictly by
              Employee Number, Company Email, or National ID.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              aria-label="Upload employee workbook (.xlsx)"
              className="hidden"
              onChange={(event) => void handleFileSelected(event.target.files?.[0])}
            />
            <Button
              variant="primary"
              size="md"
              leftIcon={<Upload className="h-4 w-4" />}
              disabled={parsing || committing || setupQuery.isLoading}
              onClick={() => fileInputRef.current?.click()}
            >
              {parsing ? 'Validating Workbook…' : 'Select .xlsx Workbook'}
            </Button>
          </div>
        </div>
      </section>

      {preview && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard icon={<CheckCircle2 className="h-5 w-5" />} title="Create Rows" value={preview.createCount} tone="emerald" />
            <KpiCard icon={<FileSpreadsheet className="h-5 w-5" />} title="Update Rows" value={preview.updateCount} tone="blue" />
            <KpiCard icon={<AlertTriangle className="h-5 w-5" />} title="Blocking Errors" value={preview.errorCount} tone={preview.errorCount > 0 ? 'rose' : 'neutral'} />
            <KpiCard
              icon={<AlertTriangle className="h-5 w-5" />}
              title="Blank-Field Clear Warnings"
              value={preview.clearedFieldWarningCount}
              tone={preview.clearedFieldWarningCount > 0 ? 'amber' : 'neutral'}
            />
          </div>

          {requiresClearAck && (
            <div className="rounded-lg border border-amber/40 bg-amber-tint p-4 space-y-3">
              <div className="flex items-start gap-2.5 text-sm text-ink">
                <AlertTriangle className="h-5 w-5 text-amber shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Blank cells will clear existing employee fields</p>
                  <p className="text-xs text-soft mt-0.5">
                    {preview.clearedFieldWarningCount} update row(s) have blank optional cells where an existing
                    employee currently has saved data. Saving blanks overwrites those fields to empty in the database.
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmClearedFields}
                  onChange={(event) => setConfirmClearedFields(event.target.checked)}
                />
                I reviewed the cleared-field badges below and want to overwrite those fields as blank.
              </label>
            </div>
          )}

          <div className="rounded-lg border border-line bg-surface shadow-xs overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h3 className="font-display text-sm font-bold text-ink">
                  Validation Preview — {sourceFileName}
                </h3>
                <p className="text-xs text-muted">SHA-256: {sourceFileHash.slice(0, 16)}…</p>
              </div>
              <Button
                variant="primary"
                size="md"
                disabled={!canSubmit}
                onClick={() => void handleCommit()}
              >
                {committing
                  ? 'Committing…'
                  : `Commit ${preview.createCount + preview.updateCount} Valid Row(s)`}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-line bg-canvas/60 text-muted uppercase">
                  <tr>
                    <th className="px-4 py-2.5">Row</th>
                    <th className="px-4 py-2.5">Action</th>
                    <th className="px-4 py-2.5">Employee #</th>
                    <th className="px-4 py-2.5">Full Name</th>
                    <th className="px-4 py-2.5">Changes / Warnings / Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {previewRows.map((row) => (
                    <tr key={row.rowNumber} className="align-top">
                      <td className="px-4 py-3 font-mono text-muted">#{row.rowNumber}</td>
                      <td className="px-4 py-3">
                        <StatusPill
                          tone={
                            row.action === 'error'
                              ? 'danger'
                              : row.action === 'update'
                                ? 'info'
                                : 'success'
                          }
                          size="sm"
                        >
                          {row.action === 'create'
                            ? 'Create'
                            : row.action === 'update'
                              ? 'Update'
                              : 'Error'}
                        </StatusPill>
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{row.employeeNumber || '—'}</td>
                      <td className="px-4 py-3 text-ink">{row.legalName || '—'}</td>
                      <td className="px-4 py-3 space-y-1.5">
                        {row.errors.map((err, idx) => (
                          <p key={idx} className="text-rose font-medium">
                            • {err}
                          </p>
                        ))}
                        {row.changedFields.length > 0 && (
                          <p className="text-soft">
                            Changed: <span className="font-medium text-ink">{row.changedFields.join(', ')}</span>
                          </p>
                        )}
                        {row.clearedFields.length > 0 && (
                          <p className="text-amber font-medium">
                            Clears existing data: {row.clearedFields.join(', ')}
                          </p>
                        )}
                        {row.action === 'create' && row.errors.length === 0 && (
                          <p className="text-muted">New employee record and initial employment period.</p>
                        )}
                        {row.action === 'update' &&
                          row.errors.length === 0 &&
                          row.changedFields.length === 0 &&
                          row.clearedFields.length === 0 && (
                            <p className="text-muted">No field changes detected.</p>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!preview && !parsing && !commitResult && (
        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<FileSpreadsheet className="h-6 w-6" />}
            title="No workbook queued"
            description="Download the template or export current staff, make your edits, and upload the .xlsx file here to inspect every change before committing."
          />
        </div>
      )}
    </div>
  )
}
