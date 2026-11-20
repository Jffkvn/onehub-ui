import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { FieldError, Input, Textarea } from '@/components/ui/Input'
import { isAbortError, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { cashField, cashSelect } from './cashDisplay'
import {
  cashKey, CashRequestUnconfirmed, readCashRequestProjects, readCashRequestRecipients, readOutstandingCash, submitCashRequest,
} from './projectCashApi'

interface CashRequestProps {
  scope: IdentityScopeRef
  canManage: boolean
  initialProject: string
  onClose: () => void
  onCreated: (advanceId: string) => void
}

export function CashRequestDialog({ scope, canManage, initialProject, onClose, onCreated }: CashRequestProps) {
  const [projectId, setProject] = useState(initialProject)
  const [recipientId, setRecipient] = useState(scope.identityKey ?? '')
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [inputError, setInputError] = useState('')
  const formId = useId()
  const inProgress = useRef(false)
  const queryClient = useQueryClient()
  const key = cashKey(scope)

  const projects = useQuery({
    queryKey: [...key, 'requestable-projects', canManage],
    queryFn: ({ signal }) => readCashRequestProjects(scope, canManage, signal),
    retry: false,
  })
  const recipients = useQuery({
    queryKey: [...key, 'eligible-recipients'],
    queryFn: ({ signal }) => readCashRequestRecipients(scope, signal),
    enabled: canManage,
    retry: false,
  })
  const project = projects.data?.find((row) => row.id === projectId)?.id ?? ''
  const recipient = canManage ? recipients.data?.find((row) => row.id === recipientId)?.id ?? '' : scope.identityKey ?? ''
  const outstanding = useQuery({
    queryKey: [...key, 'has-outstanding', recipient],
    queryFn: () => readOutstandingCash(scope, recipient),
    enabled: Boolean(recipient),
    retry: false,
  })
  const write = useMutation({
    mutationFn: (values: Parameters<typeof submitCashRequest>[1]) => submitCashRequest(scope, values),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-cash'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ])
    },
    retry: false,
  })

  const unconfirmed = write.error instanceof CashRequestUnconfirmed
  const busy = write.isPending || unconfirmed
  const dirty = Boolean(amount || purpose || projectId !== initialProject || recipientId !== scope.identityKey)
  const choicesLoading = projects.isPending || (canManage && recipients.isPending)
  const choicesFailed = projects.isError || (canManage && recipients.isError)
  const choicesReady = Boolean(project && recipient && !choicesLoading && !choicesFailed)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || inProgress.current || !choicesReady) return
    const requested = Number(amount)
    setInputError('')

    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || requested <= 0 || requested > 9999999999999.99) {
      setInputError('Enter a positive amount with up to two decimal places.')
      return
    }
    const description = purpose.trim()
    if (description.length < 5) {
      setInputError('Enter at least five characters to explain the request.')
      return
    }

    inProgress.current = true
    try {
      const id = await write.mutateAsync({ projectId: project, recipientId: recipient, amount: requested, purpose: description })
      onCreated(id)
    } catch {
      // Keep the form and report its mutation failure beside the submit button.
    } finally {
      inProgress.current = false
    }
  }

  return <Dialog open title="Request cash advance" description="Choose the project and describe what the advance will cover."
    hasUnsavedChanges={dirty && !busy} onOpenChange={(open) => { if (!open && !inProgress.current) onClose() }}
    footer={<>
      <DialogClose asChild><Button type="button" disabled={write.isPending} variant="outline">{unconfirmed ? 'Back to requests' : 'Cancel'}</Button></DialogClose>
      <Button type="submit" form={formId} loading={write.isPending} disabled={!choicesReady || unconfirmed}>Submit request</Button>
    </>}>
    <form id={formId} className="space-y-4" onSubmit={(event) => void submit(event)}>
      {choicesLoading && <p role="status" className="text-sm text-muted">Loading request options…</p>}
      {choicesFailed && <div className="flex items-center gap-3">
        <FieldError>Could not load request options.</FieldError>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          if (projects.isError) void projects.refetch()
          if (canManage && recipients.isError) void recipients.refetch()
        }}>Retry</Button>
      </div>}
      {projects.isSuccess && projects.data.length === 0 && <p className="text-sm text-muted">No eligible projects are available for this account.</p>}
      <fieldset disabled={busy || choicesLoading || choicesFailed} className="space-y-4">
        <label className={cashField}>
          <span>Project</span>
          <select name="project" value={project} required className={cashSelect} onChange={(event) => setProject(event.target.value)}>
            <option value="">Select project</option>
            {(projects.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.project_code} · {row.name}</option>)}
          </select>
        </label>
        {canManage && <label className={cashField}>
          <span>Recipient</span>
          <select name="recipient" value={recipient} required className={cashSelect} onChange={(event) => setRecipient(event.target.value)}>
            <option value="">Select recipient</option>
            {(recipients.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}
          </select>
        </label>}
        {outstanding.data === true && <p className="rounded-md bg-amber-tint px-3 py-2 text-sm text-ink">
          This recipient has an outstanding cash advance. Finance will need to record an override reason to approve this request.
        </p>}
        {outstanding.isError && <p className="text-sm text-muted">Could not check outstanding advances. Finance will check before approval.</p>}
        <label className={cashField}><span>Amount (UGX)</span>
          <Input type="number" inputMode="decimal" min="0.01" max="9999999999999.99" step="0.01" required value={amount}
            onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className={cashField}><span>Purpose</span>
          <Textarea required minLength={5} maxLength={2000} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </label>
      </fieldset>
      <FieldError error={inputError || (write.isError && !isAbortError(write.error) ? write.error.message : undefined)} />
    </form>
  </Dialog>
}
