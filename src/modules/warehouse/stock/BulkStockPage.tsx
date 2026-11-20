import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError } from '@/components/ui/Input'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'

import { bulkTemplates, prepareBulkWorkbook, type BulkKind, type BulkPreview } from './bulkWorkbook'
import { executeStockCommand, UnconfirmedStockWrite, type StockCommand } from './stockApi'

const kinds = Object.keys(bulkTemplates) as BulkKind[]
const previewPageSize = 25
const textButton = 'text-sm font-semibold text-emerald underline underline-offset-4'
const cardClass = 'space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-6'

function PreviewRows({ preview, page, setPage }: { preview: BulkPreview; page: number; setPage: (page: number) => void }) {
  const offset = page * previewPageSize
  const end = Math.min(offset + previewPageSize, preview.rows.length)
  const rowErrors = new Set(preview.errors.map(({ row }) => row))

  return <>
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-sm" aria-label="Inventory workbook preview">
        <thead className="bg-canvas text-xs text-soft">
          <tr>{['Row', ...preview.headers].map((header) => <th key={header} scope="col" className="whitespace-nowrap px-3 py-2">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {preview.rows.slice(offset, end).map(({ number, values }) => (
            <tr key={number} className="text-ink">
              <th scope="row" className={'px-3 py-2 font-mono ' + (rowErrors.has(number) ? 'text-rose' : 'text-muted')}>{number}</th>
              {values.map((value, index) => <td key={preview.headers[index]} className="max-w-72 break-words px-3 py-2">{value || '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {preview.rows.length > previewPageSize && <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted">Rows {offset + 1}–{end} of {preview.rows.length}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button type="button" variant="outline" size="sm" disabled={end >= preview.rows.length} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>}
  </>
}

function BulkContent({ scope, canReceive, canAdjust }: { scope: IdentityScopeRef; canReceive: boolean; canAdjust: boolean }) {
  const allowed = kinds.filter((kind) => kind === 'item_master' || (kind === 'stock_adjustment' ? canAdjust : canReceive))
  const [kind, setKind] = useState<BulkKind>('item_master')
  const [preview, setPreview] = useState<BulkPreview>()
  const [page, setPage] = useState(0)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [completed, setCompleted] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const lock = useRef(false)
  const queryClient = useQueryClient()
  const write = useMutation({
    mutationFn: (command: StockCommand) => executeStockCommand(scope, command),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['warehouse'] }),
    retry: false,
  })
  const unconfirmed = write.error instanceof UnconfirmedStockWrite
  const template = bulkTemplates[kind]
  const busy = reading || write.isPending || unconfirmed

  function resetPreview() {
    setPreview(undefined)
    setPage(0)
    setFileName('')
    setFileError('')
    setDownloadError('')
    setCompleted(0)
    write.reset()
  }

  async function download() {
    setDownloadError('')
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.aoa_to_sheet([[...template.headers]])
      XLSX.utils.book_append_sheet(workbook, sheet, template.sheet)
      XLSX.writeFile(workbook, 'OneHub-inventory-' + kind + '.xlsx', { compression: true })
    } catch {
      setDownloadError('Could not download the workbook template.')
    }
  }

  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (!file || busy || lock.current) return
    resetPreview()
    event.currentTarget.value = ''
    setFileName(file.name)
    setReading(true)
    lock.current = true
    try {
      const { readWorkbookFile } = await import('@/lib/security/workbookReader')
      const parsed = await readWorkbookFile(file, { preferredSheetName: template.sheet })
      setPreview(prepareBulkWorkbook(kind, parsed.sheetName, parsed.rows))
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The workbook could not be read.')
    } finally {
      setReading(false)
      lock.current = false
    }
  }

  async function commit() {
    if (!preview?.command || busy || lock.current || !allowed.includes(kind)) return
    lock.current = true
    try {
      await write.mutateAsync(preview.command)
      setCompleted(preview.rows.length)
      setPreview(undefined)
    } catch {
      // Keep the preview available if the database rejects a row.
    } finally {
      setConfirm(false)
      lock.current = false
    }
  }

  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
    <PageHeader eyebrow="Inventory" title="Bulk stock tools" subtitle="Review stock records from Excel before importing them."
      actions={canAdjust && <Link to="/inventory/adjustments" className={textButton}>Record a single adjustment</Link>} />
    <section aria-label="Upload inventory workbook" className={cardClass}>
      <div role="group" aria-label="Workbook type" className="flex flex-wrap gap-2">
        {allowed.map((option) => (
          <Button key={option} type="button" variant={option === kind ? 'primary' : 'outline'} size="sm"
            aria-pressed={option === kind} disabled={busy} onClick={() => { setKind(option); resetPreview() }}>
            {bulkTemplates[option].title}
          </Button>
        ))}
      </div>
      {kind === 'item_master' && <p className="text-sm text-muted">
        For material and equipment rows, enter the category name in the Description column.
      </p>}
      {kind === 'goods_received' && <p className="text-sm text-muted">
        For deliveries that require supplier, invoice and delivery date, use <Link to="/inventory/receiving" className={textButton}>Stock receiving</Link>.
      </p>}
      <div className="flex flex-wrap items-start gap-3">
        <Button type="button" variant="outline" leftIcon={<Download size={16} aria-hidden="true" />} onClick={() => void download()}>
          Download Excel template
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink focus-within:ring-2 focus-within:ring-emerald">
          <FileSpreadsheet size={16} aria-hidden="true" />
          <span>Choose Excel file</span>
          <input type="file" className="sr-only" accept=".xlsx" disabled={busy}
            onChange={(event) => void inspect(event)} />
        </label>
      </div>
      <p className="text-xs text-muted">.xlsx · up to 5 MB and 1,000 rows</p>
      {fileName && <p className="break-all text-sm text-ink">{fileName}</p>}
      {reading && <p role="status" className="text-sm text-muted">Reading workbook…</p>}
      <FieldError error={fileError || downloadError} />
      {completed > 0 && <p role="status" className="rounded-md bg-emerald-tint p-3 text-sm text-ink">{completed} {completed === 1 ? 'record' : 'records'} imported.</p>}
    </section>
    {preview && <section aria-label="Review workbook" className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Workbook preview</h2>
          <p className="text-sm text-muted">{preview.rows.length} {preview.rows.length === 1 ? 'record' : 'records'} · {preview.errors.length} validation {preview.errors.length === 1 ? 'error' : 'errors'}</p>
        </div>
        <Button type="button" disabled={!preview.command || busy} onClick={() => setConfirm(true)}>Review import</Button>
      </div>
      <PreviewRows preview={preview} page={page} setPage={setPage} />
      {preview.errors.length > 0 && <div className="max-h-60 overflow-y-auto rounded-md border border-rose/30 p-3">
        <p role="alert" className="mb-2 text-sm font-semibold text-rose">Correct the listed rows in Excel and upload again.</p>
        <ul className="space-y-1 text-sm text-ink">
          {preview.errors.map(({ row, message }) => <li key={row + message}>Row {row} · {message}</li>)}
        </ul>
      </div>}
      {write.isError && !isAbortError(write.error) && <FieldError>{write.error.message}</FieldError>}
      {unconfirmed && <Link to="/inventory/ledger" className={textButton}>Open stock ledger</Link>}
    </section>}
    {confirm && preview && <Dialog open title="Import inventory records?"
      description={'Apply ' + preview.rows.length + (preview.rows.length === 1 ? ' record' : ' records') + ' from ' + fileName + '.'}
      onOpenChange={(open) => { if (!open && !lock.current) setConfirm(false) }}
      footer={<>
        <Button type="button" variant="outline" disabled={write.isPending} onClick={() => setConfirm(false)}>Cancel</Button>
        <Button type="button" loading={write.isPending} onClick={() => void commit()}>Import records</Button>
      </>} />}
  </main>
}

export function BulkStockPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  if (!scope.isAuthReady || !scope.identityKey) return null
  const permissions = auth.access?.permissionKeys ?? []
  const canReceive = permissions.includes('inventory.receipt')
  const canAdjust = permissions.includes('inventory.adjust')
  if (!canReceive && !canAdjust) return <ForbiddenPage />

  return <BulkContent key={JSON.stringify([scope.identityKey, scope.authEpoch, canReceive, canAdjust])}
    scope={scope} canReceive={canReceive} canAdjust={canAdjust} />
}
