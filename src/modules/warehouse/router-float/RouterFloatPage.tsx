import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, FileSpreadsheet, PackagePlus, Router, ShieldAlert, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'

import { routerName } from './routerName'
import { EmptyState } from '@/components/patterns/EmptyState'
import { KpiCard } from '@/components/patterns/KpiCard'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Input, Textarea } from '@/components/ui/Input'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { extractErrorMessage, isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { readActiveWarehouses, readCategoryOptions } from '@/modules/warehouse/stock/stockApi'

import {
  ROUTER_FLOAT_CAP,
  cancelRouterHandover,
  checkExistingRouterIdentifiers,
  issueRouterFloat,
  parseRouterBatchText,
  parseRouterBatchWorkbookRows,
  readRouterFloatOverview,
  receiveRouterBatch,
  receiveRouterFloatReturn,
  validateRouterBatchDraft,
  type ActiveFloatRouter,
  type RouterDraftRow,
} from './routerFloatApi'

type PageTab = 'float' | 'receive'
type StateFilter = 'all' | ActiveFloatRouter['float_state']

const selectClass =
  'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald disabled:opacity-50'
const cardClass = 'space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-6'
const ugxFormat = new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 })

const floatStateMeta: Record<ActiveFloatRouter['float_state'], { label: string; tone: StatusPillProps['tone'] }> = {
  pending_handover: { label: 'Pending pickup', tone: 'warning' },
  with_technician: { label: 'With tech', tone: 'info' },
  faulty_to_return: { label: 'Faulty to return', tone: 'danger' },
}

function createEmptyRow(): RouterDraftRow {
  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    model_name: '',
    serial_number: '',
    mac_address: '',
    unit_price: '0',
    condition_notes: '',
  }
}

function RouterReturnDialog({
  item,
  warehouses,
  scope,
  onClose,
  onCompleted,
}: {
  item: ActiveFloatRouter
  warehouses: { id: string; name: string; code: string }[]
  scope: IdentityScopeRef
  onClose: () => void
  onCompleted: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const isReportedFaulty = item.float_state === 'faulty_to_return'
  const [warehouseId, setWarehouseId] = useState(item.warehouse_id)
  const [condition, setCondition] = useState<'damaged' | 'good'>(
    isReportedFaulty ? 'damaged' : 'good',
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string>()

  const effectiveCondition: 'damaged' | 'good' = isReportedFaulty ? 'damaged' : condition
  const requiresInspectionNote = isReportedFaulty || effectiveCondition === 'damaged'
  const inspectionNoteValid = !requiresInspectionNote || notes.trim().length >= 3

  const mutation = useMutation({
    mutationFn: () =>
      receiveRouterFloatReturn(scope, {
        custodyId: item.custody_id,
        warehouseId,
        condition: effectiveCondition,
        notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      onCompleted(`Confirmed return for ${item.serial_number} (${effectiveCondition === 'damaged' ? 'Faulty or damaged (quarantine)' : 'Good'}).`)
    },
    onError: (err) => {
      if (!isAbortError(err)) setError(extractErrorMessage(err))
    },
  })

  return (
    <Dialog
      open
      title="Confirm router return"
      description={`${routerName(item.model_name)} · SN ${item.serial_number}${item.mac_address ? ` · MAC ${item.mac_address}` : ''}`}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending) onClose()
      }}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!inspectionNoteValid) {
            setError('Enter a warehouse inspection note (at least 3 characters).')
            return
          }
          setError(undefined)
          mutation.mutate()
        }}
      >
        {item.faulty_notes && (
          <div className="rounded-md border border-rose/30 bg-rose-tint/25 px-3 py-2 text-xs text-ink">
            <span className="font-semibold">Technician fault report:</span> {item.faulty_notes}
          </div>
        )}

        <FormGroup
          label="Return condition"
          htmlFor="router-return-condition"
          required
          hint={isReportedFaulty ? 'Reported faulty CPE routers must go into quarantine.' : undefined}
        >
          <select
            id="router-return-condition"
            className={selectClass}
            value={effectiveCondition}
            disabled={mutation.isPending || isReportedFaulty}
            onChange={(e) => setCondition(e.target.value as 'damaged' | 'good')}
          >
            <option value="damaged">Faulty or damaged (quarantine)</option>
            {!isReportedFaulty && (
              <option value="good">Good (back to available depot stock)</option>
            )}
          </select>
        </FormGroup>

        <FormGroup label="Receiving warehouse" htmlFor="router-return-warehouse" required>
          <select
            id="router-return-warehouse"
            className={selectClass}
            value={warehouseId}
            disabled={mutation.isPending}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </FormGroup>

        <FormGroup
          label="Warehouse inspection notes"
          htmlFor="router-return-notes"
          required={requiresInspectionNote}
          hint={requiresInspectionNote ? 'Describe what you found during inspection. Enter at least 3 characters.' : undefined}
        >
          <Textarea
            id="router-return-notes"
            value={notes}
            required={requiresInspectionNote}
            disabled={mutation.isPending}
            onChange={(e) => {
              setNotes(e.target.value)
              setError(undefined)
            }}
            placeholder="e.g. The router did not power on during testing"
          />
        </FormGroup>

        <FieldError error={error} />

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={!warehouseId || !inspectionNoteValid}>
            Confirm physical return
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function FloatIssuancePanel({
  scope,
  canIssue,
  warehouses,
}: {
  scope: IdentityScopeRef
  canIssue: boolean
  warehouses: { id: string; name: string; code: string }[]
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [selectedTechId, setSelectedTechId] = useState('')
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [issueCondition, setIssueCondition] = useState('Good working order')
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [availableSearch, setAvailableSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [returnTarget, setReturnTarget] = useState<ActiveFloatRouter | null>(null)
  const [actionError, setActionError] = useState<string>()

  const overviewQuery = useQuery({
    queryKey: ['warehouse', 'router-float', 'overview', scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => readRouterFloatOverview(scope, signal),
    enabled: scope.isAuthReady && Boolean(scope.identityKey),
    retry: false,
  })

  const issueMutation = useMutation({
    mutationFn: () =>
      issueRouterFloat(scope, {
        technicianProfileId: selectedTechId,
        warehouseId: effectiveWarehouseId,
        equipmentAssetIds: selectedAssetIds,
        issueCondition,
      }),
    onSuccess: () => {
      setSelectedAssetIds([])
      setActionError(undefined)
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      toast('Routers issued — awaiting technician counter confirmation', { tone: 'success' })
    },
    onError: (err) => {
      if (!isAbortError(err)) setActionError(extractErrorMessage(err))
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (custodyId: string) => cancelRouterHandover(scope, custodyId, 'Cancelled at depot counter'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      toast('Unconfirmed handover cancelled and router returned to depot stock', { tone: 'success' })
    },
    onError: (err) => {
      if (!isAbortError(err)) toast(extractErrorMessage(err), { tone: 'danger' })
    },
  })

  const overview = overviewQuery.data
  const effectiveWarehouseId = selectedWarehouseId || warehouses[0]?.id || ''
  const selectedTech = overview?.technicians.find((t) => t.profile_id === selectedTechId) ?? null
  const remainingSlots = selectedTech?.remaining_slots ?? ROUTER_FLOAT_CAP

  const availableInWarehouse = useMemo(() => {
    const term = availableSearch.trim().toLowerCase()
    return (overview?.available_routers ?? []).filter((r) => {
      if (effectiveWarehouseId && r.warehouse_id !== effectiveWarehouseId) return false
      if (!term) return true
      return [r.model_name, r.serial_number, r.mac_address]
        .some((v) => v?.toLowerCase().includes(term))
    })
  }, [overview?.available_routers, effectiveWarehouseId, availableSearch])

  const filteredActive = useMemo(() => {
    const term = activeSearch.trim().toLowerCase()
    return (overview?.active_float ?? []).filter((row) => {
      if (stateFilter !== 'all' && row.float_state !== stateFilter) return false
      if (!term) return true
      return [row.model_name, row.serial_number, row.mac_address, row.custodian_name]
        .some((v) => v?.toLowerCase().includes(term))
    })
  }, [overview?.active_float, stateFilter, activeSearch])

  function toggleRouter(id: string) {
    setActionError(undefined)
    setSelectedAssetIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id)
      if (prev.length >= remainingSlots) return prev
      return [...prev, id]
    })
  }

  if (overviewQuery.isPending) {
    return <p role="status" className="text-sm text-muted">Loading router float inventory…</p>
  }
  if (overviewQuery.isError) {
    return (
      <div role="alert" className={cardClass}>
        <FieldError>{extractErrorMessage(overviewQuery.error)}</FieldError>
        <Button type="button" variant="outline" size="sm" onClick={() => void overviewQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const technicians = overview?.technicians ?? []
  const cap = overview?.cap ?? ROUTER_FLOAT_CAP
  const activeCount = overview?.active_float.length ?? 0
  const pendingCount = overview?.active_float.filter((r) => r.float_state === 'pending_handover').length ?? 0
  const faultyCount = overview?.active_float.filter((r) => r.float_state === 'faulty_to_return').length ?? 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Available CPE routers" value={String(overview?.available_routers.length ?? 0)} icon={<Router size={18} />} tone="blue" />
        <KpiCard title="Active technician float" value={String(activeCount)} icon={<CheckCircle2 size={18} />} />
        <KpiCard title="Pending counter pickup" value={String(pendingCount)} icon={<Clock size={18} />} tone="amber" />
        <KpiCard title="Faulty pending return" value={String(faultyCount)} icon={<AlertTriangle size={18} />} tone="rose" />
      </div>

      {/* Technician Cap Overview */}
      <section className={cardClass} aria-labelledby="tech-float-caps-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="tech-float-caps-heading" className="font-display text-base font-semibold text-ink">
              Technician float allowance (Cap {cap})
            </h2>
            <p className="text-xs text-muted">
              Includes confirmed units, unconfirmed counter handovers, and faulty float units awaiting depot return.
            </p>
          </div>
        </div>
        {technicians.length === 0 ? (
          <p className="text-sm text-muted">No active Service Technician accounts found.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {technicians.map((tech) => (
              <div
                key={tech.profile_id}
                className="rounded-lg border border-line bg-canvas p-3.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-ink">{tech.display_name}</p>
                    <p className="text-xs text-muted">{tech.employee_number ?? 'Service Technician'}</p>
                  </div>
                  <StatusPill tone={tech.active_total >= cap ? 'warning' : 'success'} withDot={false}>
                    {tech.active_total} / {cap}
                  </StatusPill>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-soft">
                  <span>Ready: {tech.confirmed_count}</span>
                  <span>· Pending: {tech.pending_count}</span>
                  <span>· Faulty: {tech.faulty_count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Direct Issuance Form */}
      {canIssue && (
        <section className={cardClass} aria-labelledby="issue-float-heading">
          <div>
            <h2 id="issue-float-heading" className="font-display text-base font-semibold text-ink">
              Issue routers to technician float
            </h2>
            <p className="text-xs text-muted">
              Select an eligible Service Technician and up to {cap} available routers. The technician confirms receipt at the counter.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormGroup label="Warehouse" htmlFor="float-issue-warehouse" required>
              <select
                id="float-issue-warehouse"
                className={selectClass}
                value={effectiveWarehouseId}
                disabled={issueMutation.isPending}
                onChange={(e) => {
                  setSelectedWarehouseId(e.target.value)
                  setSelectedAssetIds([])
                }}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </FormGroup>

            <FormGroup label="Service Technician" htmlFor="float-issue-tech" required>
              <select
                id="float-issue-tech"
                className={selectClass}
                value={selectedTechId}
                disabled={issueMutation.isPending}
                onChange={(e) => {
                  setSelectedTechId(e.target.value)
                  setSelectedAssetIds([])
                  setActionError(undefined)
                }}
              >
                <option value="">Select technician</option>
                {technicians.map((t) => (
                  <option key={t.profile_id} value={t.profile_id} disabled={t.remaining_slots === 0}>
                    {t.display_name} ({t.active_total}/{cap} used · {t.remaining_slots} left)
                  </option>
                ))}
              </select>
            </FormGroup>

            <FormGroup label="Condition at handover" htmlFor="float-issue-condition">
              <Input
                id="float-issue-condition"
                value={issueCondition}
                disabled={issueMutation.isPending}
                onChange={(e) => setIssueCondition(e.target.value)}
                maxLength={500}
              />
            </FormGroup>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Input
                aria-label="Filter available routers"
                placeholder="Search available routers by model, serial, or MAC…"
                value={availableSearch}
                onChange={(e) => setAvailableSearch(e.target.value)}
                className="max-w-sm"
              />
              <span className="text-xs font-medium text-soft">
                {selectedTech
                  ? `Selected ${selectedAssetIds.length} of ${remainingSlots} remaining slot(s)`
                  : 'Choose a technician to pick routers'}
              </span>
            </div>

            {availableInWarehouse.length === 0 ? (
              <p className="rounded-md border border-line bg-canvas p-3 text-xs text-muted">
                No available CPE routers in this warehouse. Receive a supplier batch on the Receive tab first.
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {availableInWarehouse.map((router) => {
                  const checked = selectedAssetIds.includes(router.id)
                  const disabled =
                    !selectedTech ||
                    issueMutation.isPending ||
                    (!checked && selectedAssetIds.length >= remainingSlots)
                  return (
                    <label
                      key={router.id}
                      className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-canvas"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleRouter(router.id)}
                        />
                        <span className="truncate font-medium text-ink">{routerName(router.model_name)}</span>
                        <span className="font-mono text-xs text-soft">{router.serial_number}</span>
                        {router.mac_address && (
                          <span className="hidden sm:inline font-mono text-xs text-muted">
                            {router.mac_address}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted shrink-0">{router.warehouse_name ?? 'Depot'}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {actionError && <FieldError>{actionError}</FieldError>}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              loading={issueMutation.isPending}
              disabled={!selectedTechId || !effectiveWarehouseId || selectedAssetIds.length === 0}
              onClick={() => issueMutation.mutate()}
            >
              Issue {selectedAssetIds.length > 0 ? `${selectedAssetIds.length} ` : ''}router(s) to float
            </Button>
          </div>
        </section>
      )}

      {/* Active Handovers & Faulty Returns */}
      <section className={cardClass} aria-labelledby="active-float-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="active-float-heading" className="font-display text-base font-semibold text-ink">
            Active handovers &amp; returns ({filteredActive.length})
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search active float"
              placeholder="Search SN, MAC, tech…"
              value={activeSearch}
              onChange={(e) => setActiveSearch(e.target.value)}
              className="w-52"
            />
            <select
              aria-label="Filter float status"
              className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as StateFilter)}
            >
              <option value="all">All states</option>
              <option value="pending_handover">Pending pickup</option>
              <option value="with_technician">With technician</option>
              <option value="faulty_to_return">Faulty to return</option>
            </select>
          </div>
        </div>

        {filteredActive.length === 0 ? (
          <EmptyState
            title="No active float routers match"
            description="Issued routers awaiting pickup, installation, or faulty return appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-xs text-soft">
                <tr>
                  <th className="px-3 py-2">Router (SN / MAC)</th>
                  <th className="px-3 py-2">Technician</th>
                  <th className="px-3 py-2">Depot</th>
                  <th className="px-3 py-2">State</th>
                  {canIssue && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredActive.map((row) => {
                  const meta = floatStateMeta[row.float_state]
                  return (
                    <tr key={row.custody_id} className="text-ink">
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{routerName(row.model_name)}</p>
                        <p className="font-mono text-xs text-soft">
                          {row.serial_number}
                          {row.mac_address ? ` · ${row.mac_address}` : ''}
                        </p>
                        {row.faulty_notes && (
                          <p className="mt-1 text-xs text-rose">Fault: {row.faulty_notes}</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{row.custodian_name}</td>
                      <td className="px-3 py-2.5 text-soft">{row.warehouse_name}</td>
                      <td className="px-3 py-2.5">
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      </td>
                      {canIssue && (
                        <td className="px-3 py-2.5 text-right space-x-2 whitespace-nowrap">
                          {row.float_state === 'pending_handover' ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={cancelMutation.isPending}
                              onClick={() => cancelMutation.mutate(row.custody_id)}
                            >
                              Cancel handover
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              leftIcon={<Undo2 className="h-3.5 w-3.5" />}
                              onClick={() => setReturnTarget(row)}
                            >
                              Confirm return
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {returnTarget && (
        <RouterReturnDialog
          item={returnTarget}
          warehouses={warehouses}
          scope={scope}
          onClose={() => setReturnTarget(null)}
          onCompleted={(msg) => {
            setReturnTarget(null)
            toast(msg, { tone: 'success' })
          }}
        />
      )}
    </div>
  )
}

function ReceiveRouterDeliveryPanel({
  scope,
  warehouses,
  categories,
  onDone,
}: {
  scope: IdentityScopeRef
  warehouses: { id: string; name: string; code: string }[]
  categories: { id: string; name: string }[]
  onDone: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const today = getTodayIsoInZone('Africa/Kampala')

  const defaultRouterCat = categories.find((c) => c.name.toLowerCase().includes('router'))
  const [warehouseId, setWarehouseId] = useState('')
  const [categoryId, setCategoryId] = useState(defaultRouterCat?.id ?? '')
  const [categoryName, setCategoryName] = useState('Fixed-Internet CPE Routers')
  const [supplier, setSupplier] = useState('')
  const [grn, setGrn] = useState('')
  const [invoice, setInvoice] = useState('')
  const [receivedDate, setReceivedDate] = useState(today)
  const [defaultModel, setDefaultModel] = useState('Huawei HG8245H5')
  const [defaultPrice, setDefaultPrice] = useState('185000')
  const [rawPaste, setRawPaste] = useState('')
  const [rows, setRows] = useState<RouterDraftRow[]>([])
  const [fileError, setFileError] = useState<string>()
  const [idemKey, setIdemKey] = useState(() => `cpe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const [lastResult, setLastResult] = useState<{ asset_count: number; total_value: number; replayed: boolean }>()

  const effectiveWarehouseId = warehouseId || warehouses[0]?.id || ''
  const serialCheckKey = useMemo(
    () => [...new Set(rows.map((r) => r.serial_number.trim()).filter((s) => s.length >= 2))].sort(),
    [rows],
  )
  const macCheckKey = useMemo(
    () => [...new Set(rows.map((r) => r.mac_address.trim()).filter((m) => m.length >= 4))].sort(),
    [rows],
  )
  const hasIdentifiersToCheck = serialCheckKey.length > 0 || macCheckKey.length > 0

  const normalizedDraftItems = useMemo(
    () =>
      rows.map((r) => ({
        model_name: r.model_name.trim(),
        serial_number: r.serial_number.trim(),
        mac_address: r.mac_address.trim() || null,
        unit_price: r.unit_price.replace(/,/g, '').trim() || '0',
        condition_notes: r.condition_notes.trim() || null,
      })),
    [rows],
  )

  const existingCheckQuery = useQuery({
    queryKey: [
      'warehouse',
      'router-float',
      'existing-identifiers',
      scope.identityKey,
      scope.authEpoch,
      effectiveWarehouseId,
      supplier.trim(),
      grn.trim(),
      invoice.trim(),
      receivedDate,
      normalizedDraftItems,
    ],
    queryFn: ({ signal }) =>
      checkExistingRouterIdentifiers(
        scope,
        {
          serialNumbers: serialCheckKey,
          macAddresses: macCheckKey,
          warehouseId: effectiveWarehouseId,
          supplierName: supplier,
          grnNumber: grn,
          invoiceNumber: invoice,
          receivedDate,
          rows,
        },
        signal,
      ),
    enabled: scope.isAuthReady && Boolean(scope.identityKey) && hasIdentifiersToCheck,
    retry: false,
  })

  const isExactReplay = Boolean(existingCheckQuery.data?.replays_existing_receipt)
  const hasGrnConflict = Boolean(existingCheckQuery.data?.grn_conflict)

  const existingConflicts = useMemo(
    () =>
      isExactReplay
        ? { serials: new Set<string>(), macs: new Set<string>() }
        : {
            serials: new Set(existingCheckQuery.data?.existing_serials.map((s) => s.trim().toLowerCase()) ?? []),
            macs: new Set(existingCheckQuery.data?.existing_macs.map((m) => m.trim().toLowerCase()) ?? []),
          },
    [existingCheckQuery.data, isExactReplay],
  )

  const validation = useMemo(() => validateRouterBatchDraft(rows, existingConflicts), [rows, existingConflicts])
  const isCheckingCatalog = hasIdentifiersToCheck && existingCheckQuery.isFetching

  const receiveMutation = useMutation({
    mutationFn: () =>
      receiveRouterBatch(scope, {
        warehouseId: effectiveWarehouseId,
        categoryId: categoryId || null,
        categoryName: categoryId ? null : categoryName,
        supplierName: supplier,
        grnNumber: grn,
        invoiceNumber: invoice,
        receivedDate,
        idempotencyKey: idemKey,
        rows,
      }),
    onSuccess: (res) => {
      setLastResult(res)
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      toast(
        res.replayed
          ? `Delivery already recorded (${res.asset_count} routers)`
          : `Received ${res.asset_count} CPE routers into stock`,
        { tone: 'success' },
      )
      setRows([])
      setRawPaste('')
      setGrn('')
      setInvoice('')
      setIdemKey(`cpe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      if (!res.replayed) {
        onDone()
      }
    },
  })

  function appendParsedRows(nextRows: RouterDraftRow[]) {
    if (nextRows.length === 0) return
    setRows((prev) => [...prev, ...nextRows])
    setFileError(undefined)
  }

  function handleParsePaste() {
    const parsed = parseRouterBatchText(rawPaste, defaultModel, defaultPrice)
    if (parsed.length === 0) {
      setFileError('Paste at least one serial line or upload a spreadsheet.')
      return
    }
    appendParsedRows(parsed)
    setRawPaste('')
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setFileError(undefined)
    try {
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.xlsx')) {
        const { readWorkbookFile } = await import('@/lib/security/workbookReader')
        const parsed = await readWorkbookFile(file)
        appendParsedRows(parseRouterBatchWorkbookRows(parsed.rows, defaultModel, defaultPrice))
      } else {
        const text = await file.text()
        appendParsedRows(parseRouterBatchText(text, defaultModel, defaultPrice))
      }
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not read the delivery file.')
    }
  }

  function updateRow(id: string, patch: Partial<RouterDraftRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (validation.hasErrors || hasGrnConflict || isCheckingCatalog || !effectiveWarehouseId || receiveMutation.isPending) return
    receiveMutation.mutate()
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      {lastResult && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald/40 bg-emerald-tint/40 p-3 text-sm text-ink">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>
            {lastResult.replayed ? 'Replayed idempotent delivery: ' : 'Recorded '}
            {lastResult.asset_count} router(s) · Total {ugxFormat.format(lastResult.total_value)}.
          </span>
        </div>
      )}

      <section className={cardClass} aria-label="Supplier delivery header">
        <h2 className="font-display text-base font-semibold text-ink">1. Delivery header</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormGroup label="Warehouse" htmlFor="cpe-wh" required>
            <select
              id="cpe-wh"
              className={selectClass}
              value={effectiveWarehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              required
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </FormGroup>

          <FormGroup label="Category" htmlFor="cpe-cat">
            <select
              id="cpe-cat"
              className={selectClass}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{categoryName} (auto-create if needed)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormGroup>

          {!categoryId && (
            <FormGroup label="Category name" htmlFor="cpe-cat-name" required>
              <Input
                id="cpe-cat-name"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                required
              />
            </FormGroup>
          )}

          <FormGroup label="Supplier" htmlFor="cpe-supplier" required>
            <Input
              id="cpe-supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g. Huawei Distributor UG"
              required
              minLength={2}
            />
          </FormGroup>

          <FormGroup label="Delivery note / GRN number" htmlFor="cpe-grn" required>
            <Input
              id="cpe-grn"
              value={grn}
              onChange={(e) => setGrn(e.target.value)}
              placeholder="e.g. GRN-2026-041"
              required
              minLength={2}
            />
          </FormGroup>

          <FormGroup label="Invoice number" htmlFor="cpe-invoice" required>
            <Input
              id="cpe-invoice"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              placeholder="e.g. INV-90821"
              required
              minLength={2}
            />
          </FormGroup>

          <FormGroup label="Received date" htmlFor="cpe-date" required>
            <Input
              id="cpe-date"
              type="date"
              max={today}
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              required
            />
          </FormGroup>
        </div>
      </section>

      <section className={cardClass} aria-label="Router manifest entry">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">
              2. Scan, paste, or upload supplier serial manifest
            </h2>
            <p className="text-xs text-muted">
              Supports bare USB barcode scanner serials (one per line), comma/tab columns (Model, Unit Price, SN, optional MAC), or .xlsx/.csv files.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-canvas">
            <FileSpreadsheet className="h-4 w-4" />
            <span>Upload .xlsx / .csv</span>
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.csv,.tsv,.txt"
              onChange={(e) => void handleFileUpload(e)}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormGroup label="Default model (used for bare scanner serials)" htmlFor="cpe-def-model">
            <Input
              id="cpe-def-model"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            />
          </FormGroup>
          <FormGroup label="Default unit price (UGX)" htmlFor="cpe-def-price">
            <Input
              id="cpe-def-price"
              type="number"
              min={0}
              step="0.01"
              value={defaultPrice}
              onChange={(e) => setDefaultPrice(e.target.value)}
            />
          </FormGroup>
        </div>

        <FormGroup
          label="Paste lines or scan directly with USB barcode scanner"
          htmlFor="cpe-paste"
          hint="Examples: '2150084192001' OR 'Huawei HG8245H5, 185000, 2150084192001, AA:BB:CC:11:22:33'"
        >
          <Textarea
            id="cpe-paste"
            rows={4}
            value={rawPaste}
            onChange={(e) => setRawPaste(e.target.value)}
            placeholder="Scan or paste serials here…"
          />
        </FormGroup>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={handleParsePaste} disabled={!rawPaste.trim()}>
            Add lines to preview
          </Button>
          <Button type="button" variant="outline" onClick={() => setRows((prev) => [...prev, createEmptyRow()])}>
            + Add blank row
          </Button>
        </div>
        <FieldError error={fileError} />
      </section>

      {rows.length > 0 && (
        <section className={cardClass} aria-label="Editable router batch preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-ink">
                3. Review &amp; fix rows ({rows.length} units · {ugxFormat.format(validation.totalValue)})
              </h2>
              <p className="text-xs text-muted">
                Edit any highlighted duplicate serial or MAC directly before saving.
              </p>
            </div>
            {isCheckingCatalog && (
              <StatusPill tone="info" withDot={false}>Checking existing inventory serials…</StatusPill>
            )}
            {!isCheckingCatalog && isExactReplay && (
              <StatusPill tone="success" withDot={false}>Matches recorded delivery (idempotent replay)</StatusPill>
            )}
            {!isCheckingCatalog && !isExactReplay && (validation.hasErrors || hasGrnConflict) && (
              <StatusPill tone="danger" withDot={false}>Fix highlighted rows before receiving</StatusPill>
            )}
          </div>

          {!isCheckingCatalog && isExactReplay && (
            <div role="status" className="rounded-lg border border-emerald/40 bg-emerald-tint/30 p-3 text-xs text-ink">
              This manifest matches GRN <span className="font-mono font-semibold">{grn}</span> ({existingCheckQuery.data?.existing_asset_count ?? rows.length} router(s) already recorded). Click Receive to reopen the original receipt without duplicating stock.
            </div>
          )}

          {!isCheckingCatalog && hasGrnConflict && (
            <FieldError>
              Delivery note / GRN number &quot;{grn}&quot; already exists in this warehouse with different items or header values.
            </FieldError>
          )}

          {existingCheckQuery.isError && !isAbortError(existingCheckQuery.error) && (
            <p className="text-xs text-amber" role="status">
              Could not pre-check existing serials ({extractErrorMessage(existingCheckQuery.error)}). Duplicate checks still run when saving.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-canvas text-soft">
                <tr>
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2">Serial Number</th>
                  <th className="px-2 py-2">MAC Address (Optional)</th>
                  <th className="px-2 py-2">Unit Price</th>
                  <th className="px-2 py-2">Notes</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const rowErrs = validation.rowErrors[row.id] ?? []
                  return (
                    <tr key={row.id} className={rowErrs.length > 0 ? 'bg-rose-tint/25' : undefined}>
                      <td className="p-2 align-top">
                        <Input
                          aria-label={`Model for row ${row.id}`}
                          value={routerName(row.model_name)}
                          onChange={(e) => updateRow(row.id, { model_name: e.target.value })}
                          className="h-8 text-xs"
                        />
                        {rowErrs.map((msg) => (
                          <p key={msg} className="mt-1 text-[11px] font-medium text-rose">
                            {msg}
                          </p>
                        ))}
                      </td>
                      <td className="p-2 align-top">
                        <Input
                          aria-label={`Serial for row ${row.id}`}
                          value={row.serial_number}
                          onChange={(e) => updateRow(row.id, { serial_number: e.target.value })}
                          className="h-8 font-mono text-xs"
                        />
                      </td>
                      <td className="p-2 align-top">
                        <Input
                          aria-label={`MAC for row ${row.id}`}
                          value={row.mac_address}
                          onChange={(e) => updateRow(row.id, { mac_address: e.target.value })}
                          placeholder="Optional"
                          className="h-8 font-mono text-xs"
                        />
                      </td>
                      <td className="p-2 align-top">
                        <Input
                          aria-label={`Price for row ${row.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.unit_price}
                          onChange={(e) => updateRow(row.id, { unit_price: e.target.value })}
                          className="h-8 w-28 text-xs"
                        />
                      </td>
                      <td className="p-2 align-top">
                        <Input
                          aria-label={`Notes for row ${row.id}`}
                          value={row.condition_notes}
                          onChange={(e) => updateRow(row.id, { condition_notes: e.target.value })}
                          placeholder="Sealed OK"
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="p-2 align-top text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label="Remove row"
                          onClick={() => removeRow(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {receiveMutation.isError && !isAbortError(receiveMutation.error) && (
            <FieldError>{extractErrorMessage(receiveMutation.error)}</FieldError>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="submit"
              loading={receiveMutation.isPending}
              disabled={validation.hasErrors || hasGrnConflict || isCheckingCatalog || !effectiveWarehouseId}
            >
              {isExactReplay ? 'Reopen recorded delivery receipt' : `Receive ${rows.length} router(s)`}
            </Button>
          </div>
        </section>
      )}
    </form>
  )
}

export function RouterFloatPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permissions = auth.access?.permissionKeys ?? []
  const canRead =
    permissions.includes('router_float.read') ||
    permissions.includes('inventory.issue') ||
    permissions.includes('inventory.receipt')
  const canIssue = permissions.includes('inventory.issue')
  const canReceive = permissions.includes('inventory.receipt')

  const [tab, setTab] = useState<PageTab>('float')

  const warehousesQuery = useQuery({
    queryKey: ['warehouse', 'router-float', 'warehouses', scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => readActiveWarehouses(scope, signal),
    enabled: scope.isAuthReady && Boolean(scope.identityKey) && (canIssue || canReceive),
    retry: false,
  })

  const categoriesQuery = useQuery({
    queryKey: ['warehouse', 'router-float', 'categories', scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => readCategoryOptions(scope, signal),
    enabled: scope.isAuthReady && Boolean(scope.identityKey) && canReceive,
    retry: false,
  })

  if (!scope.isAuthReady || !scope.identityKey) return null
  if (!canRead) {
    return (
      <EmptyState
        title="Router float access required"
        description="You need warehouse or service coordination permissions to inspect router floats."
        icon={<ShieldAlert className="h-6 w-6" />}
      />
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Inventory · Fixed Internet"
        title="Router Float & CPE Receiving"
        subtitle="Receive supplier router batches by serial/MAC, issue up to 5 routers per technician, and confirm faulty returns."
        actions={
          <div role="group" aria-label="Router workflow view" className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={tab === 'float' ? 'primary' : 'outline'}
              leftIcon={<Router className="h-4 w-4" />}
              onClick={() => setTab('float')}
            >
              Float &amp; Issuance
            </Button>
            {canReceive && (
              <Button
                type="button"
                size="sm"
                variant={tab === 'receive' ? 'primary' : 'outline'}
                leftIcon={<PackagePlus className="h-4 w-4" />}
                onClick={() => setTab('receive')}
              >
                Receive Router Delivery
              </Button>
            )}
          </div>
        }
      />

      {tab === 'float' ? (
        <FloatIssuancePanel
          scope={scope}
          canIssue={canIssue}
          warehouses={warehousesQuery.data ?? []}
        />
      ) : (
        <ReceiveRouterDeliveryPanel
          scope={scope}
          warehouses={warehousesQuery.data ?? []}
          categories={categoriesQuery.data ?? []}
          onDone={() => setTab('float')}
        />
      )}
    </main>
  )
}
