import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, ChevronRight, Download, FileText, Plus, Search } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { FieldError, Input } from '@/components/ui/Input'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'

import {
  attachUploadedCertificate,
  listTrainingCertificates,
  listTrainingEmployees,
  listTrainingRecords,
  openTrainingCertificate,
  pinTrainingSession,
  refreshTrainingExpiryAlerts,
  removeTrainingCertificate,
  saveTrainingRecord,
  trainingKey,
  uploadTrainingCertificate,
  TrainingInputError,
  type TrainingFields,
  type TrainingRecord,
  type UploadedCertificate,
} from './api'

const card = 'rounded-xl border border-line bg-surface p-4 sm:p-5'
const select = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink'
const formatDate = new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeZone: 'UTC' })
const formatCurrency = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 })
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Kampala' }).format(new Date())
const statuses: Record<TrainingRecord['status'], { label: string; tone: StatusPillProps['tone'] }> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  attended: { label: 'Attended', tone: 'neutral' },
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
}

function expiryWindow() {
  const date = new Date(today() + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + 60)
  return date.toISOString().slice(0, 10)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium text-ink">{label}{children}</label>
}

function fieldValue(form: FormData, name: string) {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function TrainingForm({ scope, record, onSaved, onCancel }: {
  scope: IdentityScopeRef
  record?: TrainingRecord
  onSaved: (ids: string[]) => Promise<void>
  onCancel: () => void
}) {
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false)
  const sending = useRef(false)
  const employees = useQuery({
    queryKey: [...trainingKey(scope, true), 'employees'],
    enabled: scope.isAuthReady && !record,
    queryFn: () => listTrainingEmployees(scope),
  })
  const save = useMutation({
    mutationFn: (fields: TrainingFields) => saveTrainingRecord(scope, fields,
      record ? { recordId: record.id } : { employeeIds }),
    retry: false,
  })
  const shown = employees.data?.filter((employee) =>
    `${employee.legal_name} ${employee.employee_number}`.toLowerCase().includes(query.toLowerCase().trim()))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current || saveUnconfirmed) return
    if (!record && employeeIds.length === 0) {
      setError('Select at least one employee.')
      return
    }
    const form = new FormData(event.currentTarget)
    const hours = fieldValue(form, 'duration')
    const cost = fieldValue(form, 'cost')
    sending.current = true
    setError('')
    try {
      const ids = await save.mutateAsync({
        topic: fieldValue(form, 'topic'),
        provider: fieldValue(form, 'provider'),
        completion_date: fieldValue(form, 'date'),
        duration_hours: hours ? Number(hours) : null,
        cost_ugx: cost ? Number(cost) : null,
        status: fieldValue(form, 'status') as TrainingRecord['status'],
        expiry_date: fieldValue(form, 'expiry') || null,
        certificate_reference: fieldValue(form, 'reference'),
      })
      await onSaved(ids)
    } catch (err) {
      if (err instanceof TrainingInputError) {
        setError(err.message)
      } else {
        setSaveUnconfirmed(true)
        setError('Saving could not be confirmed. Return to training history and check the record before submitting again.')
      }
    } finally {
      sending.current = false
    }
  }

  return (
    <section className={card}>
      <h2 className="mb-4 text-lg font-semibold text-ink">{record ? 'Edit training' : 'Log training'}</h2>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={save.isPending || saveUnconfirmed} className="grid gap-4 sm:grid-cols-2">
          <Field label="Topic or course"><Input name="topic" required minLength={2} maxLength={200} defaultValue={record?.topic} /></Field>
          <Field label="Provider"><Input name="provider" maxLength={200} defaultValue={record?.provider ?? ''} /></Field>
          <Field label="Training date"><Input name="date" type="date" required defaultValue={record?.completion_date ?? today()} /></Field>
          <Field label="Status">
            <select name="status" className={select} defaultValue={record?.status ?? 'passed'}>
              {Object.entries(statuses).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
            </select>
          </Field>
          <Field label="Duration (hours)"><Input name="duration" type="number" min={0} max={10000} step="0.01" defaultValue={record?.duration_hours ?? ''} /></Field>
          <Field label="Cost per employee (UGX)"><Input name="cost" type="number" min={0} max={1_000_000_000} step="0.01" defaultValue={record?.cost_ugx ?? ''} /></Field>
          <Field label="Certificate reference"><Input name="reference" maxLength={160} defaultValue={record?.certificate_reference ?? ''} /></Field>
          <Field label="Certificate expiry"><Input name="expiry" type="date" defaultValue={record?.expiry_date ?? ''} /></Field>
        </fieldset>
        {!record && (
          <fieldset className="space-y-2" disabled={save.isPending || saveUnconfirmed}>
            <legend className="text-sm font-semibold text-ink">Employees ({employeeIds.length} selected)</legend>
            <Input aria-label="Find employees" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find by name or employee number" />
            {employees.isLoading && <p role="status" className="text-sm text-muted">Loading employees…</p>}
            {employees.isError && <FieldError>Employees could not be loaded.</FieldError>}
            {shown?.length === 0 && <p className="text-sm text-muted">No matching employees.</p>}
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {shown?.map((employee) => (
                <label key={employee.id} className="flex items-center gap-2 py-1 text-sm text-ink">
                  <input
                    type="checkbox" checked={employeeIds.includes(employee.id)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setEmployeeIds((current) => checked ? [...current, employee.id] : current.filter((id) => id !== employee.id))
                    }}
                  />
                  {employee.legal_name} · {employee.employee_number}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <FieldError>{error}</FieldError>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={saveUnconfirmed}>Save training</Button>
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>{saveUnconfirmed ? 'Back to training' : 'Cancel'}</Button>
        </div>
      </form>
    </section>
  )
}

function Certificates({ scope, record, manage }: {
  scope: IdentityScopeRef
  record: TrainingRecord
  manage: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const updating = useRef(false)
  const [pending, setPending] = useState<UploadedCertificate | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const client = useQueryClient()
  const key = trainingKey(scope, manage)
  const certificates = useQuery({
    queryKey: [...key, 'certificates', record.id],
    queryFn: () => listTrainingCertificates(scope, record.id),
  })
  const change = useMutation({
    retry: false,
    mutationFn: async (operation: 'attach' | 'remove') => {
      if (operation === 'remove' && removeId) {
        await removeTrainingCertificate(scope, removeId)
        setRemoveId(null)
        setNotice('Certificate removed.')
      } else if (operation === 'attach') {
        const { check } = pinTrainingSession(scope)
        const uploaded = pending ?? (file ? await uploadTrainingCertificate(scope, record.id, file) : null)
        check()
        if (!uploaded) throw new Error('Select a certificate file.')
        setPending(uploaded)
        await attachUploadedCertificate(scope, uploaded)
        check()
        setPending(null)
        setFile(null)
        if (input.current) input.current.value = ''
        setNotice('Certificate attached.')
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
  const open = useMutation({
    retry: false,
    mutationFn: (doc: NonNullable<typeof certificates.data>[number]) => openTrainingCertificate(scope, record.id, doc),
    onError: () => setError('The private certificate could not be opened.'),
  })
  async function update(operation: 'attach' | 'remove') {
    if (updating.current) return
    updating.current = true
    setError('')
    setNotice('')
    try {
      await change.mutateAsync(operation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The certificate could not be updated.')
    } finally {
      updating.current = false
    }
  }

  function cancelRetry() {
    if (updating.current) return
    setPending(null)
    setFile(null)
    if (input.current) input.current.value = ''
    setError('')
    setNotice('Attachment retry cancelled.')
    void certificates.refetch()
  }

  return (
    <section className={card}>
      <h3 className="font-semibold text-ink">Certificates</h3>
      {certificates.isLoading && <p role="status" className="mt-2 text-sm text-muted">Loading certificates…</p>}
      {certificates.isError && <FieldError>Certificates could not be loaded.</FieldError>}
      {certificates.data?.length === 0 && <p className="mt-2 text-sm text-muted">No certificate files.</p>}
      {certificates.data?.map((doc) => (
        <div key={doc.id} className="flex flex-wrap items-center gap-2 border-b border-line py-3">
          <FileText size={16} className="text-muted" />
          <span className="min-w-0 flex-1 break-all text-sm font-medium text-ink">{doc.original_file_name}</span>
          <Button
            type="button" size="sm" variant="outline" aria-label={`Open ${doc.original_file_name}`}
            leftIcon={<Download size={14} />} disabled={open.isPending}
            onClick={() => { setError(''); open.mutate(doc) }}
          >
            Open
          </Button>
          {manage && <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveId(doc.id)} disabled={change.isPending}>Remove</Button>}
          {removeId === doc.id && manage && (
            <div className="flex w-full flex-wrap items-center gap-2" role="group" aria-label="Confirm certificate removal">
              <span className="text-sm text-ink">Remove this certificate?</span>
              <Button type="button" variant="danger" size="sm" loading={change.isPending} onClick={() => void update('remove')}>Confirm removal</Button>
              <Button type="button" variant="ghost" size="sm" disabled={change.isPending} onClick={() => setRemoveId(null)}>Cancel</Button>
            </div>
          )}
        </div>
      ))}
      {manage && (
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault()
          if (!change.isPending) void update('attach')
        }}>
          <Field label="Certificate file">
            <Input
              ref={input}
              type="file" accept=".pdf,.jpeg,.jpg,.png,.webp,.heic,.heif,.avif"
              disabled={Boolean(pending) || change.isPending || !certificates.data || certificates.data.length >= 10}
              onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
            />
          </Field>
          <Button type="submit" loading={change.isPending} disabled={!file && !pending}>
            {pending ? 'Retry attachment' : 'Attach certificate'}
          </Button>
          {pending && (
            <Button type="button" variant="ghost" disabled={change.isPending} onClick={cancelRetry}>
              Cancel retry
            </Button>
          )}
          {certificates.data && certificates.data.length >= 10 && <p className="w-full text-xs text-muted">Maximum of 10 files reached.</p>}
        </form>
      )}
      <FieldError className="mt-2">{error}</FieldError>
      {notice && <p role="status" className="mt-2 text-sm text-soft">{notice}</p>}
    </section>
  )
}

function RecordSummary({ record, manage }: { record: TrainingRecord; manage: boolean }) {
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{record.topic}</h2>
        <StatusPill tone={statuses[record.status].tone}>{statuses[record.status].label}</StatusPill>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {[
          ...(manage ? [['Employee', `${record.employee_name} · ${record.employee_number}`]] : []),
          ['Provider', record.provider ?? '—'],
          ['Training date', formatDate.format(new Date(record.completion_date))],
          ['Duration', record.duration_hours == null ? '—' : `${record.duration_hours} h`],
          ...(manage ? [['Cost', record.cost_ugx == null ? '—' : 'UGX ' + formatCurrency.format(record.cost_ugx)]] : []),
          ['Certificate reference', record.certificate_reference ?? '—'],
          ['Certificate expiry', record.expiry_date ? formatDate.format(new Date(record.expiry_date)) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0"><dt className="text-muted">{label}</dt><dd className="break-words font-medium text-ink">{value}</dd></div>
        ))}
      </dl>
    </section>
  )
}

function TrainingWorkspace({ scope, manage }: { scope: IdentityScopeRef; manage: boolean }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<'create' | 'edit' | null>(null)
  const [notice, setNotice] = useState('')
  const [onlyExpiring, setOnlyExpiring] = useState(false)
  const client = useQueryClient()
  const key = trainingKey(scope, manage)
  const records = useQuery({
    queryKey: [...key, 'records'],
    queryFn: () => listTrainingRecords(scope, manage),
    enabled: scope.isAuthReady,
  })
  const selected = params.get('training')
  const current = records.data?.find((record) => record.id === selected)
  const expiringBy = expiryWindow()
  const rows = records.data?.filter((item) => (
    (!onlyExpiring || (item.expiry_date && item.expiry_date <= expiringBy))
    && [item.topic, item.provider, ...(manage ? [item.employee_name, item.employee_number] : [])]
      .some((value) => value?.toLowerCase().includes(query.toLowerCase().trim()))
  ))
  const refresh = useMutation({
    retry: false,
    mutationFn: () => refreshTrainingExpiryAlerts(scope),
    onSuccess: (count) => {
      setNotice(count === 0 ? 'No new expiry alerts.' : `${count} new expiry ${count === 1 ? 'alert' : 'alerts'}.`)
      return client.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  function selectRecord(id?: string) {
    setForm(null)
    setNotice('')
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (id) next.set('training', id)
      else next.delete('training')
      return next
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader title={manage ? 'Training and Certifications' : 'My Training'} actions={manage && !selected && !form && <>
        <Button type="button" variant="outline" loading={refresh.isPending} onClick={() => { setNotice(''); refresh.mutate() }}>
          Refresh expiry alerts
        </Button>
        <Button type="button" leftIcon={<Plus size={16} />} onClick={() => { setNotice(''); setForm('create') }}>Log training</Button>
      </>} />
      {refresh.isError && <FieldError>Expiry alerts could not be refreshed.</FieldError>}
      {notice && <p role="status" className="text-sm text-soft">{notice}</p>}
      {records.isError && <FieldError>Training records could not be loaded. <Button type="button" size="sm" variant="ghost" onClick={() => void records.refetch()}>Retry</Button></FieldError>}
      {records.isLoading && <p role="status" className="text-sm text-muted">Loading training records…</p>}
      {selected && <Button type="button" variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={() => selectRecord()}>Back to training</Button>}
      {(manage && (form === 'create' || (form === 'edit' && current))) && (
        <TrainingForm
          key={form === 'edit' ? current?.id : 'new'}
          scope={scope} record={form === 'edit' ? current : undefined}
          onSaved={async (ids) => {
            const editing = form === 'edit'
            await Promise.all([
              client.invalidateQueries({ queryKey: ['training', scope.identityKey, scope.authEpoch] }),
              client.invalidateQueries({ queryKey: ['notifications'] }),
            ])
            setForm(null)
            setNotice(editing ? 'Training updated.' : `Training logged for ${ids.length} ${ids.length === 1 ? 'employee' : 'employees'}.`)
          }}
          onCancel={() => { setForm(null); void records.refetch() }}
        />
      )}
      {selected && !records.isError && records.isSuccess && (
        current
          ? form !== 'edit' && <>
              <RecordSummary record={current} manage={manage} />
              {manage && <Button type="button" variant="outline" onClick={() => { setNotice(''); setForm('edit') }}>Edit training</Button>}
              <Certificates key={current.id} scope={scope} record={current} manage={manage} />
            </>
          : <p className={card}>This training record is unavailable.</p>
      )}
      {!selected && !form && records.isSuccess && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input aria-label="Search training" placeholder={manage ? 'Search employee, course or provider' : 'Search course or provider'} value={query} onChange={(event) => setQuery(event.target.value)} leftIcon={<Search size={16} />} />
            {manage && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={onlyExpiring} onChange={(event) => setOnlyExpiring(event.target.checked)} />Expired or expiring within 60 days</label>}
          </div>
          {rows?.length === 0 && <p className={card}>{records.data.length > 0 ? 'No training records match your search.' : 'No training records yet.'}</p>}
          <ul className="space-y-2">
            {rows?.map((record) => (
              <li key={record.id}>
                <button type="button" onClick={() => selectRecord(record.id)} className={card + ' flex w-full items-center gap-3 text-left hover:bg-canvas focus-visible:outline-emerald'}>
                  <BookOpen size={18} className="shrink-0 text-muted" />
                  <span className="min-w-0 grow">
                    <span className="block break-words font-semibold text-ink">{record.topic}</span>
                    <span className="block break-words text-sm text-muted">
                      {manage ? record.employee_name + ' · ' : ''}
                      {formatDate.format(new Date(record.completion_date))}
                      {record.expiry_date && record.expiry_date <= expiringBy
                        ? ' · ' + (record.expiry_date < today() ? 'Expired' : 'Expiring soon')
                        : ''}
                    </span>
                  </span>
                  <StatusPill tone={statuses[record.status].tone}>{statuses[record.status].label}</StatusPill>
                  <ChevronRight size={16} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default function TrainingPage({ manage = false }: { manage?: boolean }) {
  const scope = useProtectedIdentityScope(useAuth())
  return <TrainingWorkspace key={`${scope.identityKey}:${scope.authEpoch}:${manage}`} scope={scope} manage={manage} />
}
