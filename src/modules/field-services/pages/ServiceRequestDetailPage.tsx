import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileCheck2,
  MapPin,
  Phone,
  Play,
  RefreshCw,
  Send,
  Upload,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { FormGroup, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Checkbox } from '@/components/ui/Toggles'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_SOURCE_LABELS,
  SERVICE_URGENT_REASON_LABELS,
  type ServiceChecklistItem,
  type ServiceRequestDetail,
  type ServiceUrgentFlag,
  type ServiceVisit,
} from '../schemas/services'
import {
  extractErrorMessage,
  isAbortError,
} from '../lib/pendingOperations'
import {
  SERVICE_EVIDENCE_ALLOWED_MIMES,
  getEffectiveServiceAccess,
  hasParticipatedInRequest,
  useAcceptServiceRequest,
  useCompleteServiceVisit,
  useDispatchCandidates,
  useLogAssistantVisitContribution,
  useSaveServiceVisit,
  useServiceChecklists,
  useServiceRequestDetail,
  useStartServiceVisit,
  useSubmitServiceRequest,
} from '../api/services'
import {
  PendingServiceOperationsBanner,
  ServicePriorityPill,
  ServiceStatusPill,
  ServiceTimestamp,
  ServiceTypeBadge,
  UrgentFlagBadge,
  ViewerScopeNotice,
} from '../components/ServiceBadges'
import {
  AddAssistantDialog,
  CancelRequestDialog,
  CoordinatorReviewDialog,
  DispatchCrewDialog,
  ProviderHandoffDialog,
  ServiceEvidenceThumbnail,
  UrgentFlagDialog,
} from '../components/ServiceModals'
import { UrgentDeliveryStatusPanel } from '../components/UrgentDeliveryStatusPanel'
import { ServiceRequestRoutersPanel } from '@/modules/warehouse/router-float/ServiceRequestRoutersPanel'

function resolveSafeBackPath(rawFrom: string | null, canReadAll: boolean): { path: string; label: string } {
  if (rawFrom && rawFrom.startsWith('/services') && !rawFrom.startsWith('//')) {
    const label = rawFrom.startsWith('/services/my-jobs')
      ? 'Back to My Jobs'
      : rawFrom.startsWith('/services/intake')
        ? 'Back to Intake'
        : rawFrom.startsWith('/services/monitor')
          ? 'Back to Monitor'
          : 'Back to Queue'
    return { path: rawFrom, label }
  }
  return canReadAll
    ? { path: '/services/dispatch', label: 'Back to Queue' }
    : { path: '/services/my-jobs', label: 'Back to My Jobs' }
}

interface LeadDraftBaseline {
  checklist: Record<string, boolean>
  workNotes: string
  followUpReason: string
  keptPaths: string[]
  signature: string
}

interface AssistantDraftBaseline {
  note: string
  keptPaths: string[]
  signature: string
}

function normalizeBooleanChecklist(raw: Record<string, unknown> | undefined | null): Record<string, boolean> {
  const normalized: Record<string, boolean> = {}
  if (!raw) return normalized
  for (const key of Object.keys(raw).sort()) {
    if (typeof raw[key] === 'boolean') {
      normalized[key] = raw[key]
    }
  }
  return normalized
}

function buildLeadDraftBaseline(
  checklist: Record<string, boolean>,
  workNotes: string,
  followUpReason: string,
  keptPaths: string[],
): LeadDraftBaseline {
  const sortedChecks = normalizeBooleanChecklist(checklist)
  return {
    checklist: sortedChecks,
    workNotes,
    followUpReason,
    keptPaths: [...keptPaths],
    signature: JSON.stringify({
      checklist: sortedChecks,
      workNotes,
      followUpReason,
      keptPaths,
    }),
  }
}

function buildAssistantDraftBaseline(note: string, keptPaths: string[]): AssistantDraftBaseline {
  return {
    note,
    keptPaths: [...keptPaths],
    signature: JSON.stringify({ note, keptPaths }),
  }
}

function DraftConflictBanner({
  title,
  description,
  onLoadServer,
  onKeepDraft,
  busy,
}: {
  title: string
  description: string
  onLoadServer: () => void
  onKeepDraft: () => void
  busy: boolean
}) {
  return (
    <div
      role="alert"
      data-testid="visit-draft-conflict-banner"
      className="flex flex-col gap-3 rounded-md border border-amber/60 bg-amber-tint/50 p-3.5 text-xs text-ink sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="space-y-0.5">
        <p className="font-semibold flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber shrink-0" />
          {title}
        </p>
        <p className="text-soft">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onLoadServer}>
          Load Server Version
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onKeepDraft}>
          Keep Editing My Draft
        </Button>
      </div>
    </div>
  )
}

function LeadOpenVisitPanel({
  detail,
  visit,
  checklistItems,
  checklistProvisional,
}: {
  detail: ServiceRequestDetail
  visit: ServiceVisit
  checklistItems: ServiceChecklistItem[]
  checklistProvisional: boolean
}) {
  const { toast } = useToast()
  const saveVisit = useSaveServiceVisit()
  const completeVisit = useCompleteServiceVisit()

  const serverSnapshot = buildLeadDraftBaseline(
    normalizeBooleanChecklist(visit.checklist),
    visit.work_notes ?? '',
    visit.follow_up_reason ?? '',
    visit.photo_paths ?? [],
  )

  const [serverBaseline, setServerBaseline] = useState<LeadDraftBaseline>(() => serverSnapshot)
  const prevServerSigRef = useRef(serverSnapshot.signature)
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    () => serverSnapshot.checklist,
  )
  const [workNotes, setWorkNotes] = useState(() => serverSnapshot.workNotes)
  const [followUpReason, setFollowUpReason] = useState(() => serverSnapshot.followUpReason)
  const [keptPaths, setKeptPaths] = useState<string[]>(() => serverSnapshot.keptPaths)
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [dismissedConflictSig, setDismissedConflictSig] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)

  const localSignature = buildLeadDraftBaseline(
    checklist,
    workNotes,
    followUpReason,
    keptPaths,
  ).signature
  const isDirty = localSignature !== serverBaseline.signature || newFiles.length > 0
  const ownedServerChanged = serverSnapshot.signature !== serverBaseline.signature
  const showConflictBanner =
    isDirty && ownedServerChanged && dismissedConflictSig !== serverSnapshot.signature

  const applyServerSnapshot = (snapshot: LeadDraftBaseline) => {
    setChecklist(snapshot.checklist)
    setWorkNotes(snapshot.workNotes)
    setFollowUpReason(snapshot.followUpReason)
    setKeptPaths(snapshot.keptPaths)
    setNewFiles([])
    setServerBaseline(snapshot)
    setDismissedConflictSig(null)
    setPanelError(null)
  }

  useEffect(() => {
    if (serverSnapshot.signature === prevServerSigRef.current) return
    prevServerSigRef.current = serverSnapshot.signature
    if (!isDirty) {
      applyServerSnapshot(serverSnapshot)
    }
  }, [serverSnapshot.signature, isDirty])

  const checkedCount = Object.values(checklist).filter(Boolean).length

  const handleFileChange = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const selected = Array.from(files)
    setNewFiles((prev) => [...prev, ...selected])
  }

  const handleSaveDraft = async () => {
    setPanelError(null)
    try {
      const env = await saveVisit.mutateAsync({
        visitId: visit.id,
        checklist,
        workNotes: workNotes.trim(),
        keptPhotoPaths: keptPaths,
        newPhotoFiles: newFiles,
        expectedVisitVersion: visit.version,
      })
      const savedNotes = workNotes.trim()
      const savedPaths = Array.isArray(env.result?.photo_paths)
        ? env.result.photo_paths.filter((p): p is string => typeof p === 'string')
        : keptPaths
      const confirmedBaseline = buildLeadDraftBaseline(
        checklist,
        savedNotes,
        followUpReason,
        savedPaths,
      )
      setWorkNotes(savedNotes)
      setKeptPaths(savedPaths)
      setNewFiles([])
      setServerBaseline(confirmedBaseline)
      setDismissedConflictSig(null)
      toast(env.replayed ? 'Visit draft already saved' : 'Visit draft & evidence saved', {
        tone: 'success',
      })
    } catch (error) {
      if (isAbortError(error)) return
      setPanelError(extractErrorMessage(error))
    }
  }

  const handleComplete = async (outcome: 'completed' | 'follow_up_required') => {
    setPanelError(null)
    if (outcome === 'completed') {
      if (checkedCount < 1) {
        setPanelError('Tick at least one verified checklist item before marking Completed.')
        return
      }
      if (workNotes.trim().length < 5) {
        setPanelError(
          'Enter meaningful work notes (at least 5 characters). Tick-boxes alone cannot declare work successful.',
        )
        return
      }
    } else if (followUpReason.trim().length < 5) {
      setPanelError('Enter a clear follow-up reason (at least 5 characters).')
      return
    }

    try {
      const env = await completeVisit.mutateAsync({
        visitId: visit.id,
        outcome,
        checklist,
        workNotes: workNotes.trim(),
        keptPhotoPaths: keptPaths,
        newPhotoFiles: newFiles,
        followUpReason: outcome === 'follow_up_required' ? followUpReason.trim() : null,
        expectedVisitVersion: visit.version,
        expectedRequestVersion: detail.version,
      })
      setNewFiles([])
      toast(
        env.replayed
          ? 'Visit completion already confirmed'
          : outcome === 'completed'
            ? 'Work completed and sent for coordinator review'
            : 'Follow-up required recorded',
        { tone: 'success' },
      )
    } catch (error) {
      if (isAbortError(error)) return
      setPanelError(extractErrorMessage(error))
    }
  }

  const busy = saveVisit.isPending || completeVisit.isPending

  return (
    <div className="rounded-lg border border-emerald/40 bg-surface p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <h3 className="font-display text-base font-bold text-ink">
            Active Field Visit #{visit.visit_number} (Lead Execution)
          </h3>
          <p className="text-xs text-soft">
            Started <ServiceTimestamp value={visit.arrival_at} /> · Up to 10 private photos
            supported (JPEG, PNG, WebP, HEIC, AVIF — PDFs rejected).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDirty && (
            <span className="rounded-full bg-blue-tint px-2.5 py-0.5 text-[11px] font-medium text-blue">
              Unsaved edits
            </span>
          )}
          {checklistProvisional && (
            <span className="rounded-full bg-amber-tint px-2.5 py-0.5 text-[11px] font-medium text-amber">
              Provisional Checklist
            </span>
          )}
        </div>
      </div>

      {showConflictBanner && (
        <DraftConflictBanner
          title="Saved visit data updated on the server"
          description="Your unsaved Lead notes, checklist changes, and queued photos are preserved below. Load the server version or continue editing your draft."
          busy={busy}
          onLoadServer={() => applyServerSnapshot(serverSnapshot)}
          onKeepDraft={() => setDismissedConflictSig(serverSnapshot.signature)}
        />
      )}

      {checklistItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-soft">Work Verification Checklist</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {checklistItems.map((item) => (
              <div key={item.key} className="rounded-md border border-line bg-canvas p-2.5">
                <Checkbox
                  checked={Boolean(checklist[item.key])}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    setChecklist((prev) => ({ ...prev, [item.key]: Boolean(checked) }))
                  }
                  label={item.label}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <FormGroup
        label="Field Work Notes & Readings (Required for Completion)"
        hint="Record optical power, cable route, serial numbers, or fault tests (min 5 characters)."
      >
        <Textarea
          value={workNotes}
          disabled={busy}
          onChange={(e) => setWorkNotes(e.target.value)}
          placeholder="Document work done, signal readings, and customer handover checks..."
        />
      </FormGroup>

      <FormGroup label="Follow-Up Reason (Only if Return Visit Needed)">
        <Textarea
          value={followUpReason}
          disabled={busy}
          onChange={(e) => setFollowUpReason(e.target.value)}
          placeholder="e.g. Customer unavailable, blocked duct, waiting splicing team..."
        />
      </FormGroup>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-soft">
            Visit Evidence Photos ({keptPaths.length + newFiles.length}/10)
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink hover:bg-line/30">
            <Upload className="h-3.5 w-3.5" />
            <span>Add Photos</span>
            <input
              type="file"
              accept={SERVICE_EVIDENCE_ALLOWED_MIMES}
              multiple
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                handleFileChange(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>

        {(keptPaths.length > 0 || newFiles.length > 0) && (
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            {keptPaths.map((p) => (
              <div key={p} className="space-y-1">
                <ServiceEvidenceThumbnail path={p} canLoadImage />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setKeptPaths((prev) => prev.filter((item) => item !== p))}
                  className="text-[11px] font-medium text-rose hover:underline"
                >
                  Remove photo
                </button>
              </div>
            ))}
            {newFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex flex-col justify-between rounded-md border border-dashed border-emerald/50 bg-emerald-tint/30 p-2.5 text-xs"
              >
                <span className="truncate font-medium text-ink">{file.name}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNewFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="mt-2 self-start text-[11px] font-medium text-rose hover:underline"
                >
                  Remove queued
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {panelError && (
        <p role="alert" className="text-xs font-medium text-rose">
          {panelError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div>
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => applyServerSnapshot(serverSnapshot)}
            >
              Discard Unsaved Edits
            </Button>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            loading={saveVisit.isPending}
            disabled={busy}
            onClick={() => void handleSaveDraft()}
          >
            Save Draft Visit
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={completeVisit.isPending && completeVisit.variables?.outcome === 'follow_up_required'}
            disabled={busy}
            onClick={() => void handleComplete('follow_up_required')}
          >
            Mark Follow-Up Required
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={completeVisit.isPending && completeVisit.variables?.outcome === 'completed'}
            disabled={busy}
            leftIcon={<CheckCircle2 className="h-4 w-4" />}
            onClick={() => void handleComplete('completed')}
          >
            Complete Work
          </Button>
        </div>
      </div>
    </div>
  )
}

function AssistantContributionPanel({
  visit,
  actorId,
}: {
  visit: ServiceVisit
  actorId: string
}) {
  const { toast } = useToast()
  const logMutation = useLogAssistantVisitContribution()
  const existing = visit.contributors.find((c) => c.profile_id === actorId)
  const serverSnapshot = buildAssistantDraftBaseline(
    existing?.note ?? '',
    existing?.photo_paths ?? [],
  )

  const [serverBaseline, setServerBaseline] = useState<AssistantDraftBaseline>(() => serverSnapshot)
  const prevServerSigRef = useRef(serverSnapshot.signature)
  const [note, setNote] = useState(() => serverSnapshot.note)
  const [keptPaths, setKeptPaths] = useState<string[]>(() => serverSnapshot.keptPaths)
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [dismissedConflictSig, setDismissedConflictSig] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const localSignature = buildAssistantDraftBaseline(note, keptPaths).signature
  const isDirty = localSignature !== serverBaseline.signature || newFiles.length > 0
  const ownedServerChanged = serverSnapshot.signature !== serverBaseline.signature
  const showConflictBanner =
    isDirty && ownedServerChanged && dismissedConflictSig !== serverSnapshot.signature

  const applyServerSnapshot = (snapshot: AssistantDraftBaseline) => {
    setNote(snapshot.note)
    setKeptPaths(snapshot.keptPaths)
    setNewFiles([])
    setServerBaseline(snapshot)
    setDismissedConflictSig(null)
    setErrorMsg(null)
  }

  useEffect(() => {
    if (serverSnapshot.signature === prevServerSigRef.current) return
    prevServerSigRef.current = serverSnapshot.signature
    if (!isDirty) {
      applyServerSnapshot(serverSnapshot)
    }
  }, [serverSnapshot.signature, isDirty])

  const handleSubmit = async () => {
    setErrorMsg(null)
    if (!note.trim() && keptPaths.length === 0 && newFiles.length === 0) {
      setErrorMsg('Add a contribution note or attach at least one evidence photo.')
      return
    }
    try {
      const env = await logMutation.mutateAsync({
        visitId: visit.id,
        note: note.trim(),
        keptPhotoPaths: keptPaths,
        newPhotoFiles: newFiles,
        expectedVisitVersion: visit.version,
      })
      const savedNote = note.trim()
      const savedPaths = Array.isArray(env.result?.photo_paths)
        ? env.result.photo_paths.filter((p): p is string => typeof p === 'string')
        : keptPaths
      const confirmedBaseline = buildAssistantDraftBaseline(savedNote, savedPaths)
      setNote(savedNote)
      setKeptPaths(savedPaths)
      setNewFiles([])
      setServerBaseline(confirmedBaseline)
      setDismissedConflictSig(null)
      toast(
        env.replayed ? 'Contribution already logged' : 'Assistant contribution & evidence saved',
        { tone: 'success' },
      )
    } catch (error) {
      if (isAbortError(error)) return
      setErrorMsg(extractErrorMessage(error))
    }
  }

  return (
    <div className="rounded-lg border border-blue/40 bg-surface p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-ink">
            Assistant Crew Contribution — Visit #{visit.visit_number}
          </h3>
          <p className="text-xs text-soft">
            Log your own notes and photos independently while Lead Engineer ({visit.lead_name}) runs
            the main visit checklist.
          </p>
        </div>
        {isDirty && (
          <span className="rounded-full bg-blue-tint px-2.5 py-0.5 text-[11px] font-medium text-blue">
            Unsaved edits
          </span>
        )}
      </div>

      {showConflictBanner && (
        <DraftConflictBanner
          title="Your saved contribution changed on the server"
          description="Your unsaved Assistant note and queued photos are preserved below. Load the server version or continue editing your draft."
          busy={logMutation.isPending}
          onLoadServer={() => applyServerSnapshot(serverSnapshot)}
          onKeepDraft={() => setDismissedConflictSig(serverSnapshot.signature)}
        />
      )}

      <FormGroup label="My Assistant Work Note">
        <Textarea
          value={note}
          disabled={logMutation.isPending}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Document cabling assistance, pole work, splice tray setup, or test support..."
        />
      </FormGroup>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-soft">
            My Contribution Photos ({keptPaths.length + newFiles.length}/10)
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink hover:bg-line/30">
            <Upload className="h-3.5 w-3.5" />
            <span>Add Photos</span>
            <input
              type="file"
              accept={SERVICE_EVIDENCE_ALLOWED_MIMES}
              multiple
              disabled={logMutation.isPending}
              className="sr-only"
              onChange={(e) => {
                const selected = e.target.files ? Array.from(e.target.files) : []
                if (selected.length > 0) {
                  setNewFiles((prev) => [...prev, ...selected])
                }
                e.target.value = ''
              }}
            />
          </label>
        </div>

        {(keptPaths.length > 0 || newFiles.length > 0) && (
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            {keptPaths.map((p) => (
              <div key={p} className="space-y-1">
                <ServiceEvidenceThumbnail path={p} canLoadImage />
                <button
                  type="button"
                  disabled={logMutation.isPending}
                  onClick={() => setKeptPaths((prev) => prev.filter((item) => item !== p))}
                  className="text-[11px] font-medium text-rose hover:underline"
                >
                  Remove photo
                </button>
              </div>
            ))}
            {newFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex flex-col justify-between rounded-md border border-dashed border-blue/50 bg-blue-tint/30 p-2.5 text-xs"
              >
                <span className="truncate font-medium text-ink">{file.name}</span>
                <button
                  type="button"
                  disabled={logMutation.isPending}
                  onClick={() => setNewFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="mt-2 self-start text-[11px] font-medium text-rose hover:underline"
                >
                  Remove queued
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {errorMsg && (
        <p role="alert" className="text-xs font-medium text-rose">
          {errorMsg}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={logMutation.isPending}
              onClick={() => applyServerSnapshot(serverSnapshot)}
            >
              Discard Unsaved Edits
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="primary"
          loading={logMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          Save Assistant Contribution
        </Button>
      </div>
    </div>
  )
}

const serviceActivity: Record<string, string> = {
  draft_created: 'created the service request',
  draft_updated: 'updated the draft request',
  request_submitted: 'submitted the request for dispatch',
  request_accepted: 'accepted the request',
  request_cancelled: 'cancelled the request',
  crew_assigned: 'assigned a crew',
  crew_reassigned: 'reassigned the job',
  visit_superseded_by_reassignment: 'closed the visit when the job was reassigned',
  assistant_added: 'added an assistant to the crew',
  visit_started: 'started a site visit',
  visit_saved: 'saved the visit details',
  visit_completed: 'completed a site visit',
  visit_follow_up_required: 'recorded that a follow-up visit is needed',
  assistant_contribution_logged: 'added notes or evidence to the visit',
  coordinator_approved: 'approved the completed work',
  coordinator_requested_rework: 'asked for more work',
  reported_to_provider: 'reported the work to the provider',
  provider_confirmed: 'recorded the provider’s confirmation',
  provider_requested_revisit: 'recorded the provider’s request for another visit',
  urgent_flag_raised: 'raised an urgent alert',
  urgent_flag_acknowledged: 'acknowledged the urgent alert',
  urgent_flag_resolved: 'resolved the urgent alert',
}

export function ServiceRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const auth = useAuth()
  const { actorId, hasPermission } = getEffectiveServiceAccess(auth)

  const canReadAll = hasPermission('service_requests.read')
  const canIntake = hasPermission('service_requests.intake')
  const canDispatch = hasPermission('service_requests.dispatch')
  const canReview = hasPermission('service_requests.review')
  const canReport = hasPermission('service_requests.report_provider')
  const canWork = hasPermission('service_visits.work_assigned')
  const canReadEvidence = hasPermission('service_evidence.read')
  const canAckUrgent = hasPermission('service_alerts.ack')
  const canResolveUrgent = hasPermission('service_alerts.resolve')

  const detailQuery = useServiceRequestDetail(id)
  const checklistsQuery = useServiceChecklists()
  const candidatesQuery = useDispatchCandidates(canDispatch)

  const submitMutation = useSubmitServiceRequest()
  const acceptMutation = useAcceptServiceRequest()
  const startVisitMutation = useStartServiceVisit()

  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [addAssistantOpen, setAddAssistantOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewDecision, setReviewDecision] = useState<'approve' | 'request_rework'>('approve')
  const [handoffMode, setHandoffMode] = useState<'report' | 'confirm' | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [urgentModal, setUrgentModal] = useState<{
    mode: 'raise' | 'ack' | 'resolve'
    flag?: ServiceUrgentFlag
  } | null>(null)

  const highlightedUrgentId = searchParams.get('urgent')
  const backTarget = resolveSafeBackPath(searchParams.get('from'), canReadAll)

  useEffect(() => {
    if (!highlightedUrgentId || !detailQuery.data) return
    const targetEl = document.getElementById(`urgent-flag-${highlightedUrgentId}`)
    targetEl?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [highlightedUrgentId, detailQuery.data])

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton shape="kpi" className="w-72" />
        <Skeleton shape="card" className="h-44" />
        <Skeleton shape="card" className="h-64" />
      </div>
    )
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="space-y-4">
        <Link to={backTarget.path}>
          <Button type="button" variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />}>
            {backTarget.label}
          </Button>
        </Link>
        <EmptyState
          title="Service request unavailable"
          description={detailQuery.error?.message ?? 'You may not have access to this ticket.'}
        />
      </div>
    )
  }

  const detail = detailQuery.data
  const checklistDefs = checklistsQuery.data
  const activeChecklistItems = checklistDefs
    ? detail.request_type === 'installation'
      ? checklistDefs.installation
      : checklistDefs.maintenance
    : []

  const openVisit =
    detail.visits.find(
      (v) => v.visit_status === 'in_progress' && v.assignment_id === detail.active_assignment_id,
    ) ?? null

  const participatedSelfReviewBlocked = hasParticipatedInRequest(detail, actorId)
  const canStartVisit =
    canWork &&
    detail.my_assignment_role === 'lead' &&
    detail.active_assignment_id !== null &&
    !openVisit &&
    ['assigned', 'follow_up_required'].includes(detail.status)

  const canRaiseUrgent =
    !['draft', 'cancelled'].includes(detail.status) &&
    (canDispatch ||
      canIntake ||
      (canWork && detail.viewer_scope !== 'historical_participant' && detail.my_assignment_role !== null))

  const canCancel =
    !openVisit &&
    ((canDispatch &&
      ['draft', 'submitted', 'assigned', 'follow_up_required'].includes(detail.status)) ||
      (canIntake && detail.status === 'draft'))

  const canLoadVisitImage = (visit: ServiceVisit) =>
    canReadEvidence ||
    detail.viewer_scope === 'active_assigned' ||
    (Boolean(actorId) && visit.lead_profile_id === actorId)

  const canLoadContributorImage = (contributorProfileId: string) =>
    canReadEvidence ||
    detail.viewer_scope === 'active_assigned' ||
    (Boolean(actorId) && contributorProfileId === actorId)

  const currentLead = detail.active_crew.find((m) => m.assignment_role === 'lead')
  const currentAssistantIds = detail.active_crew
    .filter((m) => m.assignment_role === 'assistant')
    .map((m) => m.profile_id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link to={backTarget.path}>
          <Button type="button" variant="ghost" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />}>
            {backTarget.label}
          </Button>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => void detailQuery.refetch()}
        >
          Refresh
        </Button>
      </div>

      <PageHeader
        title={`${detail.internal_code} · ${detail.site_name}`}
        subtitle={`${detail.provider_name}${detail.provider_reference ? ` · Ref ${detail.provider_reference}` : ''} · ${detail.area_label}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {detail.status === 'draft' && canIntake && (
              <>
                <Link to={`/services/intake?draft=${detail.id}`}>
                  <Button type="button" variant="outline" size="sm">
                    Edit Draft
                  </Button>
                </Link>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={submitMutation.isPending}
                  leftIcon={<Send className="h-3.5 w-3.5" />}
                  onClick={() => {
                    void submitMutation
                      .mutateAsync({ id: detail.id, expectedVersion: detail.version })
                      .then(() => toast('Submitted to Dispatch queue', { tone: 'success' }))
                      .catch((err) => {
                        if (!isAbortError(err)) toast(extractErrorMessage(err), { tone: 'danger' })
                      })
                  }}
                >
                  Submit to Dispatch
                </Button>
              </>
            )}

            {detail.status === 'submitted' && !detail.accepted_at && canDispatch && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={acceptMutation.isPending}
                onClick={() => {
                  void acceptMutation
                    .mutateAsync({ id: detail.id, expectedVersion: detail.version })
                    .then(() => toast('Request accepted into dispatch', { tone: 'success' }))
                    .catch((err) => {
                      if (!isAbortError(err)) toast(extractErrorMessage(err), { tone: 'danger' })
                    })
                }}
              >
                Accept Request
              </Button>
            )}

            {canDispatch &&
              ['submitted', 'assigned', 'in_progress', 'follow_up_required'].includes(
                detail.status,
              ) && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setDispatchOpen(true)}
                >
                  {detail.active_assignment_id ? 'Reassign Crew' : 'Assign Crew'}
                </Button>
              )}

            {canDispatch &&
              detail.active_assignment_id &&
              ['assigned', 'in_progress', 'follow_up_required'].includes(detail.status) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leftIcon={<UserPlus className="h-3.5 w-3.5" />}
                  onClick={() => setAddAssistantOpen(true)}
                >
                  Add Assistant
                </Button>
              )}

            {detail.status === 'work_completed' && canReview && !participatedSelfReviewBlocked && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<FileCheck2 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setReviewDecision('approve')
                    setReviewOpen(true)
                  }}
                >
                  Approve Work
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setReviewDecision('request_rework')
                    setReviewOpen(true)
                  }}
                >
                  Request Rework
                </Button>
              </>
            )}

            {detail.status === 'coordinator_reviewed' && canReport && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setHandoffMode('report')}
              >
                Report to Provider
              </Button>
            )}

            {detail.status === 'reported_to_provider' && canReport && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setHandoffMode('confirm')}
              >
                Record Provider Outcome
              </Button>
            )}

            {canRaiseUrgent && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                leftIcon={<AlertTriangle className="h-3.5 w-3.5" />}
                onClick={() => setUrgentModal({ mode: 'raise' })}
              >
                Raise Urgent Flag
              </Button>
            )}

            {canCancel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<XCircle className="h-3.5 w-3.5" />}
                onClick={() => setCancelOpen(true)}
              >
                Cancel Ticket
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ServiceTypeBadge requestType={detail.request_type} />
        <ServicePriorityPill priority={detail.priority} />
        <ServiceStatusPill status={detail.status} size="md" />
        {detail.active_episode_number && (
          <span className="rounded-sm border border-line bg-canvas px-2 py-0.5 text-xs font-medium text-soft tabular-nums">
            Episode #{detail.active_episode_number}
          </span>
        )}
        {detail.urgent_flags.some((f) => f.status === 'open') && (
          <UrgentFlagBadge
            status="open"
            count={detail.urgent_flags.filter((f) => f.status === 'open').length}
          />
        )}
      </div>

      <PendingServiceOperationsBanner />
      <ViewerScopeNotice scope={detail.viewer_scope} />

      {detail.status === 'work_completed' && canReview && participatedSelfReviewBlocked && (
        <div
          role="note"
          data-testid="non-self-review-notice"
          className="rounded-lg border border-amber/40 bg-amber-tint p-4 text-xs text-ink"
        >
          <p className="font-semibold">Non-Self-Review Rule Active</p>
          <p className="mt-1 text-soft">
            You participated in field visit execution on this ticket (including any earlier episode),
            so another Coordinator or Backup Service Dispatcher must review and approve it.
          </p>
        </div>
      )}

      {/* Core Customer, Site & Independent Timestamps */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
            Scope, Site & Contact Details
          </h2>
          <p className="text-sm text-ink whitespace-pre-wrap">{detail.summary}</p>

          <div className="grid gap-3 border-t border-line pt-4 text-xs sm:grid-cols-2">
            <div>
              <p className="font-semibold text-soft">Site & Area</p>
              <p className="mt-0.5 text-ink">
                {detail.site_name} ({detail.area_label})
              </p>
            </div>
            <div>
              <p className="font-semibold text-soft">Source & Provider</p>
              <p className="mt-0.5 text-ink">
                {detail.provider_name}
                {detail.received_source ? ` · ${SERVICE_SOURCE_LABELS[detail.received_source]}` : ''}
              </p>
            </div>
            <div>
              <p className="font-semibold text-soft flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-muted" /> Physical Address
              </p>
              <p className="mt-0.5 text-ink">
                {detail.physical_address ?? 'Redacted in historical view'}
              </p>
            </div>
            <div>
              <p className="font-semibold text-soft flex items-center gap-1">
                <Phone className="h-3.5 w-3.5 text-muted" /> Customer Contact
              </p>
              <p className="mt-0.5 text-ink">
                {detail.customer_contact_name
                  ? `${detail.customer_contact_name} (${detail.customer_contact_phone ?? '—'})`
                  : 'Redacted in historical view'}
              </p>
            </div>
            {detail.access_instructions && (
              <div className="sm:col-span-2">
                <p className="font-semibold text-soft">Access Instructions</p>
                <p className="mt-0.5 text-ink">{detail.access_instructions}</p>
              </div>
            )}
            {detail.intake_internal_notes && (
              <div className="sm:col-span-2 rounded-md border border-line bg-canvas p-3">
                <p className="font-semibold text-soft">Internal Intake Notes (Non-Crew)</p>
                <p className="mt-0.5 text-ink">{detail.intake_internal_notes}</p>
              </div>
            )}
            {detail.rework_reason && (
              <div className="sm:col-span-2 rounded-md border border-amber/40 bg-amber-tint/50 p-3">
                <p className="font-semibold text-ink">Latest Rework / Follow-Up Reason</p>
                <p className="mt-0.5 text-soft">{detail.rework_reason}</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
            Crew & Independent Milestones
          </h2>

          <div className="space-y-1.5 text-xs">
            <p className="font-semibold text-soft">Active Crew</p>
            {detail.active_crew.length === 0 ? (
              <p className="text-muted">No active crew assigned.</p>
            ) : (
              <ul className="space-y-1">
                {detail.active_crew.map((m) => (
                  <li key={m.profile_id} className="flex items-center justify-between gap-2 text-ink">
                    <span>{m.display_name}</span>
                    <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-semibold uppercase text-soft border border-line">
                      {m.assignment_role}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <dl className="space-y-1.5 border-t border-line pt-3 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Provider Received</dt>
              <dd><ServiceTimestamp value={detail.provider_received_at} /></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Provider Target</dt>
              <dd><ServiceTimestamp value={detail.provider_deadline_at} fallback="None set" /></dd>
            </div>
            {detail.viewer_scope === 'full' && (
              <>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Submitted</dt>
                  <dd><ServiceTimestamp value={detail.submitted_at} fallback="Pending" /></dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Accepted</dt>
                  <dd><ServiceTimestamp value={detail.accepted_at} fallback="Pending" /></dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Assigned</dt>
                  <dd><ServiceTimestamp value={detail.assigned_at} fallback="Pending" /></dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Work Completed</dt>
                  <dd><ServiceTimestamp value={detail.work_completed_at} fallback="Pending" /></dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Coordinator Reviewed</dt>
                  <dd><ServiceTimestamp value={detail.coordinator_reviewed_at} fallback="Pending" /></dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Reported to Provider</dt>
                  <dd><ServiceTimestamp value={detail.reported_to_provider_at} fallback="Pending" /></dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Provider Confirmed</dt>
                  <dd><ServiceTimestamp value={detail.provider_confirmed_at} fallback="Pending" /></dd>
                </div>
              </>
            )}
          </dl>
        </div>
      </div>

      {/* Active Lead Engineer Visit Action or Start Visit */}
      {canStartVisit && (
        <div className="flex flex-col gap-3 rounded-lg border border-emerald/40 bg-emerald-tint/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5 text-xs">
            <p className="font-display text-sm font-bold text-ink">
              Ready to Start Field Visit (Lead Engineer)
            </p>
            <p className="text-soft">
              Recording arrival creates a new timestamped visit under Episode #{detail.active_episode_number}.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            loading={startVisitMutation.isPending}
            leftIcon={<Play className="h-4 w-4" />}
            onClick={() => {
              void startVisitMutation
                .mutateAsync({
                  serviceRequestId: detail.id,
                  expectedRequestVersion: detail.version,
                })
                .then(() => toast('Field visit started cleanly', { tone: 'success' }))
                .catch((err) => {
                  if (!isAbortError(err)) toast(extractErrorMessage(err), { tone: 'danger' })
                })
            }}
          >
            Start Field Visit
          </Button>
        </div>
      )}

      {openVisit && canWork && detail.my_assignment_role === 'lead' && actorId && openVisit.lead_profile_id === actorId && (
        <LeadOpenVisitPanel
          key={`${actorId}:${openVisit.id}`}
          detail={detail}
          visit={openVisit}
          checklistItems={activeChecklistItems}
          checklistProvisional={checklistDefs?.provisional ?? true}
        />
      )}

      {openVisit && canWork && detail.my_assignment_role === 'assistant' && actorId && (
        <AssistantContributionPanel
          key={`${actorId}:${openVisit.id}`}
          visit={openVisit}
          actorId={actorId}
        />
      )}

      <ServiceRequestRoutersPanel
        serviceRequestId={detail.id}
        status={detail.status}
        openVisitId={openVisit?.id ?? null}
        isActiveCrewMember={
          canWork && detail.viewer_scope !== 'historical_participant' && detail.my_assignment_role !== null
        }
      />

      {/* Urgent Flags Section */}
      {detail.urgent_flags.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose" />
            Urgent Flags ({detail.urgent_flags.length})
          </h2>
          <div className="space-y-2.5">
            {detail.urgent_flags.map((flag) => {
              const isHighlighted = highlightedUrgentId === flag.id
              return (
                <div
                  key={flag.id}
                  id={`urgent-flag-${flag.id}`}
                  data-highlighted-urgent={isHighlighted ? 'true' : undefined}
                  className={cn(
                    'flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-xs',
                    isHighlighted ? 'border-rose ring-2 ring-rose/35' : 'border-line',
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <UrgentFlagBadge status={flag.status} />
                        {isHighlighted && (
                          <span className="rounded bg-rose-tint px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose border border-rose/40">
                            Linked Alert
                          </span>
                        )}
                        <span className="text-xs font-semibold text-ink">
                          {SERVICE_URGENT_REASON_LABELS[flag.reason_code]}
                        </span>
                        <span className="text-xs text-muted">
                          Raised by {flag.reported_by_name} · <ServiceTimestamp value={flag.reported_at} />
                        </span>
                      </div>
                      <p className="text-sm text-ink">{flag.summary}</p>
                      {(flag.acknowledged_at || flag.acknowledgement_note) && (
                        <p className="text-xs text-soft">
                          Acknowledged{flag.acknowledged_by_name ? ` by ${flag.acknowledged_by_name}` : ''}
                          {flag.acknowledged_at && (
                            <>
                              {' '}· <ServiceTimestamp value={flag.acknowledged_at} />
                            </>
                          )}
                          {flag.acknowledgement_note ? ` — ${flag.acknowledgement_note}` : ''}
                        </p>
                      )}
                      {(flag.resolved_at || flag.resolution_note) && (
                        <p className="text-xs text-soft">
                          Resolved{flag.resolved_by_name ? ` by ${flag.resolved_by_name}` : ''}
                          {flag.resolved_at && (
                            <>
                              {' '}· <ServiceTimestamp value={flag.resolved_at} />
                            </>
                          )}
                          {flag.resolution_note ? ` — ${flag.resolution_note}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {flag.status === 'open' && canAckUrgent && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setUrgentModal({ mode: 'ack', flag })}
                        >
                          Acknowledge
                        </Button>
                      )}
                      {flag.status !== 'resolved' && canResolveUrgent && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setUrgentModal({ mode: 'resolve', flag })}
                        >
                          Resolve Flag
                        </Button>
                      )}
                    </div>
                  </div>

                  <UrgentDeliveryStatusPanel
                    flagId={flag.id}
                    deliverySummary={flag.delivery_summary}
                    deliveries={flag.deliveries}
                    canOperate={canAckUrgent || canResolveUrgent}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Recorded Visits & Evidence History */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-emerald-600" />
          Field Visits & Evidence ({detail.visits.length})
        </h2>
        {detail.visits.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-4 text-xs text-muted">
            No field visits started yet.
          </p>
        ) : (
          <div className="space-y-3">
            {detail.visits.map((visit) => {
              const checkedKeys = Object.entries(visit.checklist ?? {})
                .filter(([, checked]) => checked === true)
                .map(([key]) => key)
              return (
                <div
                  key={visit.id}
                  className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-bold text-ink">
                        Visit #{visit.visit_number}
                      </span>
                      <span className="text-xs text-soft">Lead: {visit.lead_name}</span>
                      <span className="rounded bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink border border-line">
                        {visit.visit_status.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <span className="text-xs text-muted flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      <ServiceTimestamp value={visit.arrival_at} />
                      {visit.ended_at && (
                        <>
                          {' '}
                          → <ServiceTimestamp value={visit.ended_at} />
                        </>
                      )}
                    </span>
                  </div>

                  {checkedKeys.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {checkedKeys.map((key) => {
                        const label =
                          activeChecklistItems.find((i) => i.key === key)?.label ?? key
                        return (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-tint px-2.5 py-0.5 text-[11px] font-medium text-emerald-600"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {label}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {visit.work_notes && (
                    <p className="text-sm text-ink whitespace-pre-wrap">{visit.work_notes}</p>
                  )}

                  {visit.follow_up_reason && (
                    <p className="rounded-md bg-amber-tint/50 px-3 py-2 text-xs text-ink">
                      <span className="font-semibold">Follow-Up Reason:</span>{' '}
                      {visit.follow_up_reason}
                    </p>
                  )}

                  {visit.photo_paths.length > 0 && (
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                      {visit.photo_paths.map((p) => (
                        <ServiceEvidenceThumbnail
                          key={p}
                          path={p}
                          canLoadImage={canLoadVisitImage(visit)}
                        />
                      ))}
                    </div>
                  )}

                  {visit.contributors.length > 0 && (
                    <div className="space-y-2 border-t border-line pt-3">
                      <p className="text-xs font-semibold text-soft">Assistant Contributions</p>
                      {visit.contributors.map((contrib) => (
                        <div
                          key={contrib.id}
                          className="rounded-md border border-line bg-canvas p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-ink">{contrib.display_name}</span>
                            <span className="text-muted">
                              <ServiceTimestamp value={contrib.updated_at} />
                            </span>
                          </div>
                          {contrib.note && <p className="text-xs text-ink">{contrib.note}</p>}
                          {contrib.photo_paths.length > 0 && (
                            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                              {contrib.photo_paths.map((p) => (
                                <ServiceEvidenceThumbnail
                                  key={p}
                                  path={p}
                                  canLoadImage={canLoadContributorImage(contrib.profile_id)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Operational Audit Timeline (Full scope only) */}
      {detail.viewer_scope === 'full' && detail.events.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-base font-bold text-ink">Service activity</h2>
          <div className="rounded-lg border border-line bg-surface divide-y divide-line">
            {detail.events.map((ev) => {
              const nextStatus = SERVICE_REQUEST_STATUSES.find((status) => status === ev.to_status)
              return (
                <div
                  key={ev.id}
                  className="flex flex-col gap-1 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-semibold text-ink">
                    {(ev.actor_name || 'A team member') + ' ' + (serviceActivity[ev.event_type] ?? 'updated the service request')}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-muted">
                    {nextStatus && ev.from_status !== nextStatus && <ServiceStatusPill status={nextStatus} />}
                    <ServiceTimestamp value={ev.occurred_at} />
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Action Modals */}
      <DispatchCrewDialog
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        requestId={detail.id}
        expectedVersion={detail.version}
        candidates={candidatesQuery.data ?? []}
        initialLeadId={currentLead?.profile_id ?? ''}
        initialAssistantIds={currentAssistantIds}
        isReassign={Boolean(detail.active_assignment_id)}
      />

      <AddAssistantDialog
        open={addAssistantOpen}
        onOpenChange={setAddAssistantOpen}
        requestId={detail.id}
        expectedVersion={detail.version}
        candidates={candidatesQuery.data ?? []}
        existingMemberIds={detail.active_crew.map((m) => m.profile_id)}
      />

      <CoordinatorReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        requestId={detail.id}
        expectedVersion={detail.version}
        initialDecision={reviewDecision}
      />

      {handoffMode && (
        <ProviderHandoffDialog
          open={Boolean(handoffMode)}
          onOpenChange={(open) => {
            if (!open) setHandoffMode(null)
          }}
          mode={handoffMode}
          requestId={detail.id}
          expectedVersion={detail.version}
        />
      )}

      <CancelRequestDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        requestId={detail.id}
        expectedVersion={detail.version}
      />

      {urgentModal && (
        <UrgentFlagDialog
          open={Boolean(urgentModal)}
          onOpenChange={(open) => {
            if (!open) setUrgentModal(null)
          }}
          mode={urgentModal.mode}
          serviceRequestId={detail.id}
          visitId={openVisit?.id ?? null}
          flag={urgentModal.flag}
        />
      )}
    </div>
  )
}
