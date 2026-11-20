import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  assessmentSchema,
  type Assessment,
  type PerformanceReview,
  type performanceApi,
} from './api'

export type Execute = (action: () => Promise<unknown>, message: string) => Promise<boolean>
type Api = ReturnType<typeof performanceApi>
type FormContext = { api: Api; execute: Execute; busy: boolean; review: PerformanceReview }

export const cardClass = 'rounded-2xl border border-line bg-surface p-5 sm:p-6'
export const selectClass = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald disabled:opacity-50'

export function fieldValue(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1.5 text-sm font-medium text-soft">{label}{children}</label>
}

export function ReviewStatus({ status }: { status: PerformanceReview['status'] }) {
  switch (status) {
    case 'draft': return <StatusPill>Draft</StatusPill>
    case 'manager_submitted': return <StatusPill tone="warning">Awaiting HR</StatusPill>
    case 'hr_approved': return <StatusPill tone="info">Released</StatusPill>
    case 'employee_acknowledged': return <StatusPill tone="success">Acknowledged</StatusPill>
    case 'reopened': return <StatusPill tone="warning">Changes requested</StatusPill>
  }
}

function serverAssessment(review: PerformanceReview): Assessment {
  return {
    managerComments: review.manager_comments ?? '',
    recommendIncrement: review.recommend_increment,
    recommendPromotion: review.recommend_promotion,
    goals: review.goals.map(({ description, manager_rating }) => ({ description, managerRating: manager_rating })),
  }
}

function AssessmentEditor({ api, execute, busy, review }: FormContext) {
  const [draft, setDraft] = useState(() => {
    const assessment = serverAssessment(review)
    return assessment.goals.length ? assessment : { ...assessment, goals: [{ description: '', managerRating: 3 }] }
  })
  const [goalKeys, setGoalKeys] = useState(() => draft.goals.map(() => crypto.randomUUID()))
  const result = assessmentSchema.safeParse(draft)
  const saved = result.success && review.overall_score !== null
    && JSON.stringify(result.data) === JSON.stringify(serverAssessment(review))

  function addGoal() {
    setDraft({ ...draft, goals: [...draft.goals, { description: '', managerRating: 3 }] })
    setGoalKeys([...goalKeys, crypto.randomUUID()])
  }

  function removeGoal(index: number) {
    setDraft({ ...draft, goals: draft.goals.filter((_, position) => position !== index) })
    setGoalKeys(goalKeys.filter((_, position) => position !== index))
  }

  function editGoal(index: number, values: Partial<Assessment['goals'][number]>) {
    setDraft({ ...draft, goals: draft.goals.map((goal, position) => position === index ? { ...goal, ...values } : goal) })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!result.success) return
    await execute(() => api.saveReview(review.id, result.data), 'Draft saved.')
  }

  return (
    <form className="space-y-5" onSubmit={(event) => { void save(event) }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-ink">Goals and KPI ratings</h3>
        <Button type="button" variant="outline" size="sm" onClick={addGoal} disabled={busy || draft.goals.length >= 30}>Add goal</Button>
      </div>
      <ol className="space-y-3">
        {draft.goals.map((goal, index) => (
          <li key={goalKeys[index]} className="grid items-end gap-3 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <Field label={'Goal ' + (index + 1)}>
              <Input value={goal.description} onChange={(event) => editGoal(index, { description: event.target.value })}
                required minLength={2} maxLength={1000} disabled={busy} />
            </Field>
            <Field label={'Rating ' + (index + 1)}>
              <Input type="number" min={1} max={5} step={0.1} value={goal.managerRating} required
                onChange={(event) => editGoal(index, { managerRating: Number(event.target.value) })} disabled={busy} />
            </Field>
            {draft.goals.length > 1 && <Button type="button" variant="ghost" disabled={busy} onClick={() => removeGoal(index)} aria-label={'Remove goal ' + (index + 1)}>Remove</Button>}
          </li>
        ))}
      </ol>
      <Field label="Manager assessment">
        <Textarea value={draft.managerComments} onChange={(event) => setDraft({ ...draft, managerComments: event.target.value })}
          required minLength={3} maxLength={4000} disabled={busy} />
      </Field>
      <div className="flex flex-wrap gap-3 text-sm text-soft">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.recommendIncrement} disabled={busy}
            onChange={(event) => setDraft({ ...draft, recommendIncrement: event.target.checked })} />
          Recommend salary increment
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.recommendPromotion} disabled={busy}
            onChange={(event) => setDraft({ ...draft, recommendPromotion: event.target.checked })} />
          Recommend promotion
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" disabled={busy || !result.success}>Save draft</Button>
        <Button type="button" disabled={busy || !saved}
          onClick={() => { void execute(() => api.submitReview(review.id), 'Review sent to HR.') }}>
          Submit to HR
        </Button>
        {!saved && <span className="text-xs text-muted">Save valid ratings and comments before submitting.</span>}
      </div>
    </form>
  )
}

function AssessmentSummary({ review }: { review: PerformanceReview }) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-ink">Manager assessment</h3>
      {review.manager_comments
        ? <p className="whitespace-pre-wrap break-words text-sm text-soft">{review.manager_comments}</p>
        : <p className="text-sm text-muted">The reviewer has yet to add an assessment.</p>}
      {review.goals.length > 0 && <ul className="divide-y divide-line rounded-xl border border-line">
        {review.goals.map((goal) => (
          <li className="flex items-start justify-between gap-4 p-3 text-sm" key={goal.id}>
            <span className="break-words text-soft">{goal.description}</span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">{goal.manager_rating} / 5</span>
          </li>
        ))}
      </ul>}
      {review.overall_score !== null && <p className="text-sm font-medium text-ink">
        Overall score <strong className="ml-1 tabular-nums">{review.overall_score.toFixed(2)} / 5</strong>
      </p>}
      {review.recommend_increment && <StatusPill withDot={false} tone="violet">Salary increment recommended</StatusPill>}
      {review.recommend_promotion && <StatusPill withDot={false} tone="violet" className={review.recommend_increment ? 'ml-2' : undefined}>Promotion recommended</StatusPill>}
    </div>
  )
}

function HrDecision({ api, execute, busy, review }: FormContext) {
  function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const decision = fieldValue(data, 'decision') === 'reopened' ? 'reopened' : 'approved'
    const reason = fieldValue(data, 'reason')
    void execute(() => api.decideReview(review.id, decision, reason),
      decision === 'approved' ? 'Review released to the employee.' : 'Review returned to the reviewer.')
  }

  return (
    <form className="space-y-4 border-t border-line pt-5" onSubmit={decide}>
      <h3 className="font-semibold text-ink">HR decision</h3>
      <Field label="Decision">
        <select name="decision" className={selectClass} disabled={busy}>
          <option value="approved">Release to employee</option>
          <option value="reopened">Return for changes</option>
        </select>
      </Field>
      <Field label="Decision reason">
        <Textarea name="reason" minLength={3} maxLength={2000} required disabled={busy} />
      </Field>
      <Button type="submit" loading={busy}>Confirm decision</Button>
    </form>
  )
}

function EmployeeAcknowledgment({ api, execute, busy, review }: FormContext) {
  function acknowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const comment = fieldValue(new FormData(event.currentTarget), 'comment')
    void execute(() => api.acknowledge(review.id, comment), 'Review acknowledgment recorded.')
  }

  return (
    <form className="space-y-4 border-t border-line pt-5" onSubmit={acknowledge}>
      <Field label="Acknowledgment comment (optional)">
        <Textarea name="comment" maxLength={2000} disabled={busy} />
      </Field>
      <Button type="submit" loading={busy}>Acknowledge review</Button>
    </form>
  )
}

export function ReviewDetail({ mode, assignedReviewer, children, ...context }: FormContext & {
  mode: 'hr' | 'assigned' | 'employee'
  assignedReviewer: boolean
  children?: ReactNode
}) {
  const { review } = context
  const editable = assignedReviewer && (review.status === 'draft' || review.status === 'reopened')
  return (
    <article className={cardClass + ' space-y-5'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-display text-xl font-semibold text-ink">
            {mode === 'employee' ? review.cycle_name : review.employee_name}
          </h2>
          <p className="mt-1 break-words text-sm text-muted">
            {mode !== 'employee' && review.cycle_name + ' · '}Reviewer {review.reviewer_name}
          </p>
        </div>
        <ReviewStatus status={review.status} />
      </div>
      {review.hr_reason && (mode === 'hr' || assignedReviewer) &&
        <aside className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-soft">
          <strong className="block">HR decision reason</strong>
          <p className="mt-1 whitespace-pre-wrap break-words">{review.hr_reason}</p>
        </aside>}
      {editable ? <AssessmentEditor {...context} /> : <AssessmentSummary review={review} />}
      {mode === 'hr' && review.status === 'manager_submitted' && <HrDecision {...context} />}
      {mode === 'employee' && review.status === 'hr_approved' && <EmployeeAcknowledgment {...context} />}
      {review.acknowledgment_comment && <section className="border-t border-line pt-4 text-sm">
        <h3 className="font-semibold text-ink">Employee acknowledgment</h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-soft">{review.acknowledgment_comment}</p>
      </section>}
      {children}
    </article>
  )
}
