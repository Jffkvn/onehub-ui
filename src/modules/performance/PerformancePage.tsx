import { ArrowLeft, ClipboardList, Download, Plus, Upload } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ZodError } from 'zod'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { FieldError, Input } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'
import { performanceApi, performanceKey, type PerformanceCycle, type PerformanceReview } from './api'
import { downloadPerformanceTemplate } from './performanceWorkbook'
import { PerformanceImportDialog } from './PerformanceImportDialog'
import { cardClass, Field, fieldValue, ReviewDetail, ReviewStatus, selectClass, type Execute } from './ReviewDetail'

const dateFormat = new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeZone: 'Africa/Kampala' })

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : dateFormat.format(date)
}

function ReviewList({ items, title, empty, mine = false }: {
  items: PerformanceReview[]
  title: string
  empty: string
  mine?: boolean
}) {
  return (
    <section className={cardClass}>
      <h2 className="mb-3 font-display text-lg font-semibold text-ink">{title}</h2>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((review) => (
            <li key={review.id}>
              <Link className="flex flex-wrap items-center justify-between gap-2 rounded-md py-3 focus-visible:outline-emerald"
                to={{ search: '?review=' + review.id }}>
                <div className="min-w-0">
                  <p className="break-words font-semibold text-ink">{mine ? review.cycle_name : review.employee_name}</p>
                  <p className="mt-1 break-words text-sm text-muted">
                    {mine ? review.reviewer_name : review.cycle_name + ' · ' + review.employee_number}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {review.overall_score !== null &&
                    <span className="text-sm font-semibold tabular-nums text-ink">{review.overall_score.toFixed(2)} / 5</span>}
                  <ReviewStatus status={review.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{empty}</p>}
    </section>
  )
}

function CreateCycle({ api, execute, busy, onCreate, onCancel }: {
  api: ReturnType<typeof performanceApi>
  execute: Execute
  busy: boolean
  onCreate: (id: string) => void
  onCancel: () => void
}) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    let id: string | undefined
    const success = await execute(async () => {
      id = await api.createCycle({ name: fieldValue(form, 'name'), startDate: fieldValue(form, 'start'), endDate: fieldValue(form, 'end') })
    }, 'Performance cycle created.')
    if (success && id) onCreate(id)
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-4 font-display text-lg font-semibold text-ink">New review cycle</h2>
      <form onSubmit={(event) => { void save(event) }} className="space-y-4">
        <Field label="Cycle name"><Input name="name" required minLength={2} maxLength={160} disabled={busy} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date"><Input name="start" type="date" required disabled={busy} /></Field>
          <Field label="End date"><Input name="end" type="date" required disabled={busy} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>Create cycle</Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </section>
  )
}

function AssignReview({ scope, api, cycle, assignedIds, execute, busy, onAssign, onCancel }: {
  scope: IdentityScopeRef
  api: ReturnType<typeof performanceApi>
  cycle: PerformanceCycle
  assignedIds: ReadonlySet<string>
  execute: Execute
  busy: boolean
  onAssign: (id: string) => void
  onCancel: () => void
}) {
  const key = performanceKey(scope)
  const employees = useQuery({ queryKey: [...key, 'employees'], queryFn: () => api.listEmployees() })
  const reviewers = useQuery({ queryKey: [...key, 'reviewers'], queryFn: () => api.listReviewers() })
  const available = employees.data?.filter(({ id }) => !assignedIds.has(id)) ?? []

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    let id: string | undefined
    const success = await execute(async () => {
      id = await api.startReview(cycle.id, fieldValue(form, 'employee'), fieldValue(form, 'reviewer'))
    }, 'Review assigned.')
    if (success && id) onAssign(id)
  }

  return (
    <section className={cardClass}>
      <h2 className="mb-4 font-display text-lg font-semibold text-ink">Assign employee review</h2>
      {(employees.isPending || reviewers.isPending) && <p role="status" className="mb-3 text-sm text-muted">Loading assignment options…</p>}
      {(employees.isError || reviewers.isError) && <div className="mb-3 flex flex-wrap items-center gap-2">
        <FieldError>Assignment options could not be loaded.</FieldError>
        <Button type="button" variant="outline" size="sm"
          onClick={() => { void Promise.all([employees.refetch(), reviewers.refetch()]) }}>Retry</Button>
      </div>}
      <form onSubmit={(event) => { void assign(event) }} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee">
            <select name="employee" className={selectClass} defaultValue="" required disabled={busy || !available.length}>
              <option value="">Choose employee</option>
              {available.map((employee) => <option key={employee.id} value={employee.id}>{employee.legal_name} · {employee.employee_number}</option>)}
            </select>
          </Field>
          <Field label="Assigned reviewer">
            <select name="reviewer" className={selectClass} defaultValue="" required disabled={busy || !reviewers.data?.length}>
              <option value="">Choose reviewer</option>
              {(reviewers.data ?? []).map((reviewer) => <option key={reviewer.profile_id} value={reviewer.profile_id}>
                {reviewer.display_name} · {reviewer.role_label}
              </option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy} disabled={!available.length || !reviewers.data?.length}>Assign review</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  )
}

const eventLabels: Record<string, string> = {
  assigned: 'Review assigned',
  started: 'Review assigned',
  draft_saved: 'Draft saved',
  submitted: 'Review submitted',
  approved: 'Review released',
  reopened: 'Changes requested',
  acknowledged: 'Employee acknowledged',
  spreadsheet_imported: 'Review imported',
}

function ReviewHistory({ api, scope, id }: {
  api: ReturnType<typeof performanceApi>
  scope: IdentityScopeRef
  id: string
}) {
  const events = useQuery({ queryKey: [...performanceKey(scope), 'events', id], queryFn: () => api.listEvents(id) })
  return (
    <section className="space-y-2 border-t border-line pt-4 text-sm">
      <h3 className="font-semibold text-ink">Review activity</h3>
      {events.isPending && <p role="status" className="text-muted">Loading review activity…</p>}
      {events.isError && <div className="flex items-center gap-2">
        <FieldError>Review activity could not be loaded.</FieldError>
        <Button type="button" variant="outline" size="sm" onClick={() => { void events.refetch() }}>Retry</Button>
      </div>}
      {events.data?.length === 0 && <p className="text-muted">No activity has been recorded.</p>}
      {events.data?.length ? <ol className="divide-y divide-line">
        {events.data.map((event) => (
          <li key={event.id} className="py-2">
            <p className="font-medium text-ink">{eventLabels[event.event_type] ?? event.event_type.replaceAll('_', ' ')}</p>
            <p className="break-words text-muted">{event.actor_name} · {formatDate(event.occurred_at)}</p>
            {event.reason && <p className="whitespace-pre-wrap break-words text-soft">{event.reason}</p>}
          </li>
        ))}
      </ol> : null}
    </section>
  )
}

function PerformanceWorkspace({ scope, manage, readSelf, canReview }: {
  scope: IdentityScopeRef
  manage: boolean
  readSelf: boolean
  canReview: boolean
}) {
  const [params, setParams] = useSearchParams()
  const [cycleId, setCycleId] = useState('')
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const queryClient = useQueryClient()
  const api = performanceApi(scope)
  const key = performanceKey(scope)
  const cycles = useQuery({ queryKey: [...key, 'cycles'], queryFn: () => api.listCycles(), enabled: manage })
  const roster = useQuery({ queryKey: [...key, 'roster'], queryFn: () => api.listReviews(), enabled: manage })
  const personal = useQuery({ queryKey: [...key, 'personal'], queryFn: () => api.listMine(), enabled: !manage && readSelf })
  const assignments = useQuery({ queryKey: [...key, 'assigned'], queryFn: () => api.listAssigned(), enabled: !manage && canReview })
  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    retry: false,
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    ]),
  })
  const execute: Execute = async (action, successMessage) => {
    setNotice('')
    try {
      await mutation.mutateAsync(action)
      setNotice(successMessage)
      return true
    } catch {
      return false
    }
  }
  const chosenCycle = cycles.data?.find(({ id }) => id === cycleId)
  const visibleRoster = roster.data?.filter(({ cycle_id }) => !chosenCycle || cycle_id === chosenCycle.id) ?? []
  const reviewId = params.get('review')
  const row = manage
    ? roster.data?.find(({ id }) => id === reviewId)
    : ((readSelf ? personal.data : undefined)?.find(({ id }) => id === reviewId)
      ?? (canReview ? assignments.data : undefined)?.find(({ id }) => id === reviewId))
  const mine = !manage && !!row && readSelf && Boolean(personal.data?.some(({ id }) => id === row.id))
  const assigned = canReview && !mine && row?.reviewer_profile_id === scope.identityKey
  const enabledQueries = manage ? [cycles, roster] : [...(readSelf ? [personal] : []), ...(canReview ? [assignments] : [])]
  const loading = enabledQueries.some((query) => query.isPending)
  const loadError = enabledQueries.some((query) => query.isError)
  const isBusy = mutation.isPending
  const actionError = mutation.error
  const showError = actionError && !isAbortError(actionError)

  function selectReview(id?: string) {
    const next = new URLSearchParams(params)
    if (id) next.set('review', id)
    else next.delete('review')
    setParams(next)
    setNotice('')
    mutation.reset()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={manage ? 'Performance Reviews' : 'My Performance'}
        subtitle={manage ? 'Manage review cycles, assignments and decisions.' : undefined}
        actions={manage && !reviewId && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" leftIcon={<Download size={16} aria-hidden="true" />}
              onClick={() => downloadPerformanceTemplate(chosenCycle?.status === 'active' ? chosenCycle.name : undefined)}
              disabled={isBusy}>Download template</Button>
            <Button type="button" variant="outline" leftIcon={<Upload size={16} aria-hidden="true" />}
              onClick={() => { setImporting(true); setCreating(false); setAssigning(false) }}
              disabled={isBusy || chosenCycle?.status !== 'active'}>Import workbook</Button>
            <Button type="button" leftIcon={<Plus size={16} aria-hidden="true" />}
              onClick={() => { setCreating(true); setAssigning(false) }} disabled={creating || isBusy}>New cycle</Button>
          </div>
        )}
      />
      {notice && <p role="status" className="rounded-lg border border-emerald/30 bg-emerald-tint px-4 py-2 text-sm text-ink">{notice}</p>}
      {showError && <FieldError className="rounded-lg border border-rose/30 bg-rose-tint px-4 py-2">
        {actionError instanceof ZodError ? actionError.issues[0]?.message ?? 'Check the form values.' : actionError.message}
      </FieldError>}
      {loading && !row && <p role="status" className={cardClass + ' text-sm text-muted'}>Loading reviews…</p>}
      {loadError && <div className={cardClass + ' flex flex-wrap items-center justify-between gap-2'}>
        <FieldError>Some performance data could not be loaded.</FieldError>
        <Button type="button" variant="outline" size="sm"
          onClick={() => { void Promise.all(enabledQueries.map((query) => query.refetch())) }}>Retry</Button>
      </div>}
      {reviewId && <Button type="button" variant="ghost" leftIcon={<ArrowLeft size={16} aria-hidden="true" />}
        onClick={() => selectReview()} disabled={isBusy}>All reviews</Button>}
      {reviewId && !row && !loading && !loadError && <p className={cardClass + ' text-sm text-muted'}>This review is unavailable.</p>}
      {row && (
        <ReviewDetail key={row.id + ':' + row.status} review={row} api={api} execute={execute} busy={isBusy}
          mode={manage ? 'hr' : mine ? 'employee' : 'assigned'} assignedReviewer={assigned}>
          {(manage || assigned) && <ReviewHistory api={api} scope={scope} id={row.id} />}
        </ReviewDetail>
      )}
      {!reviewId && manage && (
        <>
          {creating && <CreateCycle api={api} execute={execute} busy={isBusy}
            onCreate={(id) => { setCycleId(id); setCreating(false) }}
            onCancel={() => setCreating(false)} />}
          {cycles.data && <section className={cardClass + ' space-y-3'}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="w-full sm:max-w-sm">
                <Field label="Review cycle">
                  <select className={selectClass} value={cycleId} disabled={isBusy}
                    onChange={(event) => { setCycleId(event.target.value); setAssigning(false) }}>
                    <option value="">All cycles</option>
                    {cycles.data.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}
                  </select>
                </Field>
              </div>
              {chosenCycle && <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={isBusy}
                  onClick={() => { void execute(
                    () => api.setCycleStatus(chosenCycle.id, chosenCycle.status === 'active' ? 'closed' : 'active'),
                    chosenCycle.status === 'active' ? 'Cycle closed.' : 'Cycle activated.',
                  ) }}>
                  {chosenCycle.status === 'active' ? 'Close cycle' : chosenCycle.status === 'closed' ? 'Reopen cycle' : 'Activate cycle'}
                </Button>
                {chosenCycle.status === 'active' && <Button type="button" leftIcon={<ClipboardList size={16} aria-hidden="true" />}
                  onClick={() => { setAssigning(true); setCreating(false) }} disabled={assigning || isBusy || !roster.data}>Assign review</Button>}
              </div>}
            </div>
            {chosenCycle && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                <StatusPill tone={chosenCycle.status === 'active' ? 'success' : 'neutral'}>
                  {chosenCycle.status === 'active' ? 'Active' : chosenCycle.status === 'closed' ? 'Closed' : 'Draft'}
                </StatusPill>
                <span>{formatDate(chosenCycle.start_date)} – {formatDate(chosenCycle.end_date)}</span>
                <span>{chosenCycle.completed_reviews} of {chosenCycle.total_reviews} complete</span>
              </div>
            )}
          </section>}
          {assigning && chosenCycle?.status === 'active' && <AssignReview
            key={chosenCycle.id} cycle={chosenCycle} scope={scope} api={api} execute={execute} busy={isBusy}
            assignedIds={new Set(visibleRoster.map(({ employee_id }) => employee_id))}
            onAssign={(id) => { setAssigning(false); selectReview(id) }} onCancel={() => setAssigning(false)}
          />}
          {roster.data && <ReviewList items={visibleRoster} title="Review roster" empty="No reviews in this selection." />}
          {chosenCycle?.status === 'active' && (
            <PerformanceImportDialog
              open={importing}
              onOpenChange={setImporting}
              cycle={chosenCycle}
              existingReviews={roster.data ?? []}
              api={api}
              scope={scope}
              onImported={(savedCount) => setNotice(`Imported ${savedCount} review assessment(s) into ${chosenCycle.name}.`)}
            />
          )}
        </>
      )}
      {!reviewId && !manage && (
        <>
          {readSelf && personal.data && <ReviewList items={personal.data} title="My reviews" empty="Your released reviews will appear here." mine />}
          {canReview && assignments.data && <ReviewList items={assignments.data} title="Assigned to me" empty="You have no assigned reviews." />}
        </>
      )}
    </div>
  )
}

export default function PerformancePage({ manage = false }: { manage?: boolean }) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const permissions = auth.access?.permissionKeys ?? []
  const canManage = permissions.includes('performance.manage')
  const canReview = permissions.includes('performance.review')
  const readSelf = permissions.includes('performance.read_self')

  if (!scope.isAuthReady || (manage ? !canManage : !readSelf && !canReview)) return <ForbiddenPage />
  return <PerformanceWorkspace key={[scope.identityKey, scope.authEpoch, manage].join(':')} scope={scope}
    manage={manage} readSelf={readSelf} canReview={canReview} />
}
