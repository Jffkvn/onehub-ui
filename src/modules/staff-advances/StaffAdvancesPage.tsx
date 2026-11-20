import { useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Banknote, ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  extractErrorMessage,
  useProtectedIdentityScope,
  type IdentityScopeRef,
} from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  advancePendingStore, useAdvanceCommand, useAdvanceEmployees, useAdvanceHistory, useAdvances,
  type AdvanceAction, type StaffAdvance,
} from './api'

const money = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 })
const month = new Intl.DateTimeFormat('en-UG', { month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' })
const day = new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeZone: 'Africa/Kampala' })
const kampalaDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Kampala' })
const card = 'rounded-xl border border-line bg-surface p-4 sm:p-5'
const selectClass = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink disabled:opacity-50'

const advanceStatus: Record<StaffAdvance['status'], { label: string; tone: StatusPillProps['tone'] }> = {
  pending: { label: 'Awaiting review', tone: 'warning' },
  active: { label: 'Active', tone: 'info' },
  flagged: { label: 'Flagged', tone: 'danger' },
  paid_off: { label: 'Paid off', tone: 'success' },
  rejected: { label: 'Declined', tone: 'neutral' },
  written_off: { label: 'Written off', tone: 'neutral' },
  voided: { label: 'Voided', tone: 'neutral' },
}
const openStatuses: StaffAdvance['status'][] = ['pending', 'active', 'flagged']

function ugx(amount: number) {
  return 'UGX ' + money.format(amount)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium text-ink">{label}{children}</label>
}

function AdvanceStatus({ status }: { status: StaffAdvance['status'] }) {
  const { label, tone } = advanceStatus[status]
  return <StatusPill tone={tone}>{label}</StatusPill>
}

type SaveAction = (action: AdvanceAction, payload: Record<string, unknown>) => Promise<void>
function formValue(form: FormData, field: string) {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

function AdvanceForm({ manage, scope, busy, save }: {
  manage: boolean
  scope: IdentityScopeRef
  busy: boolean
  save: SaveAction
}) {
  const employees = useAdvanceEmployees(scope, manage)
  const today = kampalaDay.format(new Date())

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      amount: Number(formValue(form, 'amount')),
      reason: formValue(form, 'reason'),
      instalments: Number(formValue(form, 'instalments')),
      deduction_start: formValue(form, 'month') + '-01',
    }
    await save(manage ? 'log' : 'submit', manage ? {
      ...payload,
      employee_id: formValue(form, 'employee'),
      date_issued: formValue(form, 'issued'),
      notes: formValue(form, 'notes') || null,
    } : payload)
  }

  return (
    <section className={card} aria-label={manage ? 'Log staff advance' : 'Request staff advance'}>
      <h2 className="mb-4 font-semibold text-ink">{manage ? 'Log staff advance' : 'Request staff advance'}</h2>
      {manage && employees.isError && <p role="alert" className="mb-3 text-sm text-rose">
        The employee list could not load. <Button variant="ghost" onClick={() => void employees.refetch()}>Retry</Button>
      </p>}
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          {manage && <>
            <Field label="Employee">
              <select name="employee" className={selectClass} required disabled={!employees.data?.length}>
                <option value="">{employees.isLoading ? 'Loading employees…' : 'Select employee'}</option>
                {employees.data?.map((employee) => (
                  <option value={employee.id} key={employee.id}>{employee.legal_name} · {employee.employee_number}</option>
                ))}
              </select>
            </Field>
            <Field label="Date issued"><Input name="issued" type="date" defaultValue={today} required /></Field>
          </>}
          <Field label="Amount (UGX)"><Input name="amount" type="number" min="0.01" max="99999999999999.99" step="0.01" required /></Field>
          <Field label="Instalments"><Input name="instalments" type="number" min="1" max="60" defaultValue="1" required /></Field>
          <Field label="First deduction month"><Input name="month" type="month" defaultValue={today.slice(0, 7)} required /></Field>
          <Field label="Reason"><Textarea name="reason" minLength={3} maxLength={1000} required /></Field>
          {manage && <Field label="Internal notes (optional)"><Textarea name="notes" maxLength={2000} /></Field>}
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy} disabled={manage && !employees.data?.length}>
              {manage ? 'Record advance' : 'Submit request'}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}

const reviewActions = {
  approved: 'Approve request',
  rejected: 'Decline request',
  repay: 'Record repayment',
  flagged: 'Flag advance',
  reactivated: 'Reactivate advance',
  settled: 'Mark as settled',
  written_off: 'Write off balance',
  voided: 'Void advance',
}
type ReviewAction = keyof typeof reviewActions
const actionsFor: Record<StaffAdvance['status'], ReviewAction[]> = {
  pending: ['approved', 'rejected', 'voided'],
  active: ['repay', 'flagged', 'settled', 'written_off'],
  flagged: ['repay', 'reactivated', 'settled', 'written_off'],
  rejected: ['voided'],
  paid_off: [],
  written_off: [],
  voided: [],
}

function ReviewForm({ advance, busy, save }: { advance: StaffAdvance; busy: boolean; save: SaveAction }) {
  const [action, setAction] = useState<ReviewAction | ''>('')
  const choices = actionsFor[advance.status]
  if (!choices.length) return null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!action || !choices.includes(action)) return
    const form = new FormData(event.currentTarget)
    const target = { advance_id: advance.id }
    if (action === 'repay') {
      await save('repay', {
        ...target,
        amount: Number(formValue(form, 'amount')),
        period: formValue(form, 'period') + '-01',
        source: formValue(form, 'source'),
        notes: formValue(form, 'notes') || null,
      })
    } else if (action === 'approved' || action === 'rejected') {
      await save('decide', { ...target, decision: action, reason: formValue(form, 'reason') })
    } else {
      await save('transition', { ...target, transition: action, reason: formValue(form, 'reason') })
    }
  }

  return (
    <section className={card}>
      <h2 className="mb-4 font-semibold text-ink">Manage advance</h2>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <Field label="Action">
            <select name="action" className={selectClass} value={action} onChange={(event) => setAction(event.target.value as ReviewAction | '')}>
              <option value="">Choose an action</option>
              {choices.map((choice) => <option key={choice} value={choice}>{reviewActions[choice]}</option>)}
            </select>
          </Field>
          {action === 'repay' && <>
            <Field label="Repayment amount (UGX)">
              <Input name="amount" type="number" min="0.01" step="0.01" max={advance.balance_remaining} required />
            </Field>
            <Field label="Repayment month">
              <Input name="period" type="month" defaultValue={kampalaDay.format(new Date()).slice(0, 7)} required />
            </Field>
            <Field label="Source">
              <select name="source" className={selectClass}>
                <option value="manual">Manual</option>
                <option value="exit">Exit settlement</option>
              </select>
            </Field>
            <Field label="Internal notes (optional)"><Textarea name="notes" maxLength={2000} /></Field>
          </>}
          {action && action !== 'repay' && <Field label="Reason" key={action}>
            <Textarea name="reason" minLength={3} maxLength={1000} required />
          </Field>}
          {action && <div className="sm:col-span-2"><Button type="submit" loading={busy}>{reviewActions[action]}</Button></div>}
        </fieldset>
      </form>
    </section>
  )
}

function AdvanceDetails({ advance, scope, manage }: { advance: StaffAdvance; scope: IdentityScopeRef; manage: boolean }) {
  const history = useAdvanceHistory(scope, advance.id, manage)
  return <>
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-ink">{manage ? advance.employee_name : 'Advance details'}</h2>
          <p className="mt-1 break-words text-sm text-soft">{advance.reason}</p>
        </div>
        <AdvanceStatus status={advance.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          ['Advance amount', ugx(advance.amount)],
          ['Outstanding balance', ugx(advance.balance_remaining)],
          ['Monthly deduction', ugx(advance.monthly_deduction)],
          ['Instalments', advance.num_instalments],
          ['First deduction', month.format(new Date(advance.deduction_start_month))],
          ['Issue date', day.format(new Date(advance.date_issued))],
        ].map(([label, value]) => <div key={label}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="mt-1 font-medium text-ink">{value}</dd>
        </div>)}
      </dl>
      {manage && advance.notes && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-soft">{advance.notes}</p>}
    </section>
    <section className={card}>
      <h2 className="font-semibold text-ink">Activity and repayments</h2>
      {history.isLoading && <p className="mt-2 text-sm text-soft">Loading activity…</p>}
      {history.isError && <p role="alert" className="mt-2 text-sm text-rose">
        Activity could not load. <Button variant="ghost" onClick={() => void history.refetch()}>Retry</Button>
      </p>}
      {history.data?.length === 0 && <p className="mt-2 text-sm text-soft">No activity recorded.</p>}
      <ol className="divide-y divide-line">
        {history.data?.map((entry) => <li key={entry.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium capitalize text-ink">{entry.event_type.replaceAll('_', ' ')}{entry.amount != null ? ' · ' + ugx(entry.amount) : ''}</span>
            <time className="text-xs text-muted" dateTime={entry.occurred_at}>{day.format(new Date(entry.occurred_at))}</time>
          </div>
          {entry.reason && <p className="mt-1 break-words text-soft">{entry.reason}</p>}
        </li>)}
      </ol>
    </section>
  </>
}

function AdvanceWorkspace({ manage }: { manage: boolean }) {
  const [params, setParams] = useSearchParams()
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const command = useAdvanceCommand()
  const { pending, scope } = command
  const advances = useAdvances(scope, manage)
  const selectedId = params.get('advance')
  const selected = advances.data?.find((advance) => advance.id === selectedId)
  const open = advances.data?.find((advance) => openStatuses.includes(advance.status))
  const visible = advances.data?.filter((advance) => (
    !manage || [advance.employee_name, advance.employee_number, advanceStatus[advance.status].label]
      .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))
  ))
  const busy = command.isPending || Boolean(pending)
  const pendingInFlight = Boolean(pending && advancePendingStore.isActivelyInFlight(pending))

  function openAdvance(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('advance', id)
    else next.delete('advance')
    setParams(next)
    setShowForm(false)
    command.reset()
  }

  async function save(action: AdvanceAction, payload: Record<string, unknown>, retry = false) {
    setNotice('')
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey,
      authEpoch: scope.authEpoch,
      isReady: scope.isAuthReady,
    })
    try {
      const result = await command.mutateAsync({ action, payload, retry: retry ? pending : undefined, snapshot })
      assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
      if (action === 'submit' || action === 'log') openAdvance(result.result_id)
      setNotice(action === 'repay' ? 'Repayment recorded.' : 'Staff advance saved.')
    } catch {
      // The mutation and saved operation expose the confirmed error or retry state.
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader title={manage ? 'Staff Advances' : 'My Advances'} actions={
        !selectedId && !advances.isError && advances.data && (manage || !open) && (
          <Button onClick={() => setShowForm(!showForm)} disabled={busy}>
            {showForm ? 'Close form' : manage ? 'Log advance' : 'Request advance'}
          </Button>
        )
      } />
      {notice && <p role="status" className="text-sm text-ink">{notice}</p>}
      {pending && <div className={card}>
        <p className="mb-2 text-sm text-ink">{pendingInFlight ? 'Saving staff advance…' : 'The saved action needs confirmation.'}</p>
        {!pendingInFlight && <Button variant="outline" disabled={command.isPending}
          onClick={() => void save(pending.operationType, {}, true)}>Retry saved action</Button>}
      </div>}
      {command.isError && <p role="alert" className="text-sm text-rose">{extractErrorMessage(command.error)}</p>}
      {advances.isError ? <div role="alert" className={card}>
        <p className="text-sm text-rose">Staff advances could not load.</p>
        <Button variant="ghost" onClick={() => void advances.refetch()}>Retry</Button>
      </div> : advances.isLoading ? <p className="text-sm text-soft">Loading advances…</p> : <>
        {selectedId && <Button variant="ghost" leftIcon={<ArrowLeft className="size-4" aria-hidden="true" />} onClick={() => openAdvance(null)}>All advances</Button>}
        {selectedId ? selected ? <>
          <AdvanceDetails advance={selected} scope={scope} manage={manage} />
          {manage && <ReviewForm key={selected.id + selected.status + selected.balance_remaining} advance={selected} busy={busy} save={save} />}
        </> : <p className={card}>This advance is unavailable.</p> : <>
          {showForm && <AdvanceForm manage={manage} scope={scope} busy={busy} save={save} />}
          {!manage && open && <p className="text-sm text-soft">You can submit a new request once your current advance is closed.</p>}
          {manage && <Input aria-label="Filter advances" placeholder="Filter by employee or status" value={search}
            onChange={(event) => setSearch(event.target.value)} />}
          {!visible?.length && <p className={card}>{search ? 'No matching advances.' : 'No staff advances yet.'}</p>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {visible?.map((advance) => <li key={advance.id}>
              <button type="button" className={card + ' flex h-full w-full items-center gap-3 text-left hover:border-emerald focus-visible:outline-emerald'}
                onClick={() => openAdvance(advance.id)}>
                <Banknote className="size-5 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold text-ink">{manage ? advance.employee_name : ugx(advance.amount)}</span>
                  <span className="block text-xs text-soft">{manage ? ugx(advance.amount) : day.format(new Date(advance.date_issued))}</span>
                </span>
                <AdvanceStatus status={advance.status} />
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
              </button>
            </li>)}
          </ul>
        </>}
      </>}
    </div>
  )
}

export default function StaffAdvancesPage({ manage = false }: { manage?: boolean }) {
  const scope = useProtectedIdentityScope(useAuth())
  return <AdvanceWorkspace key={scope.identityKey + ':' + scope.authEpoch + ':' + manage} manage={manage} />
}
