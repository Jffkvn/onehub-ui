import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, Upload } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { FieldError } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { readWorkbookFile } from '@/lib/security/workbookReader'
import type { IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import {
  performanceKey,
  type PerformanceCycle,
  type PerformanceReview,
  type performanceApi,
} from './api'
import {
  downloadPerformanceTemplate,
  parsePerformanceWorkbookRows,
  type ParsedPerformanceImportRow,
  type PerformanceImportPreview,
} from './performanceWorkbook'

type RowRunStatus = 'idle' | 'saving' | 'saved' | 'failed'

interface RowRunState {
  status: RowRunStatus
  error?: string
}

export interface PerformanceImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cycle: PerformanceCycle
  existingReviews: PerformanceReview[]
  api: ReturnType<typeof performanceApi>
  scope: IdentityScopeRef
  onImported?: (savedCount: number) => void
}

export function PerformanceImportDialog({
  open,
  onOpenChange,
  cycle,
  existingReviews: _existingReviews,
  api,
  scope,
  onImported,
}: PerformanceImportDialogProps) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [parsing, setParsing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [lastRawRows, setLastRawRows] = useState<string[][] | null>(null)
  const [preview, setPreview] = useState<PerformanceImportPreview | null>(null)
  const [rowStates, setRowStates] = useState<Record<number, RowRunState>>({})

  const employeesQuery = useQuery({
    queryKey: [...performanceKey(scope), 'import-employees'],
    queryFn: () => api.listEmployees(),
    enabled: open,
  })
  const reviewersQuery = useQuery({
    queryKey: [...performanceKey(scope), 'import-reviewers'],
    queryFn: () => api.listReviewers(),
    enabled: open,
  })

  const catalogLoading = employeesQuery.isLoading || reviewersQuery.isLoading
  const catalogError = employeesQuery.error || reviewersQuery.error

  async function validateRawRows(rawRows: string[][], sourceName: string, savedRows: ParsedPerformanceImportRow[] = []) {
    const employees = employeesQuery.data
    const reviewers = reviewersQuery.data
    if (!employees || !reviewers) {
      throw new Error('Staff and eligible reviewer lists are still loading. Try again.')
    }
    const existingVersions = await api.listImportVersions(cycle.id)
    const savedRowNumbers = new Set(savedRows.map(({ rowNumber }) => rowNumber))
    const pendingRawRows = rawRows.map((row, index) => savedRowNumbers.has(index + 1) ? [] : row)
    const result = parsePerformanceWorkbookRows(pendingRawRows, {
      employees,
      reviewers,
      existingVersions,
    })
    setFileName(sourceName)
    setLastRawRows(rawRows)
    setPreview({
      ...result,
      rows: [...result.rows, ...savedRows].sort((a, b) => a.rowNumber - b.rowNumber),
    })
  }

  async function handleFileChange(file: File | undefined) {
    if (!file) return
    setParseError(null)
    setPreview(null)
    setLastRawRows(null)
    setRowStates({})
    setParsing(true)
    try {
      const parsed = await readWorkbookFile(file, {
        preferredSheetName: 'Performance Reviews',
        maxRows: 1001,
      })
      await validateRawRows(parsed.rows, parsed.fileName)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to parse performance workbook.')
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRevalidate() {
    if (!lastRawRows || !fileName) return
    setParseError(null)
    setParsing(true)
    const savedRows = preview?.rows.filter((row) => rowStates[row.rowNumber]?.status === 'saved') ?? []
    try {
      await validateRawRows(lastRawRows, fileName, savedRows)
      setRowStates(Object.fromEntries(savedRows.map(({ rowNumber }) => [rowNumber, { status: 'saved' }])))
      await queryClient.invalidateQueries({ queryKey: performanceKey(scope) })
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to re-validate workbook.')
    } finally {
      setParsing(false)
    }
  }

  async function runRows(rowsToRun: ParsedPerformanceImportRow[]) {
    if (rowsToRun.length === 0) return
    setCommitting(true)
    let savedThisPass = 0
    try {
      for (const row of rowsToRun) {
        if (rowStates[row.rowNumber]?.status === 'saved' || !row.employeeId || !row.reviewerProfileId || row.errors.length > 0) continue
        setRowStates((prev) => ({ ...prev, [row.rowNumber]: { status: 'saving' } }))
        try {
          await api.importReview({
            cycleId: cycle.id,
            employeeId: row.employeeId,
            reviewerProfileId: row.reviewerProfileId,
            managerComments: row.managerComments,
            recommendIncrement: row.recommendIncrement,
            recommendPromotion: row.recommendPromotion,
            goals: row.goals,
            expectedReviewId: row.expectedReviewId,
            expectedVersion: row.expectedVersion,
          })
          savedThisPass += 1
          setRowStates((prev) => ({ ...prev, [row.rowNumber]: { status: 'saved' } }))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Could not save review row.'
          setRowStates((prev) => ({ ...prev, [row.rowNumber]: { status: 'failed', error: msg } }))
        }
      }
      if (savedThisPass > 0) {
        await queryClient.invalidateQueries({ queryKey: performanceKey(scope) })
        onImported?.(savedThisPass)
      }
    } finally {
      setCommitting(false)
    }
  }

  const failedRows = preview
    ? preview.rows.filter((r) => rowStates[r.rowNumber]?.status === 'failed')
    : []
  const hasStaleRowError = failedRows.some((r) => {
    const err = rowStates[r.rowNumber]?.error ?? ''
    return /changed since you previewed|created since you previewed|re-validate/i.test(err)
  })
  const nonStaleFailedRows = failedRows.filter((r) => {
    const err = rowStates[r.rowNumber]?.error ?? ''
    return !/changed since you previewed|created since you previewed|re-validate/i.test(err)
  })
  const savedCount = preview
    ? preview.rows.filter((r) => rowStates[r.rowNumber]?.status === 'saved').length
    : 0
  const pendingRows = preview?.rows.filter((row) => rowStates[row.rowNumber]?.status !== 'saved') ?? []
  const canCommit = Boolean(preview?.canCommit && pendingRows.length && !committing && !parsing && !failedRows.length)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (committing) return
        if (!nextOpen) {
          setParseError(null)
          setPreview(null)
          setLastRawRows(null)
          setRowStates({})
        }
        onOpenChange(nextOpen)
      }}
      hasUnsavedChanges={committing}
      className="max-w-4xl"
      title={`Import Reviews — ${cycle.name}`}
      description="Validate every row upfront against active staff, eligible reviewers, and current review versions before saving."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <div className="text-xs text-muted">
            {preview
              ? `${savedCount} saved · ${failedRows.length} failed · ${preview.newCount} new · ${preview.overwriteCount} overwrite`
              : 'Upload an .xlsx workbook to validate.'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasStaleRowError && lastRawRows && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                disabled={committing || parsing}
                onClick={() => void handleRevalidate()}
              >
                Re-validate workbook
              </Button>
            )}
            {nonStaleFailedRows.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                disabled={committing || parsing}
                onClick={() => void runRows(nonStaleFailedRows)}
              >
                Retry failed rows ({nonStaleFailedRows.length})
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!canCommit}
              onClick={() => void runRows(pendingRows)}
            >
              {committing ? 'Importing…' : `Import ${pendingRows.filter((row) => row.action !== 'error').length} Review(s)`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-canvas/50 p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            disabled={committing}
            onClick={() => downloadPerformanceTemplate(cycle.name)}
          >
            Download Template
          </Button>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              aria-label="Upload performance reviews workbook (.xlsx)"
              className="hidden"
              onChange={(event) => void handleFileChange(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              leftIcon={<Upload className="h-3.5 w-3.5" />}
              disabled={committing || parsing || catalogLoading || Boolean(catalogError)}
              onClick={() => fileRef.current?.click()}
            >
              {parsing ? 'Validating…' : 'Select .xlsx Workbook'}
            </Button>
          </div>
        </div>

        {catalogError && (
          <FieldError error="Unable to load employees or eligible reviewers for validation." />
        )}
        {parseError && <FieldError error={parseError} />}
        {hasStaleRowError && (
          <div className="rounded-md border border-amber/40 bg-amber-tint px-3 py-2 text-xs text-ink">
            One or more reviews changed after preview. Click <strong>Re-validate workbook</strong> to inspect
            updated review statuses and versions before retrying.
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ink">{fileName}</span>
              <StatusPill tone="success" size="sm">{preview.newCount} New</StatusPill>
              <StatusPill tone="info" size="sm">{preview.overwriteCount} Overwrite</StatusPill>
              <StatusPill tone={preview.errorCount > 0 ? 'danger' : 'neutral'} size="sm">
                {preview.errorCount} Error(s)
              </StatusPill>
            </div>

            <div className="max-h-80 overflow-auto rounded-md border border-line">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-line bg-canvas text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Reviewer</th>
                    <th className="px-3 py-2">Action / Status</th>
                    <th className="px-3 py-2">Notes / Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.rows.map((row) => {
                    const runState = rowStates[row.rowNumber]
                    const statusLabel =
                      runState?.status === 'saved'
                        ? 'Saved'
                        : runState?.status === 'saving'
                          ? 'Saving…'
                          : runState?.status === 'failed'
                            ? 'Failed'
                            : row.action === 'error'
                              ? 'Blocked'
                              : row.action === 'overwrite'
                                ? `Overwrite (${row.existingStatus ?? 'draft'})`
                                : 'New'
                    const tone =
                      runState?.status === 'saved'
                        ? 'success'
                        : runState?.status === 'failed' || row.action === 'error'
                          ? 'danger'
                          : row.action === 'overwrite'
                            ? 'info'
                            : 'success'

                    return (
                      <tr key={row.rowNumber} className="align-top">
                        <td className="px-3 py-2 font-mono text-muted">#{row.rowNumber}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-ink">{row.employeeName || '—'}</div>
                          <div className="text-muted">{row.employeeNumber || '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-ink">{row.reviewerName || '—'}</td>
                        <td className="px-3 py-2">
                          <StatusPill tone={tone} size="sm">
                            {statusLabel}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-2 space-y-1">
                          {row.errors.map((err, i) => (
                            <p key={i} className="text-rose font-medium">
                              • {err}
                            </p>
                          ))}
                          {runState?.error && (
                            <p className="text-rose font-medium">• {runState.error}</p>
                          )}
                          {row.errors.length === 0 && !runState?.error && (
                            <p className="text-soft">
                              {row.goals.length} rated goal(s)
                              {row.recommendIncrement ? ' · Increment' : ''}
                              {row.recommendPromotion ? ' · Promotion' : ''}
                            </p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
