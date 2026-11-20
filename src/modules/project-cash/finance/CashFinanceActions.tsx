import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { FieldError, Input, Textarea } from '@/components/ui/Input'
import { isAbortError, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import {
  CashFinanceOutcomeUnknown,
  CashFinanceStatusChanged,
  checkCashFinanceOutstanding,
  parseCashFinanceAmount,
  readCashFinanceClosure,
  writeCashFinanceAction,
  type CashFinanceAction,
} from './cashFinanceApi'

type FinanceActionKind = CashFinanceAction['kind']

interface CashFinanceActionsProps {
  advanceId: string
  recipientId: string
  status: string
  amountRequested: number
  scope: IdentityScopeRef
}

const money = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 })

const actions: Record<FinanceActionKind, { title: string; description: string; confirm: string; done: string }> = {
  approve: {
    title: 'Approve request',
    description: 'Approve this cash advance for disbursement.',
    confirm: 'Confirm approval',
    done: 'Cash advance approved.',
  },
  reject: {
    title: 'Reject request',
    description: 'Decline this cash advance. The requester will receive a notification.',
    confirm: 'Confirm rejection',
    done: 'Cash advance rejected.',
  },
  disburse: {
    title: 'Record disbursement',
    description: 'Record the amount already paid and its payment reference.',
    confirm: 'Confirm disbursement',
    done: 'Disbursement recorded.',
  },
  close: {
    title: 'Close advance',
    description: 'Complete accountability for this cash advance.',
    confirm: 'Confirm closure',
    done: 'Cash advance closed.',
  },
}

const actionsByStatus: Record<string, FinanceActionKind[]> = {
  pending_approval: ['approve', 'reject'],
  approved: ['disburse'],
  disbursed: ['close'],
}

function FinanceControls({ scope, advanceId, recipientId, amountRequested, status }: CashFinanceActionsProps) {
  const [action, setAction] = useState<FinanceActionKind>()
  const [overrideReason, setOverrideReason] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [notice, setNotice] = useState('')
  const formId = useId()
  const busy = useRef(false)
  const queryClient = useQueryClient()
  const key = ['project-cash', scope.identityKey, scope.authEpoch, advanceId, 'finance'] as const
  const outstanding = useQuery({
    queryKey: [...key, 'outstanding', recipientId],
    queryFn: () => checkCashFinanceOutstanding(scope, recipientId),
    enabled: action === 'approve',
    retry: false,
  })
  const closure = useQuery({
    queryKey: [...key, 'closure'],
    queryFn: () => readCashFinanceClosure(scope, advanceId),
    enabled: action === 'close',
    retry: false,
  })
  const write = useMutation({
    mutationFn: (command: CashFinanceAction) => writeCashFinanceAction(scope, advanceId, recipientId, command),
    retry: false,
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project-cash'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ]),
  })

  const lockout = write.error instanceof CashFinanceOutcomeUnknown || write.error instanceof CashFinanceStatusChanged
  const amountParsed = parseCashFinanceAmount(amount)
  const amountInvalid = amount.trim() !== '' && (amountParsed === null || amountParsed > amountRequested)
  const canApprove = outstanding.isSuccess && !outstanding.isFetching
    && (!outstanding.data || overrideReason.trim() !== '')
  const canDisburse = amountParsed !== null && !amountInvalid && reference.trim() !== ''
  const canClose = closure.isSuccess && !closure.isFetching
    && closure.data.balance === 0 && closure.data.pendingCount === 0
  const canWrite = action !== undefined && !write.isPending && !lockout && (
    (action === 'approve' && canApprove)
    || action === 'reject'
    || (action === 'disburse' && canDisburse)
    || (action === 'close' && canClose)
  )
  const dirty = overrideReason !== '' || reference !== '' || (amount !== '' && amount !== String(amountRequested))
  const visibleError = write.error && !isAbortError(write.error) ? write.error.message : undefined

  function open(next: FinanceActionKind) {
    write.reset()
    setNotice('')
    setOverrideReason('')
    setAmount(next === 'disburse' ? String(amountRequested) : '')
    setReference('')
    setAction(next)
  }

  async function submit() {
    if (!action || !canWrite || busy.current) return
    let command: CashFinanceAction
    switch (action) {
      case 'approve':
        command = { kind: action, overrideReason }
        break
      case 'disburse':
        if (amountParsed === null) return
        command = { kind: action, amount: amountParsed, reference }
        break
      default:
        command = { kind: action }
    }
    busy.current = true
    try {
      await write.mutateAsync(command)
      setNotice(actions[action].done)
      setAction(undefined)
    } catch {
      // The dialog displays the mutation error beside the confirmation controls.
    } finally {
      busy.current = false
    }
  }

  const available = Object.hasOwn(actionsByStatus, status) ? actionsByStatus[status] : []
  if (available.length === 0) return null

  return <section aria-label="Finance actions" className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {available.map((kind) => <Button key={kind} type="button" variant={kind === 'reject' ? 'outline' : 'primary'}
        disabled={lockout} onClick={() => open(kind)}>{actions[kind].title}</Button>)}
    </div>
    {notice && <p role="status" className="text-sm text-soft">{notice}</p>}
    {!action && lockout && <FieldError>{visibleError}</FieldError>}
    {action && <Dialog open title={actions[action].title} description={actions[action].description}
      hasUnsavedChanges={dirty && !write.isPending && !lockout}
      onOpenChange={(open) => { if (!open && !busy.current) setAction(undefined) }}
      footer={<>
        <DialogClose asChild><Button type="button" variant="outline" disabled={write.isPending}>Cancel</Button></DialogClose>
        <Button type="submit" form={formId} variant={action === 'reject' ? 'danger' : 'primary'}
          disabled={!canWrite} loading={write.isPending}>{actions[action].confirm}</Button>
      </>}>
      <form id={formId} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        {action === 'approve' && <>
          {outstanding.isFetching && <p role="status" className="text-sm text-muted">Checking outstanding advances…</p>}
          {outstanding.isError && <div className="flex flex-wrap items-center gap-2">
            <FieldError>Could not verify outstanding advances for the recipient.</FieldError>
            <Button type="button" variant="outline" size="sm" onClick={() => void outstanding.refetch()}>Retry check</Button>
          </div>}
          {outstanding.isSuccess && outstanding.data && <>
            <p className="rounded-md border border-amber/40 bg-amber-tint/70 p-3 text-sm text-ink">
              This recipient has an outstanding cash advance.
            </p>
            <label className="block space-y-1 text-sm font-medium text-ink">
              <span>Override reason</span>
              <Textarea required value={overrideReason} disabled={write.isPending || lockout}
                onChange={(event) => setOverrideReason(event.target.value)} />
            </label>
          </>}
          {outstanding.isSuccess && !outstanding.data && (
            <p className="text-sm text-soft">The recipient has no outstanding cash advances.</p>
          )}
        </>}
        {action === 'disburse' && <>
          <label className="block space-y-1 text-sm font-medium text-ink">
            <span>Amount disbursed (UGX)</span>
            <Input required type="text" inputMode="decimal" value={amount} error={amountInvalid}
              disabled={write.isPending || lockout} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <p className="text-sm text-muted">Requested amount <span className="whitespace-nowrap font-medium">UGX {money.format(amountRequested)}</span></p>
          {amountInvalid && <FieldError>Enter a positive amount up to the requested amount with at most two decimal places.</FieldError>}
          <label className="block space-y-1 text-sm font-medium text-ink">
            <span>Payment reference</span>
            <Input required value={reference} disabled={write.isPending || lockout}
              onChange={(event) => setReference(event.target.value)} />
          </label>
        </>}
        {action === 'close' && <>
          {closure.isFetching && <p role="status" className="text-sm text-muted">Checking balance and pending expenses…</p>}
          {closure.isError && <div className="flex flex-wrap items-center gap-2">
            <FieldError>Could not verify the ledger balance and pending expenses.</FieldError>
            <Button type="button" variant="outline" size="sm" onClick={() => void closure.refetch()}>Retry check</Button>
          </div>}
          {closure.isSuccess && <div className="space-y-2 rounded-md border border-line bg-canvas p-3 text-sm text-ink">
            <p>Outstanding balance <span className="whitespace-nowrap font-medium">UGX {money.format(closure.data.balance)}</span></p>
            <p>{closure.data.pendingCount === 0 ? 'All submitted expenses have been reviewed.'
              : closure.data.pendingCount === 1 ? '1 expense is awaiting review.'
                : money.format(closure.data.pendingCount) + ' expenses are awaiting review.'}</p>
            {!canClose && <Button type="button" variant="outline" size="sm" disabled={closure.isFetching}
              onClick={() => void closure.refetch()}>Recheck ledger</Button>}
          </div>}
        </>}
        {visibleError && <FieldError>{visibleError}</FieldError>}
      </form>
    </Dialog>}
  </section>
}

export function CashFinanceActions(props: CashFinanceActionsProps) {
  const { advanceId, status, scope } = props
  if (!scope.isAuthReady || !scope.identityKey) return null
  return <FinanceControls {...props} key={JSON.stringify([scope.identityKey, scope.authEpoch, advanceId, status])} />
}
