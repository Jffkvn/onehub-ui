import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Package, Plus, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'
import { stockRequestsApi, type StockCommand, type StockLine, type StockRequest, type StockRequestInput } from './requestApi'

const requestPath = '/inventory/requests'
const card = 'rounded-lg border border-line bg-surface p-4 sm:p-5'
const selectStyle = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-emerald'
const fieldStyle = 'block min-w-0 space-y-1 text-sm font-medium text-ink'
const statuses = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_approval: { label: 'Pending approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  fulfilled: { label: 'Fulfilled', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
} as const
const dateFormat = new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeZone: 'Africa/Kampala' })
const moneyFormat = new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 })

function useWarehouseAccess() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permissions = auth.access?.permissionKeys ?? []
  const canRead = scope.isAuthReady && Boolean(scope.identityKey)
    && ['inventory.approve', 'inventory.issue', 'inventory.request'].some((key) => permissions.includes(key))
  const roles = auth.access?.roleKeys ?? []
  return {
    scope,
    canRead,
    canRequest: permissions.includes('inventory.request'),
    canApprove: permissions.includes('inventory.approve'),
    canIssue: permissions.includes('inventory.issue'),
    assignedProjectsOnly: roles.includes('coordinator') || roles.includes('project_manager'),
  }
}

function requestKey(scope: IdentityScopeRef) {
  return ['warehouse', scope.identityKey, scope.authEpoch, 'stock-requests'] as const
}

function RetryNotice({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className={card + ' flex items-center justify-between gap-3'}>
      <FieldError>{text}</FieldError>
      <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
    </div>
  )
}

function RequestStatus({ request }: { request: StockRequest }) {
  const { label, tone } = statuses[request.status]
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusPill tone={tone}>{label}</StatusPill>
      {request.escalated_to_cfo && request.status === 'pending_approval' && <StatusPill tone="warning">CFO approval required</StatusPill>}
    </span>
  )
}

type DraftLine = { label: string; payload: StockRequestInput }

function RequestComposer({ scope, assignedProjectsOnly, initialProject, onClose }: {
  scope: IdentityScopeRef
  assignedProjectsOnly: boolean
  initialProject: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const api = stockRequestsApi(scope)
  const formId = useId()
  const [projectId, setProjectId] = useState(initialProject)
  const [kind, setKind] = useState<'consumable' | 'equipment'>('consumable')
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [returnDate, setReturnDate] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [issue, setIssue] = useState('')
  const today = getTodayIsoInZone('Africa/Kampala')

  const choices = useQuery({
    queryKey: [...requestKey(scope), 'choices', assignedProjectsOnly],
    queryFn: () => api.choices(assignedProjectsOnly),
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: () => api.create(projectId, lines.map(({ payload }) => payload)),
    onSuccess(id) {
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      void navigate(requestPath + '/' + id)
    },
    onError() {
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
    },
  })
  const options = (
    kind === 'equipment'
      ? (choices.data?.equipment ?? []).map((row) => ({
        id: row.id,
        label: row.model_name + ' · ' + row.serial_number + (row.is_sensitive ? ' · Sensitive' : ''),
      }))
      : (choices.data?.consumables ?? []).map((row) => ({ id: row.id, label: row.name + ' · ' + row.sku }))
  ).filter(({ id }) => !lines.some(({ payload }) => payload.consumable_item_id === id || payload.equipment_asset_id === id))
  const selectedProject = choices.data?.projects.some(({ id }) => id === projectId) ? projectId : ''

  function addItem() {
    mutation.reset()
    setIssue('')
    const selected = options.find(({ id }) => id === itemId)
    if (!selected) return
    const count = kind === 'equipment' ? 1 : Number(quantity)
    if (!Number.isInteger(count) || count < 1 || count > 2147483647) {
      setIssue('Enter a positive whole quantity.')
      return
    }
    if (kind === 'equipment' && returnDate && (!z.string().date().safeParse(returnDate).success || returnDate < today)) {
      setIssue('Choose a return date of today or later.')
      return
    }
    setLines((existing) => [...existing, {
      label: selected.label,
      payload: {
        consumable_item_id: kind === 'consumable' ? selected.id : null,
        equipment_asset_id: kind === 'equipment' ? selected.id : null,
        quantity: count,
        expected_return_date: kind === 'equipment' ? returnDate || null : null,
      },
    }])
    setItemId('')
    setQuantity('1')
    setReturnDate('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedProject && lines.length && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog open title="New stock request" description="Choose a project and add the stock or serialized equipment it needs."
      onOpenChange={(open) => { if (!open && !mutation.isPending) onClose() }}
      hasUnsavedChanges={!mutation.isPending && (lines.length > 0 || Boolean(projectId && projectId !== initialProject))}
      footer={<Button type="submit" form={formId} disabled={!selectedProject || !lines.length || mutation.isPending}>
        {mutation.isPending ? 'Submitting…' : 'Submit request'}
      </Button>}>
      {choices.isPending && <p role="status" className="text-sm text-muted">Loading project and stock options…</p>}
      {choices.isError && <RetryNotice text="Could not load project and stock options." retry={() => { void choices.refetch() }} />}
      {choices.isSuccess && choices.data.projects.length === 0 && (
        <p className="text-sm text-muted">No eligible projects are available for this account.</p>
      )}
      {choices.isSuccess && choices.data.projects.length > 0 && (
        <form id={formId} onSubmit={submit} className="space-y-4">
          <label className={fieldStyle}>
            <span>Project</span>
            <select className={selectStyle} value={selectedProject} required onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Choose a project</option>
              {choices.data.projects.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <fieldset disabled={mutation.isPending} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
            <label className={fieldStyle}>
              <span>Item type</span>
              <select className={selectStyle} value={kind} onChange={(event) => {
                setKind(event.target.value === 'equipment' ? 'equipment' : 'consumable')
                setItemId('')
                setIssue('')
              }}>
                <option value="consumable">Consumable</option>
                <option value="equipment">Equipment</option>
              </select>
            </label>
            <label className={fieldStyle}>
              <span>Item</span>
              <select className={selectStyle} value={itemId} onChange={(event) => setItemId(event.target.value)}>
                <option value="">{options.length ? 'Choose an item' : 'No more items available'}</option>
                {options.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            {kind === 'equipment' ? (
              <label className={fieldStyle}>
                <span>Expected return date</span>
                <Input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} />
              </label>
            ) : (
              <label className={fieldStyle}>
                <span>Quantity</span>
                <Input type="number" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              </label>
            )}
            <Button type="button" variant="outline" className="self-end justify-self-start" disabled={!itemId} onClick={addItem}>Add item</Button>
            {issue && <FieldError className="sm:col-span-2">{issue}</FieldError>}
          </fieldset>
          {lines.length > 0 && (
            <ul className="divide-y divide-line rounded-md border border-line">
              {lines.map(({ label, payload }) => {
                const id = payload.equipment_asset_id ?? payload.consumable_item_id
                return (
                  <li key={id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-ink">{payload.quantity} × {label}</p>
                      {payload.expected_return_date && <p className="text-xs text-muted">Return by {payload.expected_return_date}</p>}
                    </div>
                    <Button type="button" size="sm" variant="ghost" aria-label={'Remove ' + label} disabled={mutation.isPending}
                      onClick={() => setLines((existing) => existing.filter((line) => line.payload !== payload))}>
                      <Trash2 size={16} />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {mutation.isError && !isAbortError(mutation.error) && <FieldError>{mutation.error.message}</FieldError>}
        </form>
      )}
    </Dialog>
  )
}

function RequestQueue({ scope, canRequest, assignedProjectsOnly }: {
  scope: IdentityScopeRef
  canRequest: boolean
  assignedProjectsOnly: boolean
}) {
  const [search] = useSearchParams()
  const [searchText, setSearchText] = useState('')
  const initialStatus = search.get('status') ?? ''
  const [filter, setFilter] = useState(Object.hasOwn(statuses, initialStatus) ? initialStatus : '')
  const [compose, setCompose] = useState(false)
  const initialProject = search.get('project') ?? ''
  const query = useQuery({
    queryKey: [...requestKey(scope), 'queue'],
    queryFn: () => stockRequestsApi(scope).list(),
    retry: false,
  })
  const needle = searchText.trim().toLowerCase()
  const visible = (query.data ?? []).filter((request) =>
    (!filter || request.status === filter) && [request.project_name, request.requester_name].some((part) => part?.toLowerCase().includes(needle)),
  )
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Stock requests" actions={canRequest && (
        <Button leftIcon={<Plus size={16} />} onClick={() => setCompose(true)}>New stock request</Button>
      )} />
      <div className={card + ' grid gap-3 sm:grid-cols-2'}>
        <label className={fieldStyle}>
          <span>Find a request</span>
          <Input type="search" value={searchText} placeholder="Project or requester" onChange={(event) => setSearchText(event.target.value)} />
        </label>
        <label className={fieldStyle}>
          <span>Status</span>
          <select className={selectStyle} value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(statuses).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      {query.isPending && <Skeleton shape="row" className="h-32" />}
      {query.isError && <RetryNotice text="Could not load stock requests." retry={() => { void query.refetch() }} />}
      {query.isSuccess && (visible.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((request) => (
            <li key={request.id}>
              <Link to={requestPath + '/' + request.id} className={card + ' flex items-start gap-3 transition-colors hover:border-emerald/50 focus-visible:outline-emerald'}>
                <Package className="mt-0.5 shrink-0 text-emerald-600" size={19} aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-2">
                  <h2 className="break-words font-display font-semibold text-ink">{request.project_name}</h2>
                  <RequestStatus request={request} />
                  <p className="text-xs text-muted">
                    {request.requester_name ?? 'Requester unavailable'} · {dateFormat.format(new Date(request.created_at))}
                  </p>
                </div>
                <ArrowRight size={17} className="shrink-0 text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={card + ' text-sm text-muted'}>{filter || needle ? 'No requests match these filters.' : 'No stock requests yet.'}</p>)}
      {compose && canRequest && <RequestComposer scope={scope} assignedProjectsOnly={assignedProjectsOnly} initialProject={initialProject}
        onClose={() => setCompose(false)} />}
    </main>
  )
}

function lineName(item: StockLine) {
  return item.consumable_items?.name ?? item.equipment_assets?.model_name ?? 'Stock item'
}

function RequestDetail({ scope, id, canApprove, canIssue }: {
  scope: IdentityScopeRef
  id: string
  canApprove: boolean
  canIssue: boolean
}) {
  const api = stockRequestsApi(scope)
  const queryClient = useQueryClient()
  const [warehouseId, setWarehouseId] = useState('')
  const [condition, setCondition] = useState('')
  const key = [...requestKey(scope), id]
  const validId = z.string().uuid().safeParse(id).success
  const requestQuery = useQuery({ queryKey: key, queryFn: async () => (await api.list(id))[0] ?? null, enabled: validId, retry: false })
  const request = requestQuery.data
  const items = useQuery({ queryKey: [...key, 'items'], queryFn: () => api.lines(id), enabled: Boolean(request), retry: false })
  const canFulfill = canIssue && request?.status === 'approved'
  const warehouses = useQuery({
    queryKey: [...requestKey(scope), 'warehouses'], queryFn: () => api.warehouses(), enabled: canFulfill, retry: false,
  })
  const mutation = useMutation({
    mutationFn: (command: StockCommand) => api.act(command),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['warehouse'] }),
  })
  const actionableApproval = request?.status === 'pending_approval' && items.isSuccess && items.data.length > 0
    && (canApprove || (canIssue && !request.escalated_to_cfo))
  const actionableEscalation = request?.status === 'pending_approval' && !request.escalated_to_cfo && (canIssue || canApprove)
  const remaining = (items.data ?? []).some((row) => row.quantity_issued < row.quantity)
  const canSendIssue = Boolean(canFulfill && warehouses.data?.some(({ id: optionId }) => optionId === warehouseId) && !mutation.isPending)

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
      <Link to={requestPath} className="inline-flex items-center gap-2 text-sm text-soft hover:text-ink">
        <ArrowLeft size={16} aria-hidden="true" /> Stock requests
      </Link>
      {validId && requestQuery.isPending && <Skeleton shape="row" className="h-32" />}
      {requestQuery.isError && <RetryNotice text="Could not load this stock request." retry={() => { void requestQuery.refetch() }} />}
      {(!validId || (requestQuery.isSuccess && !request)) && <p className={card}>Stock request unavailable</p>}
      {request && (
        <>
          <PageHeader title={request.project_name} eyebrow="Stock request" />
          <div className={card + ' flex flex-wrap items-center justify-between gap-4'}>
            <div className="space-y-2">
              <RequestStatus request={request} />
              <p className="text-sm text-muted">{request.requester_name ?? 'Requester unavailable'}{request.requester_role && ' · ' + request.requester_role}</p>
            </div>
            <div className="text-sm text-soft">Estimated value <strong className="block text-ink">{moneyFormat.format(request.total_estimated_value)}</strong></div>
          </div>

          {(actionableApproval || actionableEscalation || (canFulfill && remaining && items.isSuccess)) && (
            <section aria-label="Request actions" className={card + ' space-y-3'}>
              <h2 className="font-display font-semibold text-ink">Request actions</h2>
              <div className="flex flex-wrap gap-2">
                {actionableApproval && (
                  <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: 'approve', requestId: id })}>Approve request</Button>
                )}
                {actionableEscalation && (
                  <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ kind: 'escalate', requestId: id })}>Send to CFO</Button>
                )}
              </div>
              {canFulfill && remaining && items.isSuccess && (
                <>
                  {warehouses.isPending && <p role="status" className="text-sm text-muted">Loading warehouses…</p>}
                  {warehouses.isError && <RetryNotice text="Could not load warehouses." retry={() => { void warehouses.refetch() }} />}
                  {warehouses.isSuccess && (
                    <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <label className={fieldStyle}>
                        <span>Issue from warehouse</span>
                        <select className={selectStyle} value={warehouseId} disabled={mutation.isPending}
                          onChange={(event) => setWarehouseId(event.target.value)}>
                          <option value="">{warehouses.data.length ? 'Choose a warehouse' : 'No active warehouses'}</option>
                          {warehouses.data.map(({ id: warehouse, name }) => <option key={warehouse} value={warehouse}>{name}</option>)}
                        </select>
                      </label>
                      <label className={fieldStyle}>
                        <span>Issue condition</span>
                        <Input placeholder="Required when issuing one line" maxLength={500} value={condition} disabled={mutation.isPending}
                          onChange={(event) => setCondition(event.target.value)} />
                      </label>
                      <Button disabled={!canSendIssue} onClick={() => mutation.mutate({ kind: 'issue-all', requestId: id, warehouseId })}>Issue remaining items</Button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {mutation.isPending && <p role="status" className="text-sm text-muted">Saving request…</p>}
          {mutation.isSuccess && <p role="status" className="text-sm text-emerald-600">Request updated.</p>}
          {mutation.isError && !isAbortError(mutation.error) && <FieldError>{mutation.error.message}</FieldError>}
          <section aria-label="Requested items" className={card + ' space-y-3'}>
            <h2 className="font-display font-semibold text-ink">Requested items</h2>
            {items.isPending && <Skeleton shape="row" className="h-20" />}
            {items.isError && <RetryNotice text="Could not load request items." retry={() => { void items.refetch() }} />}
            {items.isSuccess && (
              items.data.length ? <ul className="divide-y divide-line">
                {items.data.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-ink">{lineName(item)}</p>
                      <p className="text-xs text-muted">
                        {item.consumable_items?.sku ?? item.equipment_assets?.serial_number ?? '—'}
                        {' · '}{item.quantity_issued} of {item.quantity} issued
                        {item.consumable_items?.unit_of_measure ? ' · ' + item.consumable_items.unit_of_measure : ''}
                      </p>
                      {item.expected_return_date && <p className="mt-1 text-xs text-muted">Return by {item.expected_return_date}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-soft">{moneyFormat.format(item.quantity * item.estimated_unit_price)}</span>
                      {canFulfill && item.quantity_issued < item.quantity && (
                        <Button size="sm" variant="outline" disabled={!canSendIssue || !condition.trim()}
                          onClick={() => mutation.mutate({ kind: 'issue-line', lineId: item.id, warehouseId, condition: condition.trim() })}>
                          Issue {lineName(item)}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul> : <p className="text-sm text-muted">No items were found for this request.</p>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export function WarehouseRequestsPage() {
  const access = useWarehouseAccess()
  if (!access.canRead) return <ForbiddenPage />
  return <RequestQueue key={access.scope.identityKey + ':' + access.scope.authEpoch} {...access} />
}

export function WarehouseRequestDetailPage() {
  const { requestId = '' } = useParams()
  const access = useWarehouseAccess()
  if (!access.canRead) return <ForbiddenPage />
  return <RequestDetail key={JSON.stringify([access.scope.identityKey, access.scope.authEpoch, requestId])} {...access} id={requestId} />
}
