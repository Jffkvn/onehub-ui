import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ClipboardList, PackageCheck, Search, Undo2 } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/patterns/EmptyState'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Input, Textarea } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { extractErrorMessage, isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatDateTimeInZone, formatLocalDateLabel, getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { EquipmentScanner } from '@/modules/warehouse/labels/EquipmentScanner'
import { parseEquipmentLabel } from '@/modules/warehouse/labels/equipmentLabel'
import { listActiveCustody, listReturnWarehouses, recordAssetReturn, related, type ActiveCustody, type ReturnCondition } from './api'
import { routerName } from '../router-float/routerName'

type CustodyMode = 'issued' | 'returns'
type DueFilter = 'all' | 'due' | 'overdue'
const kampalaZone = 'Africa/Kampala'
const selectClass = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald disabled:opacity-50'

function assetName(custody: ActiveCustody) {
  const model = related(custody.equipment)?.model_name
  if (custody.custody_origin === 'warehouse_handover') return model ? routerName(model) : 'Router'
  return model ?? 'Equipment asset'
}

function matchesSearch(custody: ActiveCustody, search: string) {
  if (!search) return true
  const scannedId = parseEquipmentLabel(search)
  if (scannedId) return custody.equipment_asset_id.toLowerCase() === scannedId

  const equipment = related(custody.equipment)
  const custodian = related(custody.custodian)
  return [
    custody.equipment_asset_id,
    equipment?.model_name,
    equipment?.serial_number,
    equipment?.mac_address,
    custody.project_name,
    custodian?.display_name,
  ]
    .some((value) => value?.toLowerCase().includes(search))
}

function CustodyStatus({ date, today }: { date: string | null; today: string }) {
  if (!date) return <StatusPill>No due date</StatusPill>
  if (date < today) return <StatusPill tone="danger">Overdue</StatusPill>
  if (date === today) return <StatusPill tone="warning">Due today</StatusPill>
  return <StatusPill tone="info">Issued</StatusPill>
}

function ReturnDialog({
  custody,
  scope,
  onClose,
  onReturned,
}: {
  custody: ActiveCustody
  scope: IdentityScopeRef
  onClose: () => void
  onReturned: () => void
}) {
  const [warehouseId, setWarehouseId] = useState('')
  const [condition, setCondition] = useState<ReturnCondition | ''>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const sending = useRef(false)
  const queryClient = useQueryClient()
  const warehouses = useQuery({
    queryKey: ['warehouse', 'custody', 'return-warehouses', scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => listReturnWarehouses(scope, signal),
  })
  const isWarehouseActive = warehouses.data?.some((warehouse) => warehouse.id === warehouseId) ?? false

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!condition || !isWarehouseActive || sending.current) return

    sending.current = true
    setSaving(true)
    setError(undefined)
    try {
      await recordAssetReturn(scope, custody, condition, warehouseId, notes)
      onReturned()
    } catch (err) {
      if (!isAbortError(err)) setError(extractErrorMessage(err))
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      sending.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title="Record equipment return"
      description={`${assetName(custody)} · ${related(custody.equipment)?.serial_number ?? custody.project_name ?? 'Router float'}`}
      onOpenChange={(next) => { if (!next && !sending.current) onClose() }}
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormGroup label="Condition" htmlFor="custody-return-condition" required>
          <select className={selectClass} id="custody-return-condition" required disabled={saving}
            value={condition} onChange={(event) => setCondition(event.target.value as ReturnCondition | '')}>
            <option value="">Select condition</option>
            <option value="good">Good</option>
            <option value="damaged">Damaged</option>
            <option value="lost">Lost</option>
          </select>
        </FormGroup>
        <FormGroup label="Return warehouse" htmlFor="custody-return-warehouse" required>
          <select className={selectClass} id="custody-return-warehouse" required
            value={warehouseId} disabled={saving || !warehouses.data?.length}
            onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">{warehouses.isPending ? 'Loading warehouses…' : 'Select warehouse'}</option>
            {warehouses.data?.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </select>
          {warehouses.isError && (
            <div className="flex flex-wrap items-center gap-2">
              <FieldError>Could not load the return warehouses.</FieldError>
              <Button type="button" variant="outline" size="sm" onClick={() => void warehouses.refetch()}>Try again</Button>
            </div>
          )}
          {warehouses.data?.length === 0 && <FieldError>No active warehouse is available for returns.</FieldError>}
        </FormGroup>
        <FormGroup label="Notes" htmlFor="custody-return-notes">
          <Textarea id="custody-return-notes" value={notes} disabled={saving}
            onChange={(event) => setNotes(event.target.value)} placeholder="Add details if needed" />
        </FormGroup>
        <FieldError error={error} />
        <div className="flex justify-end gap-2.5 border-t border-line pt-4">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!condition || !isWarehouseActive}>Confirm return</Button>
        </div>
      </form>
    </Dialog>
  )
}

function CustodyContent({ canReturn, mode, scope }: { canReturn: boolean; mode: CustodyMode; scope: IdentityScopeRef }) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')
  const [selection, setSelection] = useState<ActiveCustody>()
  const [confirmation, setConfirmation] = useState('')
  const query = useQuery({
    queryKey: ['warehouse', 'custody', 'active', scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => listActiveCustody(scope, signal),
  })

  const today = getTodayIsoInZone(kampalaZone)
  const isReturns = mode === 'returns'
  const rows = query.data ?? []
  const visibleRows = rows.filter((row) => {
    if (!matchesSearch(row, search)) return false
    if (!isReturns || dueFilter === 'all') return true
    const date = row.expected_return_date
    return date !== null && (dueFilter === 'overdue' ? date < today : date <= today)
  })
  if (isReturns) {
    visibleRows.sort((a, b) =>
      (a.expected_return_date ?? '9999-12-31').localeCompare(b.expected_return_date ?? '9999-12-31'))
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isReturns ? 'Returns Due' : 'Issued Assets'}
        subtitle={isReturns ? 'Review due dates and record equipment returns.' : 'See who has equipment checked out.'}
      />

      {confirmation && <p role="status" className="rounded-md bg-emerald-tint px-3 py-2 text-sm text-ink">{confirmation}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <form role="search" className="flex min-w-0 flex-1 items-end gap-2"
          onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim().toLowerCase()) }}>
          <FormGroup className="min-w-0 max-w-lg flex-1" label="Find equipment" htmlFor="custody-search">
            <Input
              id="custody-search" type="search" value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value)
                if (!event.target.value) setSearch('')
              }}
              placeholder="Name, serial number, project, or QR sticker"
              leftIcon={<Search aria-hidden="true" className="h-4 w-4" />}
            />
          </FormGroup>
          <Button type="submit" variant="secondary" className="shrink-0">Find</Button>
        </form>
        <Button type="button" variant="outline" className="self-start sm:self-auto" leftIcon={<Camera size={16} aria-hidden="true" />}
          onClick={() => setScannerOpen(true)}>Scan QR label</Button>
        {isReturns && (
          <FormGroup label="Due date" htmlFor="custody-due-filter">
            <select id="custody-due-filter" className={selectClass} value={dueFilter}
              onChange={(event) => setDueFilter(event.target.value as DueFilter)}>
              <option value="all">All active</option>
              <option value="due">Due today or overdue</option>
              <option value="overdue">Overdue only</option>
            </select>
          </FormGroup>
        )}
      </div>

      {query.isPending && <p role="status" className="text-sm text-muted">Loading issued equipment…</p>}
      {query.isError && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
          <FieldError>Could not load active custody.</FieldError>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Try again</Button>
        </div>
      )}
      {query.isSuccess && visibleRows.length === 0 && (
        <EmptyState
          className="rounded-lg border border-line bg-surface"
          title={search || dueFilter !== 'all' ? 'No matching equipment' : 'No active custody'}
          description={search || dueFilter !== 'all' ? 'Try a different label, search, or due date.' : 'Checked-out equipment will appear here.'}
          icon={<PackageCheck className="h-6 w-6" />}
        />
      )}
      {query.isSuccess && visibleRows.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {visibleRows.map((row) => (
            <li key={row.id} className="space-y-4 rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="break-words font-display text-base font-semibold text-ink">{assetName(row)}</h2>
                  <p className="break-all text-xs text-muted">{related(row.equipment)?.serial_number?.trim() || 'No serial recorded'}</p>
                </div>
                <CustodyStatus date={row.expected_return_date} today={today} />
              </div>
              <dl className="grid grid-cols-2 gap-3 text-xs text-soft">
                <div><dt className="text-muted">Assigned to</dt><dd className="font-medium text-ink">{related(row.custodian)?.display_name ?? 'Name unavailable'}</dd></div>
                <div><dt className="text-muted">{row.custody_origin === 'warehouse_handover' ? 'Workflow' : 'Project'}</dt><dd className="break-words font-medium text-ink">{row.project_name ?? 'Router float'}</dd></div>
                <div><dt className="text-muted">Issued</dt><dd>{formatDateTimeInZone(row.issued_at, kampalaZone)}</dd></div>
                <div><dt className="text-muted">Return by</dt><dd>{row.expected_return_date ? formatLocalDateLabel(row.expected_return_date) : '—'}</dd></div>
                <div><dt className="text-muted">Issued from</dt><dd>{related(row.source_warehouse)?.name ?? 'Warehouse unavailable'}</dd></div>
                <div><dt className="text-muted">Condition at issue</dt><dd className="break-words">{row.issue_condition}</dd></div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                {row.stock_request_id ? (
                  <Link to={`/inventory/requests/${row.stock_request_id}`}
                    className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald hover:underline">
                    <ClipboardList aria-hidden="true" className="h-4 w-4" />
                    Open request
                  </Link>
                ) : (
                  <Link to="/inventory/router-float"
                    className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald hover:underline">
                    <ClipboardList aria-hidden="true" className="h-4 w-4" />
                    Open router float
                  </Link>
                )}
                {isReturns && canReturn && (row.custody_origin ?? 'stock_request') === 'stock_request' && (
                  <Button type="button" size="sm" variant="outline"
                    aria-label={`Record return for ${assetName(row)}`}
                    leftIcon={<Undo2 aria-hidden="true" className="h-4 w-4" />}
                    onClick={() => { setConfirmation(''); setSelection(row) }}>
                    Record return
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {scannerOpen && <EquipmentScanner onClose={() => setScannerOpen(false)} onScanned={(label) => {
        setSearchInput(label)
        setSearch(label.toLowerCase())
        setDueFilter('all')
        setScannerOpen(false)
      }} />}
      {selection && isReturns && canReturn && (
        <ReturnDialog
          key={selection.id}
          custody={selection}
          scope={scope}
          onClose={() => setSelection(undefined)}
          onReturned={() => {
            setConfirmation(`Return recorded for ${assetName(selection)}.`)
            setSelection(undefined)
          }}
        />
      )}
    </div>
  )
}

export function CustodyPage({ mode }: { mode: CustodyMode }) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permissions = auth.access?.permissionKeys ?? []
  if (!scope.isAuthReady || !scope.identityKey) return null
  if (!permissions.includes('inventory.read')) {
    return <EmptyState title="Warehouse access required" description="You need inventory read access to view these records." />
  }

  return <CustodyContent key={`${mode}:${scope.identityKey}:${scope.authEpoch}`} canReturn={permissions.includes('inventory.issue')} mode={mode} scope={scope} />
}
