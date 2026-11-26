import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Textarea } from '@/components/ui/Input'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatLocalDateLabel, getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { employeeEquipmentApi, employeeEquipmentPageSize, type EmployeeEquipmentRequest } from './api'

const field = 'flex flex-col gap-1.5 text-sm font-medium text-ink'
const select = 'h-10 rounded-lg border border-line bg-surface px-3'
const panel = 'space-y-3 rounded-xl border border-line bg-surface p-4'
const statusDetails: Record<EmployeeEquipmentRequest['status'], { label: string; tone: StatusPillProps['tone'] }> = {
  pending: { label: 'Awaiting warehouse review', tone: 'warning' },
  needs_information: { label: 'Needs information', tone: 'warning' },
  awaiting_approval: { label: 'Stock approval pending', tone: 'warning' },
  approved: { label: 'Approved for issue', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  fulfilled: { label: 'Issued', tone: 'info' },
  returned: { label: 'Returned', tone: 'success' },
  transferred: { label: 'Transferred', tone: 'neutral' },
}

function formText(body: FormData, name: string) {
  const value = body.get(name)
  return typeof value === 'string' ? value : ''
}

type EditAction =
  | { kind: 'submit'; request?: EmployeeEquipmentRequest }
  | { kind: 'cancel' | 'prepare' | 'needs_information' | 'rejected'; request: EmployeeEquipmentRequest }

function EquipmentActionDialog({ action, scope, onClose, onSaved }: {
  action: EditAction
  scope: IdentityScopeRef
  onClose: () => void
  onSaved: (stockId?: string) => void
}) {
  const request = action.request
  const [newId] = useState(() => request?.id ?? crypto.randomUUID())
  const [attachments, setAttachments] = useState(request?.attachments ?? [])
  const [toolSearch, setToolSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [dirty, setDirty] = useState(false)
  const api = employeeEquipmentApi(scope)
  const equipment = useQuery({
    enabled: action.kind === 'prepare',
    queryKey: ['warehouse', 'employee-equipment-choices', scope.identityKey, scope.authEpoch, appliedSearch],
    queryFn: ({ signal }) => api.choices(appliedSearch, signal),
  })

  const mutation = useMutation({
    mutationFn: async (body: FormData) => {
      if (action.kind === 'submit') {
        const files = body.getAll('evidence').filter((file): file is File => file instanceof File && Boolean(file.name))
        await api.save(newId, action.request?.version ?? null, {
          category: formText(body, 'category'),
          description: formText(body, 'description'),
          business_reason: formText(body, 'businessReason'),
          urgency: body.get('urgency') === 'urgent' ? 'urgent' : 'normal',
        }, attachments, files)
        return undefined
      }
      if (action.kind === 'prepare') {
        return api.prepare(action.request, formText(body, 'equipment'), formText(body, 'returnBy'))
      }
      if (action.kind === 'cancel') await api.cancel(action.request)
      else await api.review(action.request, action.kind, formText(body, 'note'))
      return undefined
    },
    onSuccess: onSaved,
  })

  const title = action.kind === 'submit' ? (request ? 'Resubmit equipment request' : 'New equipment request')
    : action.kind === 'prepare' ? 'Prepare stock request'
    : action.kind === 'needs_information' ? 'Request more information'
    : action.kind === 'rejected' ? 'Reject equipment request' : 'Cancel equipment request'
  const description = action.kind === 'submit' ? 'Tell the warehouse what you need for your work.'
    : action.kind === 'prepare' ? 'Choose one available tool. The warehouse approval rules still apply.'
    : action.kind === 'cancel' ? 'Do you want to cancel this request?' : 'Your note will be visible to the employee.'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutation.isPending) mutation.mutate(new FormData(event.currentTarget))
  }

  return <Dialog open title={title} description={description} hasUnsavedChanges={dirty && !mutation.isPending}
    onOpenChange={(open) => { if (!open && !mutation.isPending) onClose() }}>
    <form className="space-y-4" onSubmit={submit} onChange={() => setDirty(true)}>
      <fieldset className="space-y-3" disabled={mutation.isPending}>
        {action.kind === 'submit' && <>
          <label className={field}>Category<Input name="category" defaultValue={request?.category} required minLength={2} maxLength={100} /></label>
          <label className={field}>Equipment needed<Textarea name="description" defaultValue={request?.description} required minLength={3} maxLength={500} /></label>
          <label className={field}>Business reason<Textarea name="businessReason" defaultValue={request?.business_reason} required minLength={3} maxLength={1000} /></label>
          <label className={field}>Urgency<select name="urgency" defaultValue={request?.urgency ?? 'normal'} className={select}>
            <option value="normal">Normal</option><option value="urgent">Urgent</option>
          </select></label>
          {attachments.map((file) => <div key={file.storage_path} className="flex items-center justify-between gap-2 text-sm">
            <span className="break-all">{file.original_file_name}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => {
              setAttachments((current) => current.filter((item) => item !== file))
              setDirty(true)
            }}>Remove</Button>
          </div>)}
          <label className={field}>Attachments
            <Input name="evidence" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={attachments.length >= 5} />
          </label>
          <p className="text-sm text-muted">Up to five PDF or image files, 10 MB each.</p>
        </>}
        {action.kind === 'prepare' && <>
          <div className="flex items-end gap-2">
            <label className={field + ' flex-1'}>Find by serial
              <Input type="search" value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} />
            </label>
            <Button type="button" variant="outline" disabled={equipment.isFetching}
              onClick={() => setAppliedSearch(toolSearch.trim())}>Find</Button>
          </div>
          {equipment.error && <p role="alert" className="text-sm text-soft">{equipment.error.message}</p>}
          <label className={field}>Available equipment
            <select name="equipment" className={select} required key={appliedSearch} defaultValue=""
              disabled={equipment.isFetching || !equipment.data?.length}>
              <option value="">{equipment.isFetching ? 'Loading…' : equipment.data?.length ? 'Select equipment' : 'No matching equipment'}</option>
              {equipment.data?.map((item) => <option key={item.id} value={item.id}>{item.serial_number} · {item.model_name}</option>)}
            </select>
          </label>
          <label className={field}>Expected return date
            <Input name="returnBy" type="date" required min={getTodayIsoInZone('Africa/Kampala')}
              defaultValue={request?.expected_return_date ?? undefined} />
          </label>
        </>}
        {(action.kind === 'needs_information' || action.kind === 'rejected') && (
          <label className={field}>Review note<Textarea name="note" required minLength={3} maxLength={500} /></label>
        )}
      </fieldset>
      {mutation.error && <p role="alert" className="text-sm text-soft">{mutation.error.message}</p>}
      <Button type="submit" loading={mutation.isPending}
        disabled={action.kind === 'prepare' && (equipment.isFetching || !equipment.data?.length)}>
        {action.kind === 'submit' ? 'Submit request' : title}
      </Button>
    </form>
  </Dialog>
}

export default function EmployeeEquipmentPage({ manage = false }: { manage?: boolean }) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  return <EmployeeEquipmentWorkspace key={[scope.identityKey, scope.authEpoch, manage].join(':')}
    manage={manage} scope={scope} canPrepare={auth.access?.permissionKeys.includes('inventory.issue') ?? false} />
}

function EmployeeEquipmentWorkspace({ manage, scope, canPrepare }: {
  manage: boolean; scope: IdentityScopeRef; canPrepare: boolean
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestId = manage ? params.get('request') : null
  const [offset, setOffset] = useState(0)
  const [action, setAction] = useState<EditAction>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const api = employeeEquipmentApi(scope)
  const query = useQuery({
    enabled: scope.isAuthReady,
    queryKey: ['employee-equipment', scope.identityKey, scope.authEpoch, manage, offset, requestId],
    queryFn: async ({ signal }) => {
      if (!requestId) return api.list(manage, offset, signal)
      for (let start = 0; ; start += employeeEquipmentPageSize) {
        signal.throwIfAborted()
        const page = await api.list(manage, start, signal)
        const selected = page.requests.find((row) => row.id === requestId)
        if (selected || page.requests.length === 0 || start + employeeEquipmentPageSize >= page.total) {
          return { ...page, requests: selected ? [selected] : [], total: selected ? 1 : 0 }
        }
      }
    },
  })

  function saved(stockId?: string) {
    void queryClient.invalidateQueries({ queryKey: ['employee-equipment'] })
    void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
    setAction(undefined)
    setNotice('Equipment request updated.')
    if (stockId) void navigate('/inventory/requests/' + stockId)
  }

  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
    <PageHeader title={manage ? 'Employee equipment requests' : 'My Equipment'}
      eyebrow={manage ? 'Inventory' : 'My Workspace'}
      subtitle={manage ? 'Review staff requests and prepare them for warehouse approval.' : 'Request a tool or check what is issued to you.'}
      actions={!manage && query.data?.linked ? <Button onClick={() => setAction({ kind: 'submit' })}>New equipment request</Button> : undefined} />
    {requestId && <Link className="text-sm font-medium text-emerald-600 hover:underline" to="/inventory/employee-requests">All employee equipment requests</Link>}
    {notice && <p role="status" className="text-sm text-soft">{notice}</p>}
    {error && <p role="alert" className="text-sm text-soft">{error}</p>}
    {query.isPending && <p role="status" className="text-sm text-muted">Loading equipment requests…</p>}
    {query.error && <div className={panel} role="alert">
      <p>{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button>
    </div>}
    {!manage && query.data && !query.data.linked && <p className={panel}>Ask HR to link your account to your employee record.</p>}
    {!manage && query.data?.linked && <section className={panel} aria-label="Assigned equipment">
      <h2 className="font-semibold text-ink">Assigned equipment</h2>
      {query.data.issued.length ? <ul className="divide-y divide-line">
        {query.data.issued.map((item) => <li key={item.id} className="py-2 text-sm">
          <p className="font-medium">{item.model_name}</p>
          <p className="text-soft">{item.serial_number}{item.expected_return_date && ' · Return by ' + formatLocalDateLabel(item.expected_return_date)}</p>
        </li>)}
      </ul> : <p className="text-sm text-muted">You have no equipment on issue.</p>}
    </section>}
    {query.data && (manage || query.data.linked) && <section className="space-y-3" aria-label="Equipment requests">
      {!query.data.requests.length && <p className={panel}>{requestId ? 'This equipment request is unavailable.' : 'No equipment requests on this page.'}</p>}
      {query.data.requests.map((request) => {
        const status = statusDetails[request.status]
        const canReview = manage && !request.own_request && ['pending', 'awaiting_approval'].includes(request.status)
        const canChangeSelection = manage && canPrepare && !request.own_request
          && ['pending', 'awaiting_approval', 'approved'].includes(request.status)
        return <article key={request.id} className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="break-words font-semibold text-ink">{request.description}</h2>
              <p className="text-sm text-muted">{[request.employee_name, request.category, request.urgency === 'urgent' ? 'Urgent' : null].filter(Boolean).join(' · ')}</p>
            </div>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-soft">{request.business_reason}</p>
          {request.review_note && <p className="whitespace-pre-wrap break-words text-sm"><strong>Review note </strong>{request.review_note}</p>}
          {!!request.attachments.length && <ul className="space-y-1">
            {request.attachments.map((file) => <li key={file.storage_path}>
              <button type="button" className="break-all text-left text-sm text-emerald-600 underline"
                onClick={() => {
                  setError('')
                  void api.openAttachment(request.id, file).catch((issue: Error) => setError(issue.message))
                }}>{file.original_file_name}</button>
            </li>)}
          </ul>}
          <div className="flex flex-wrap items-center gap-2">
            {request.stock_request_id && <Link className="text-sm font-medium text-emerald-600 underline"
              to={'/inventory/requests/' + request.stock_request_id}>Open stock request</Link>}
            {canChangeSelection && <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'prepare', request })}>
              {request.stock_request_id ? 'Change equipment selection' : 'Prepare stock request'}
            </Button>}
            {canReview && <>
              <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'needs_information', request })}>Request information</Button>
              <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'rejected', request })}>Reject request</Button>
            </>}
            {!manage && request.status === 'needs_information' && <Button size="sm" variant="outline"
              onClick={() => setAction({ kind: 'submit', request })}>Resubmit</Button>}
            {!manage && ['pending', 'needs_information'].includes(request.status) && <Button size="sm" variant="outline"
              onClick={() => setAction({ kind: 'cancel', request })}>Cancel request</Button>}
          </div>
        </article>
      })}
      {(offset > 0 || offset + employeeEquipmentPageSize < query.data.total) && <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(offset - employeeEquipmentPageSize)}>Previous</Button>
        <Button variant="outline" disabled={offset + employeeEquipmentPageSize >= query.data.total}
          onClick={() => setOffset(offset + employeeEquipmentPageSize)}>Next</Button>
      </div>}
    </section>}
    {scope.isAuthReady && action && <EquipmentActionDialog key={action.kind + (action.request?.id ?? 'new')}
      action={action} scope={scope} onClose={() => setAction(undefined)} onSaved={saved} />}
  </main>
}
