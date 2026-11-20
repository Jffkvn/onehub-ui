import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Input, Textarea } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { isAbortError, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { openPrivateDownloadInNewTab } from '@/lib/security/privateFiles'
import { formatLocalDateLabel, formatWallClockDateInput } from '@/modules/attendance/lib/zonedTime'
import {
  cashReceiptAccept,
  openCashReceipt,
  readCashAccountability,
  recordCashReturn,
  reviewCashExpense,
  submitCashExpense,
  UnconfirmedLedgerChange,
  type CashExpense,
} from './accountabilityApi'

interface CashAccountabilityProps {
  advanceId: string
  recipientId: string
  status: string
  canManage: boolean
  scope: IdentityScopeRef
}

type AccountabilityAction =
  | { name: 'expense' }
  | { name: 'return' }
  | { name: 'review'; expense: CashExpense; accept: boolean }

const categories = {
  transport: 'Transport',
  meals: 'Meals and accommodation',
  materials: 'Materials',
  labor: 'Site labor',
  other: 'Other',
}

const expenseStatuses = {
  pending_review: { label: 'Pending review', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  reversed: { label: 'Reversed', tone: 'neutral' },
} as const

const formatMoney = new Intl.NumberFormat('en-UG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const card = 'rounded-lg border border-line bg-surface p-4'

function amountValue(fields: FormData): number {
  const raw = field(fields, 'amount')
  const amount = Number(raw)
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || amount <= 0 || amount > 9_999_999_999_999.99) {
    throw new Error('Enter a positive amount in UGX with up to two decimal places.')
  }
  return amount
}

function field(fields: FormData, key: string): string {
  const value = fields.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function actionLabel(action: AccountabilityAction) {
  if (action.name === 'expense') return 'Submit expense'
  if (action.name === 'return') return 'Record return'
  return action.accept ? 'Accept expense' : 'Reject expense'
}

function categoryLabel(category: string) {
  return Object.hasOwn(categories, category) ? categories[category as keyof typeof categories] : category
}

interface ActionFormProps {
  action: AccountabilityAction
  scope: IdentityScopeRef
  advanceId: string
  recipientId: string
  canSubmit: boolean
  blocked: boolean
  onSuccess: (notice: string) => void
  onUnconfirmed: (message: string) => void
  onClose: () => void
}

function AccountabilityDialog({ action, scope, advanceId, recipientId, canSubmit, blocked, onSuccess, onUnconfirmed, onClose }: ActionFormProps) {
  const id = useId()
  const [missingReceipt, setMissingReceipt] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const today = formatWallClockDateInput(new Date().toISOString(), 'Africa/Kampala')
  const label = actionLabel(action)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || blocked || locked.current) return
    const fields = new FormData(event.currentTarget)
    locked.current = true
    setSaving(true)
    setError('')
    try {
      if (action.name === 'expense') {
        const missingReason = missingReceipt ? field(fields, 'missingReason') : null
        if (missingReason !== null && missingReason.length < 3) throw new Error('Explain why the receipt is unavailable.')
        const vendor = field(fields, 'vendor')
        const explanation = field(fields, 'explanation')
        if (!vendor || !explanation) throw new Error('Enter the vendor and explain the expense.')
        await submitCashExpense(scope, advanceId, recipientId, {
          date: field(fields, 'date'), category: field(fields, 'category'), amount: amountValue(fields),
          vendor, explanation, file, missingReason,
        })
        onSuccess('Expense submitted for review.')
      } else if (action.name === 'return') {
        const reference = field(fields, 'reference')
        if (!reference) throw new Error('Enter a receipt reference.')
        await recordCashReturn(scope, advanceId, {
          date: field(fields, 'date'), amount: amountValue(fields), reference, notes: field(fields, 'notes') || null,
        })
        onSuccess('Cash return recorded.')
      } else {
        const reason = action.accept ? null : field(fields, 'reason')
        if (!action.accept && !reason) throw new Error('Enter a rejection reason.')
        await reviewCashExpense(scope, action.expense.id, action.accept, reason)
        onSuccess(action.accept ? 'Expense accepted.' : 'Expense rejected.')
      }
    } catch (cause) {
      if (cause instanceof UnconfirmedLedgerChange) onUnconfirmed(cause.message)
      if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : 'The change could not be saved.')
    } finally {
      locked.current = false
      setSaving(false)
    }
  }

  return <Dialog
    open
    title={label}
    description={action.name === 'review' ? action.expense.vendor
      : action.name === 'expense' ? 'Record spending against this advance.'
      : 'Record unused funds received for this advance.'}
    hasUnsavedChanges={dirty && !blocked && !saving}
    onOpenChange={(open) => { if (!open && !locked.current) onClose() }}
    footer={<>
      <DialogClose asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></DialogClose>
      <Button type="submit" form={id} loading={saving} disabled={!canSubmit || blocked}>{label}</Button>
    </>}
  >
    <form id={id} onSubmit={(event) => void save(event)} onChange={() => setDirty(true)}>
      <fieldset disabled={saving || blocked} className="space-y-4">
        {action.name !== 'review' && (
          <>
            <FormGroup label={action.name === 'expense' ? 'Expense date' : 'Return date'} htmlFor={id + '-date'}>
              <Input name="date" id={id + '-date'} type="date" defaultValue={today} required />
            </FormGroup>
            <FormGroup label="Amount (UGX)" htmlFor={id + '-amount'}>
              <Input name="amount" id={id + '-amount'} type="number" min="0.01" step="0.01" required />
            </FormGroup>
          </>
        )}
        {action.name === 'expense' && (
          <>
            <FormGroup label="Category" htmlFor={id + '-category'}>
              <select name="category" id={id + '-category'} className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink">
                {Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Vendor" htmlFor={id + '-vendor'}>
              <Input name="vendor" id={id + '-vendor'} required />
            </FormGroup>
            <FormGroup label="Expense explanation" htmlFor={id + '-explanation'}>
              <Textarea name="explanation" id={id + '-explanation'} required />
            </FormGroup>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={missingReceipt} onChange={(event) => { setMissingReceipt(event.currentTarget.checked); setFile(null) }} />
              Receipt unavailable
            </label>
            {missingReceipt ? (
              <FormGroup label="Why the receipt is unavailable" htmlFor={id + '-missing'}>
                <Textarea name="missingReason" id={id + '-missing'} required />
              </FormGroup>
            ) : (
              <FormGroup label="Receipt document" htmlFor={id + '-receipt'} hint="PDF, JPG, PNG or WebP up to 10 MB.">
                <Input id={id + '-receipt'} type="file" accept={cashReceiptAccept}
                  onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} />
              </FormGroup>
            )}
          </>
        )}
        {action.name === 'return' && (
          <>
            <FormGroup label="Receipt reference" htmlFor={id + '-reference'}>
              <Input name="reference" id={id + '-reference'} required />
            </FormGroup>
            <FormGroup label="Notes" htmlFor={id + '-notes'}>
              <Textarea name="notes" id={id + '-notes'} />
            </FormGroup>
          </>
        )}
        {action.name === 'review' && (
          action.accept ? <p className="text-sm text-ink">Accept {formatMoney.format(action.expense.amount)} UGX for this advance?</p> : (
            <FormGroup label="Rejection reason" htmlFor={id + '-reason'}>
              <Textarea name="reason" id={id + '-reason'} required />
            </FormGroup>
          )
        )}
      </fieldset>
      <FieldError className="mt-3" error={error} />
    </form>
  </Dialog>
}

function AccountabilityContent({ advanceId, recipientId, status, canManage, scope }: CashAccountabilityProps) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<AccountabilityAction | null>(null)
  const [notice, setNotice] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [opening, setOpening] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState('')
  const ledger = useQuery({
    queryKey: ['project-cash', scope.identityKey, scope.authEpoch, advanceId, 'accountability'],
    queryFn: () => readCashAccountability(scope, advanceId),
  })
  const isRecipient = scope.identityKey === recipientId
  const canSubmit = status === 'disbursed' && (action?.name === 'expense' ? isRecipient : canManage)

  function refreshLedgers() {
    void queryClient.invalidateQueries({ queryKey: ['project-cash'] })
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  function afterSuccess(message: string) {
    setAction(null)
    setNotice(message)
    refreshLedgers()
  }

  async function download(path: string) {
    setDownloadError('')
    setOpening(true)
    try {
      const opened = await openPrivateDownloadInNewTab(() => openCashReceipt(scope, path, advanceId, recipientId))
      if (!opened) setDownloadError('Allow pop-ups for OneHub to open the private receipt.')
    } catch (cause) {
      if (!isAbortError(cause)) setDownloadError('The private receipt could not be opened.')
    } finally {
      setOpening(false)
    }
  }

  return <section className="space-y-4" aria-label="Cash accountability">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-lg font-bold text-ink">Accountability</h2>
      {status === 'disbursed' && <div className="flex flex-wrap gap-2">
        {isRecipient && <Button type="button" size="sm" variant="outline" disabled={Boolean(unconfirmed)}
          onClick={() => { setNotice(''); setAction({ name: 'expense' }) }}>Add expense</Button>}
        {canManage && <Button type="button" size="sm" variant="outline" disabled={Boolean(unconfirmed)}
          onClick={() => { setNotice(''); setAction({ name: 'return' }) }}>Record cash return</Button>}
      </div>}
    </div>
    {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
    {!action && <FieldError error={unconfirmed} />}
    <FieldError error={downloadError} />
    {ledger.isPending && <p role="status" className="text-sm text-muted">Loading the accountability ledger…</p>}
    {ledger.isError && <div className="flex flex-wrap items-center gap-3">
      <FieldError>The accountability ledger could not be loaded.</FieldError>
      <Button type="button" size="sm" variant="outline" onClick={() => void ledger.refetch()}>Try again</Button>
    </div>}
    {ledger.isSuccess && (
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Expense ledger" className={card}>
          <h3 className="font-display text-base font-semibold text-ink">Expenses</h3>
          {!ledger.data.expenses.length && <p className="mt-2 text-sm text-muted">No expenses recorded.</p>}
          <ul className="mt-2 divide-y divide-line">
            {ledger.data.expenses.map((expense) => {
              const state = expenseStatuses[expense.status]
              return <li key={expense.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="break-words text-sm font-semibold text-ink">{expense.vendor}</p>
                  <span className="whitespace-nowrap text-sm font-semibold text-ink">{formatMoney.format(expense.amount)} UGX</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{formatLocalDateLabel(expense.expense_date)} · {categoryLabel(expense.category)}</span>
                  <StatusPill size="sm" tone={state.tone}>{state.label}</StatusPill>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{expense.explanation}</p>
                {expense.receipt_unavailable && <p className="break-words text-xs text-muted">Receipt unavailable. {expense.receipt_unavailable_explanation}</p>}
                {(expense.rejection_reason || expense.reversal_reason) && (
                  <p className="break-words text-xs text-muted">{expense.rejection_reason ?? expense.reversal_reason}</p>
                )}
                {expense.receipt_url && (isRecipient || canManage) && (
                  <Button type="button" size="sm" variant="ghost" disabled={opening} aria-label={'Open receipt for ' + expense.vendor}
                    onClick={() => { if (expense.receipt_url) void download(expense.receipt_url) }}>Open receipt</Button>
                )}
                {canManage && status === 'disbursed' && expense.status === 'pending_review' && <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={Boolean(unconfirmed)} aria-label={'Accept expense for ' + expense.vendor}
                    onClick={() => { setNotice(''); setAction({ name: 'review', expense, accept: true }) }}>Accept</Button>
                  <Button type="button" size="sm" variant="outline" disabled={Boolean(unconfirmed)} aria-label={'Reject expense for ' + expense.vendor}
                    onClick={() => { setNotice(''); setAction({ name: 'review', expense, accept: false }) }}>Reject</Button>
                </div>}
              </li>
            })}
          </ul>
        </section>
        <section aria-label="Cash return ledger" className={card}>
          <h3 className="font-display text-base font-semibold text-ink">Returned cash</h3>
          {!ledger.data.returns.length && <p className="mt-2 text-sm text-muted">No cash returns recorded.</p>}
          <ul className="mt-2 divide-y divide-line">
            {ledger.data.returns.map((entry) => <li key={entry.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-words text-sm font-semibold text-ink">{entry.receipt_reference}</p>
                <span className="whitespace-nowrap text-sm font-semibold text-ink">{formatMoney.format(entry.amount)} UGX</span>
              </div>
              <p className="text-xs text-muted">{formatLocalDateLabel(entry.return_date)}</p>
              {entry.notes && <p className="whitespace-pre-wrap break-words text-sm text-ink">{entry.notes}</p>}
              {entry.reversed_at && <StatusPill size="sm" tone="neutral">Reversed</StatusPill>}
              {entry.reversal_reason && <p className="break-words text-xs text-muted">{entry.reversal_reason}</p>}
            </li>)}
          </ul>
        </section>
      </div>
    )}
    {action && <AccountabilityDialog
      action={action}
      scope={scope}
      advanceId={advanceId}
      recipientId={recipientId}
      canSubmit={canSubmit}
      blocked={Boolean(unconfirmed)}
      onSuccess={afterSuccess}
      onUnconfirmed={(message) => { setUnconfirmed(message); refreshLedgers() }}
      onClose={() => setAction(null)}
    />}
  </section>
}

export function CashAccountabilityPanel(props: CashAccountabilityProps) {
  const { scope, advanceId } = props
  if (!scope.isAuthReady || !scope.identityKey) return null
  return <AccountabilityContent key={JSON.stringify([scope.identityKey, scope.authEpoch, advanceId])} {...props} />
}
