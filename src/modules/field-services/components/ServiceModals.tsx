import { useEffect, useState } from 'react'
import { ExternalLink, Image as ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FormGroup, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Checkbox } from '@/components/ui/Toggles'
import { useToast } from '@/components/ui/Toast'
import {
  SERVICE_URGENT_REASON_CODES,
  SERVICE_URGENT_REASON_LABELS,
  type DispatchCandidate,
  type ServiceUrgentFlag,
  type ServiceUrgentReasonCode,
} from '../schemas/services'
import { extractErrorMessage, isAbortError } from '../lib/pendingOperations'
import {
  useAckUrgentFlag,
  useAddAssignmentAssistant,
  useAssignServiceRequest,
  useCancelServiceRequest,
  useConfirmProviderHandoff,
  useRaiseUrgentFlag,
  useReportServiceToProvider,
  useResolveUrgentFlag,
  useReviewServiceRequest,
  useSignedServiceEvidenceUrl,
} from '../api/services'

/* ─── Private Evidence Photo Preview Card ─────────────────────────────────── */

export function ServiceEvidenceThumbnail({
  path,
  canLoadImage,
}: {
  path: string
  canLoadImage: boolean
}) {
  const { data: signedUrl, isLoading, isError } = useSignedServiceEvidenceUrl(path, canLoadImage)
  const fileName = path.split('/').at(-1) ?? 'evidence-photo'

  if (!canLoadImage) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-xs text-muted">
        <ImageIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">Evidence photo attached (restricted access)</span>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-28 items-center justify-center rounded-md border border-line bg-canvas text-xs text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
        Loading photo...
      </div>
    )
  }

  if (isError || !signedUrl) {
    return (
      <div className="flex h-28 items-center justify-center rounded-md border border-line bg-canvas px-3 text-center text-xs text-muted">
        Evidence photo unavailable ({fileName.slice(0, 12)})
      </div>
    )
  }

  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-md border border-line bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald"
    >
      <img
        src={signedUrl}
        alt={`Service visit evidence ${fileName}`}
        className="h-28 w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
      />
      <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-sidebar/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
        <ExternalLink className="h-2.5 w-2.5" />
        Open
      </span>
    </a>
  )
}

/* ─── Dispatch / Reassign Crew Dialog ─────────────────────────────────────── */

export function DispatchCrewDialog({
  open,
  onOpenChange,
  requestId,
  expectedVersion,
  candidates,
  initialLeadId = '',
  initialAssistantIds = [],
  isReassign = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestId: string
  expectedVersion: number
  candidates: DispatchCandidate[]
  initialLeadId?: string
  initialAssistantIds?: string[]
  isReassign?: boolean
}) {
  const { toast } = useToast()
  const assignMutation = useAssignServiceRequest()
  const [leadProfileId, setLeadProfileId] = useState(initialLeadId)
  const [assistantIds, setAssistantIds] = useState<string[]>(initialAssistantIds)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLeadProfileId(initialLeadId)
      setAssistantIds(initialAssistantIds.filter((id) => id !== initialLeadId))
      setNote('')
      setFormError(null)
    }
  }, [open, initialLeadId, initialAssistantIds])

  const handleSelectLead = (nextLead: string) => {
    setLeadProfileId(nextLead)
    setAssistantIds((prev) => prev.filter((id) => id !== nextLead))
  }

  const toggleAssistant = (profileId: string, checked: boolean) => {
    setAssistantIds((prev) =>
      checked ? [...new Set([...prev, profileId])] : prev.filter((id) => id !== profileId),
    )
  }

  const handleSubmit = async () => {
    setFormError(null)
    if (!leadProfileId) {
      setFormError('Select a Lead Engineer to own execution for this crew episode.')
      return
    }
    try {
      const env = await assignMutation.mutateAsync({
        id: requestId,
        leadProfileId,
        assistantProfileIds: assistantIds,
        note: note.trim() || null,
        expectedVersion,
      })
      toast(
        env.replayed
          ? 'Crew assignment already confirmed by server'
          : isReassign
            ? 'New crew episode assigned cleanly'
            : 'Crew assigned cleanly',
        { tone: 'success' },
      )
      onOpenChange(false)
    } catch (error) {
      if (isAbortError(error)) return
      setFormError(extractErrorMessage(error))
    }
  }

  const leadOptions = candidates.map((c) => ({
    value: c.profile_id,
    label: c.employee_number ? `${c.display_name} (${c.employee_number})` : c.display_name,
  }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={Boolean(note.trim() || leadProfileId !== initialLeadId)}
      title={isReassign ? 'Reassign Crew (New Episode)' : 'Assign Crew'}
      description={
        isReassign
          ? 'Reassignment ends the current crew episode cleanly without deleting completed history. Pick a Lead Engineer and optional assistants.'
          : 'Select one Lead Engineer who owns execution milestones and optional crew assistants.'
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={assignMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            {isReassign ? 'Confirm Reassignment' : 'Assign Crew'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FormGroup label="Lead Engineer" required>
          <Select
            value={leadProfileId}
            onValueChange={handleSelectLead}
            options={leadOptions}
            placeholder="Select Lead Engineer"
          />
        </FormGroup>

        <FormGroup
          label="Crew Assistants (Optional)"
          hint="Assistants can log their own notes and photos while the Lead runs the visit."
        >
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-line bg-canvas p-2.5">
            {candidates
              .filter((c) => c.profile_id !== leadProfileId)
              .map((candidate) => (
                <Checkbox
                  key={candidate.profile_id}
                  checked={assistantIds.includes(candidate.profile_id)}
                  onCheckedChange={(checked) =>
                    toggleAssistant(candidate.profile_id, Boolean(checked))
                  }
                  label={
                    candidate.employee_number
                      ? `${candidate.display_name} (${candidate.employee_number})`
                      : candidate.display_name
                  }
                />
              ))}
            {candidates.filter((c) => c.profile_id !== leadProfileId).length === 0 && (
              <p className="text-xs text-muted">No additional active candidates available.</p>
            )}
          </div>
        </FormGroup>

        <FormGroup label={isReassign ? 'Reassignment Reason / Note' : 'Dispatch Note'}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Site access notes, equipment reminder, or handover reason..."
          />
        </FormGroup>

        {formError && (
          <p role="alert" className="text-xs font-medium text-rose">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/* ─── Add Mid-Episode Assistant Dialog ────────────────────────────────────── */

export function AddAssistantDialog({
  open,
  onOpenChange,
  requestId,
  expectedVersion,
  candidates,
  existingMemberIds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestId: string
  expectedVersion: number
  candidates: DispatchCandidate[]
  existingMemberIds: string[]
}) {
  const { toast } = useToast()
  const addMutation = useAddAssignmentAssistant()
  const [assistantId, setAssistantId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setAssistantId('')
      setFormError(null)
    }
  }, [open])

  const available = candidates
    .filter((c) => !existingMemberIds.includes(c.profile_id))
    .map((c) => ({
      value: c.profile_id,
      label: c.employee_number ? `${c.display_name} (${c.employee_number})` : c.display_name,
    }))

  const handleSubmit = async () => {
    setFormError(null)
    if (!assistantId) {
      setFormError('Select an assistant to add to the active crew.')
      return
    }
    try {
      const env = await addMutation.mutateAsync({
        id: requestId,
        assistantProfileId: assistantId,
        expectedVersion,
      })
      toast(env.replayed ? 'Assistant already added to crew' : 'Assistant added to active crew', {
        tone: 'success',
      })
      onOpenChange(false)
    } catch (error) {
      if (isAbortError(error)) return
      setFormError(extractErrorMessage(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Crew Assistant"
      description="Add an assistant onto the current assignment episode without interrupting the active visit."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={addMutation.isPending}
            disabled={available.length === 0}
            onClick={() => void handleSubmit()}
          >
            Add Assistant
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormGroup label="Assistant Technician" required>
          <Select
            value={assistantId}
            onValueChange={setAssistantId}
            options={available}
            placeholder={
              available.length > 0 ? 'Select engineer to add' : 'All candidates already on crew'
            }
          />
        </FormGroup>
        {formError && (
          <p role="alert" className="text-xs font-medium text-rose">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/* ─── Coordinator Review Dialog ───────────────────────────────────────────── */

export function CoordinatorReviewDialog({
  open,
  onOpenChange,
  requestId,
  expectedVersion,
  initialDecision = 'approve',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestId: string
  expectedVersion: number
  initialDecision?: 'approve' | 'request_rework'
}) {
  const { toast } = useToast()
  const reviewMutation = useReviewServiceRequest()
  const [decision, setDecision] = useState<'approve' | 'request_rework'>(initialDecision)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDecision(initialDecision)
      setNote('')
      setFormError(null)
    }
  }, [open, initialDecision])

  const handleSubmit = async () => {
    setFormError(null)
    if (decision === 'request_rework' && note.trim().length < 5) {
      setFormError('Enter a rework explanation (at least 5 characters) before returning.')
      return
    }
    try {
      const env = await reviewMutation.mutateAsync({
        id: requestId,
        decision,
        note: note.trim() || null,
        expectedVersion,
      })
      toast(
        env.replayed
          ? 'Review decision already recorded'
          : decision === 'approve'
            ? 'Work approved for provider reporting'
            : 'Returned to Follow-Up Required for rework',
        { tone: 'success' },
      )
      onOpenChange(false)
    } catch (error) {
      if (isAbortError(error)) return
      setFormError(extractErrorMessage(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={Boolean(note.trim())}
      title="Coordinator Work Review"
      description="Non-self-review is strictly enforced across all visit episodes. Approve completed work or return it for rework."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={decision === 'approve' ? 'primary' : 'danger'}
            loading={reviewMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            {decision === 'approve' ? 'Approve Work' : 'Return for Rework'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FormGroup label="Review Decision" required>
          <Select
            value={decision}
            onValueChange={(v) => setDecision(v as 'approve' | 'request_rework')}
            options={[
              { value: 'approve', label: 'Approve Completed Work' },
              { value: 'request_rework', label: 'Request Rework (Return Visit)' },
            ]}
          />
        </FormGroup>
        <FormGroup
          label={decision === 'request_rework' ? 'Rework Instructions' : 'Review Note (Optional)'}
          required={decision === 'request_rework'}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              decision === 'request_rework'
                ? 'Explain what still needs fixing or re-testing on site...'
                : 'Optional sign-off remarks for Service Desk...'
            }
          />
        </FormGroup>
        {formError && (
          <p role="alert" className="text-xs font-medium text-rose">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/* ─── Provider Report & Handoff Confirmation Dialog ───────────────────────── */

export function ProviderHandoffDialog({
  open,
  onOpenChange,
  mode,
  requestId,
  expectedVersion,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'report' | 'confirm'
  requestId: string
  expectedVersion: number
}) {
  const { toast } = useToast()
  const reportMutation = useReportServiceToProvider()
  const confirmMutation = useConfirmProviderHandoff()
  const [decision, setDecision] = useState<'confirmed' | 'revisit_required'>('confirmed')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDecision('confirmed')
      setNote('')
      setFormError(null)
    }
  }, [open])

  const isPending = reportMutation.isPending || confirmMutation.isPending

  const handleSubmit = async () => {
    setFormError(null)
    if (mode === 'confirm' && decision === 'revisit_required' && note.trim().length < 5) {
      setFormError('Enter the provider feedback explaining why a revisit is required.')
      return
    }
    try {
      if (mode === 'report') {
        const env = await reportMutation.mutateAsync({
          id: requestId,
          note: note.trim() || null,
          expectedVersion,
        })
        toast(
          env.replayed
            ? 'Provider report already logged'
            : 'Completion reported to internet provider',
          { tone: 'success' },
        )
      } else {
        const env = await confirmMutation.mutateAsync({
          id: requestId,
          decision,
          note: note.trim() || null,
          expectedVersion,
        })
        toast(
          env.replayed
            ? 'Provider outcome already logged'
            : decision === 'confirmed'
              ? 'Provider confirmation recorded — ticket closed'
              : 'Ticket reopened as Follow-Up Required for provider revisit',
          { tone: 'success' },
        )
      }
      onOpenChange(false)
    } catch (error) {
      if (isAbortError(error)) return
      setFormError(extractErrorMessage(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={Boolean(note.trim())}
      title={mode === 'report' ? 'Report Completion to Provider' : 'Record Provider Outcome'}
      description={
        mode === 'report'
          ? 'Log when Service Desk sent completion evidence/details back to the ISP.'
          : 'Confirm ISP closure or reopen the request for another field revisit.'
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={mode === 'confirm' && decision === 'revisit_required' ? 'danger' : 'primary'}
            loading={isPending}
            onClick={() => void handleSubmit()}
          >
            {mode === 'report'
              ? 'Record Reported to Provider'
              : decision === 'confirmed'
                ? 'Confirm Provider Closure'
                : 'Reopen for Revisit'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {mode === 'confirm' && (
          <FormGroup label="Provider Handoff Decision" required>
            <Select
              value={decision}
              onValueChange={(v) => setDecision(v as 'confirmed' | 'revisit_required')}
              options={[
                { value: 'confirmed', label: 'Provider Confirmed (Close Ticket)' },
                { value: 'revisit_required', label: 'Revisit Required (Reopen Work)' },
              ]}
            />
          </FormGroup>
        )}
        <FormGroup
          label={
            mode === 'confirm' && decision === 'revisit_required'
              ? 'Provider Feedback / Revisit Reason'
              : 'Handoff Note (Optional)'
          }
          required={mode === 'confirm' && decision === 'revisit_required'}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mode === 'report'
                ? 'ISP ticket portal ref / email recipient / confirmation timestamp notes...'
                : 'ISP sign-off code or reason for revisit...'
            }
          />
        </FormGroup>
        {formError && (
          <p role="alert" className="text-xs font-medium text-rose">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/* ─── Cancel Request Dialog ───────────────────────────────────────────────── */

export function CancelRequestDialog({
  open,
  onOpenChange,
  requestId,
  expectedVersion,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestId: string
  expectedVersion: number
}) {
  const { toast } = useToast()
  const cancelMutation = useCancelServiceRequest()
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReason('')
      setFormError(null)
    }
  }, [open])

  const handleSubmit = async () => {
    setFormError(null)
    if (reason.trim().length < 5) {
      setFormError('Cancellation reason must contain at least 5 characters.')
      return
    }
    try {
      const env = await cancelMutation.mutateAsync({
        id: requestId,
        reason: reason.trim(),
        expectedVersion,
      })
      toast(env.replayed ? 'Cancellation already confirmed' : 'Service request cancelled', {
        tone: 'success',
      })
      onOpenChange(false)
    } catch (error) {
      if (isAbortError(error)) return
      setFormError(extractErrorMessage(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={Boolean(reason.trim())}
      title="Cancel Service Request"
      description="Cancelling closes the ticket cleanly. Open in-progress visits cannot be cancelled while underway."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Keep Request
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={cancelMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            Confirm Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormGroup label="Cancellation Reason" required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Duplicate request from ISP, cancelled by customer, etc."
          />
        </FormGroup>
        {formError && (
          <p role="alert" className="text-xs font-medium text-rose">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/* ─── Urgent Flag Raise / Ack / Resolve Dialog ────────────────────────────── */

export function UrgentFlagDialog({
  open,
  onOpenChange,
  mode,
  serviceRequestId,
  visitId,
  flag,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'raise' | 'ack' | 'resolve'
  serviceRequestId: string
  visitId?: string | null
  flag?: ServiceUrgentFlag | null
}) {
  const { toast } = useToast()
  const raiseMutation = useRaiseUrgentFlag()
  const ackMutation = useAckUrgentFlag()
  const resolveMutation = useResolveUrgentFlag()
  const [reasonCode, setReasonCode] = useState<ServiceUrgentReasonCode>('safety_hazard')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setReasonCode('safety_hazard')
      setNote('')
      setFormError(null)
    }
  }, [open, mode, flag?.id])

  const isPending = raiseMutation.isPending || ackMutation.isPending || resolveMutation.isPending

  const handleSubmit = async () => {
    setFormError(null)
    if (mode === 'raise' && (note.trim().length < 5 || note.trim().length > 1000)) {
      setFormError('Urgent summary must be between 5 and 1000 characters.')
      return
    }
    try {
      if (mode === 'raise') {
        await raiseMutation.mutateAsync({
          serviceRequestId,
          visitId: visitId ?? null,
          reasonCode,
          summary: note.trim(),
        })
        toast('Urgent flag raised and alerts logged', { tone: 'info' })
      } else if (mode === 'ack' && flag) {
        await ackMutation.mutateAsync({
          flagId: flag.id,
          note: note.trim() || null,
          expectedVersion: flag.version,
        })
        toast('Urgent flag acknowledged', { tone: 'success' })
      } else if (mode === 'resolve' && flag) {
        await resolveMutation.mutateAsync({
          flagId: flag.id,
          note: note.trim() || null,
          expectedVersion: flag.version,
        })
        toast('Urgent flag resolved', { tone: 'success' })
      }
      onOpenChange(false)
    } catch (error) {
      if (isAbortError(error)) return
      setFormError(extractErrorMessage(error))
    }
  }

  const title =
    mode === 'raise'
      ? 'Raise Urgent Flag'
      : mode === 'ack'
        ? 'Acknowledge Urgent Flag'
        : 'Resolve Urgent Flag'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={Boolean(note.trim())}
      title={title}
      description={
        mode === 'raise'
          ? 'Alerts dispatch coordinators independently of request status. Use for safety hazards, blocked access, or severe ISP escalations.'
          : flag?.summary
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={mode === 'raise' ? 'danger' : 'primary'}
            loading={isPending}
            onClick={() => void handleSubmit()}
          >
            {title}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {mode === 'raise' && (
          <FormGroup label="Reason Code" required>
            <Select
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v as ServiceUrgentReasonCode)}
              options={SERVICE_URGENT_REASON_CODES.map((code) => ({
                value: code,
                label: SERVICE_URGENT_REASON_LABELS[code],
              }))}
            />
          </FormGroup>
        )}
        <FormGroup
          label={mode === 'raise' ? 'What requires urgent attention?' : 'Action Note (Optional)'}
          required={mode === 'raise'}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mode === 'raise'
                ? 'Describe the hazard, access obstruction, or escalation clearly...'
                : 'Optional note on mitigation or resolution...'
            }
          />
        </FormGroup>
        {formError && (
          <p role="alert" className="text-xs font-medium text-rose">
            {formError}
          </p>
        )}
      </div>
    </Dialog>
  )
}
