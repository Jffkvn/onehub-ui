import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, FilePlus2, Send, Save } from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { FormGroup, Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Checkbox } from '@/components/ui/Toggles'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  SERVICE_PRIORITIES,
  SERVICE_PRIORITY_LABELS,
  SERVICE_RECEIVED_SOURCES,
  SERVICE_REQUEST_TYPES,
  SERVICE_SOURCE_LABELS,
  SERVICE_TYPE_LABELS,
  type ServicePriority,
  type ServiceReceivedSource,
  type ServiceRequestType,
} from '../schemas/services'
import {
  assertProtectedSessionCurrent,
  captureProtectedSessionSnapshot,
  extractErrorMessage,
  isAbortError,
  isProtectedSessionCurrent,
  isProviderRefDuplicateError,
  useProtectedIdentityScope,
} from '../lib/pendingOperations'
import {
  getEffectiveServiceAccess,
  useSaveServiceDraft,
  useServiceRequestDetail,
  useServiceRequests,
  useSubmitServiceRequest,
} from '../api/services'
import {
  PendingServiceOperationsBanner,
  ServicePaginationBar,
  ServicePriorityPill,
  ServiceStatusPill,
  ServiceTimestamp,
  ServiceTypeBadge,
} from '../components/ServiceBadges'

function toLocalDatetimeInputValue(iso?: string | null): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIsoStringOrNull(localValue: string): string | null {
  if (!localValue.trim()) return null
  const date = new Date(localValue)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function ServiceIntakePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const auth = useAuth()
  const identityScope = useProtectedIdentityScope(auth)
  const { hasPermission } = getEffectiveServiceAccess(auth)

  const canIntake = hasPermission('service_requests.intake')
  const canReadAll = hasPermission('service_requests.read')
  const draftParamId = searchParams.get('draft')
  const rawQueuePage = Number.parseInt(searchParams.get('queuePage') ?? '1', 10)
  const queuePage = Number.isFinite(rawQueuePage) && rawQueuePage > 0 ? rawQueuePage : 1
  const INTAKE_PAGE_SIZE = 25
  const isNewRoute = location.pathname.endsWith('/new') || Boolean(draftParamId)

  const [showForm, setShowForm] = useState(isNewRoute)
  const [editingId, setEditingId] = useState<string | null>(draftParamId)
  const [editingVersion, setEditingVersion] = useState<number | null>(null)

  const [providerName, setProviderName] = useState('')
  const [providerReference, setProviderReference] = useState('')
  const [requestType, setRequestType] = useState<ServiceRequestType>('installation')
  const [priority, setPriority] = useState<ServicePriority>('normal')
  const [receivedSource, setReceivedSource] = useState<ServiceReceivedSource>('provider_email')
  const [providerReceivedAt, setProviderReceivedAt] = useState(() => toLocalDatetimeInputValue())
  const [providerDeadlineAt, setProviderDeadlineAt] = useState('')
  const [siteName, setSiteName] = useState('')
  const [areaLabel, setAreaLabel] = useState('')
  const [physicalAddress, setPhysicalAddress] = useState('')
  const [accessInstructions, setAccessInstructions] = useState('')
  const [customerContactName, setCustomerContactName] = useState('')
  const [customerContactPhone, setCustomerContactPhone] = useState('')
  const [summary, setSummary] = useState('')
  const [intakeInternalNotes, setIntakeInternalNotes] = useState('')
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const draftDetailQuery = useServiceRequestDetail(draftParamId ?? undefined, Boolean(draftParamId))
  const listQuery = useServiceRequests(
    {
      statuses: ['draft', 'submitted', 'coordinator_reviewed', 'reported_to_provider'],
      limit: INTAKE_PAGE_SIZE,
      offset: (queuePage - 1) * INTAKE_PAGE_SIZE,
    },
    canReadAll,
  )
  const saveMutation = useSaveServiceDraft()
  const submitMutation = useSubmitServiceRequest()

  const updateQueuePage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) {
      next.delete('queuePage')
    } else {
      next.set('queuePage', String(nextPage))
    }
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    if (isNewRoute) setShowForm(true)
  }, [isNewRoute])

  useEffect(() => {
    const d = draftDetailQuery.data
    if (!d || d.id !== draftParamId) return
    setEditingId(d.id)
    setEditingVersion(d.version)
    setProviderName(d.provider_name)
    setProviderReference(d.provider_reference ?? '')
    setRequestType(d.request_type)
    setPriority(d.priority)
    setReceivedSource(d.received_source ?? 'provider_email')
    setProviderReceivedAt(toLocalDatetimeInputValue(d.provider_received_at))
    setProviderDeadlineAt(d.provider_deadline_at ? toLocalDatetimeInputValue(d.provider_deadline_at) : '')
    setSiteName(d.site_name)
    setAreaLabel(d.area_label)
    setPhysicalAddress(d.physical_address ?? '')
    setAccessInstructions(d.access_instructions ?? '')
    setCustomerContactName(d.customer_contact_name ?? '')
    setCustomerContactPhone(d.customer_contact_phone ?? '')
    setSummary(d.summary)
    setIntakeInternalNotes(d.intake_internal_notes ?? '')
    setDuplicateWarning(null)
    setFormError(null)
  }, [draftDetailQuery.data, draftParamId])

  const resetForm = () => {
    setEditingId(null)
    setEditingVersion(null)
    setProviderName('')
    setProviderReference('')
    setRequestType('installation')
    setPriority('normal')
    setReceivedSource('provider_email')
    setProviderReceivedAt(toLocalDatetimeInputValue())
    setProviderDeadlineAt('')
    setSiteName('')
    setAreaLabel('')
    setPhysicalAddress('')
    setAccessInstructions('')
    setCustomerContactName('')
    setCustomerContactPhone('')
    setSummary('')
    setIntakeInternalNotes('')
    setConfirmDuplicate(false)
    setDuplicateWarning(null)
    setFormError(null)
  }

  const validateFields = (): string | null => {
    if (providerName.trim().length < 2) return 'Internet provider name must be at least 2 characters.'
    if (providerReference.trim().length < 2) return 'Provider reference is required.'
    if (siteName.trim().length < 2) return 'Site / building name is required.'
    if (areaLabel.trim().length < 2) return 'Area / neighbourhood label is required.'
    if (physicalAddress.trim().length < 3) return 'Physical address (at least 3 chars) is required.'
    if (customerContactName.trim().length < 2) return 'Customer contact name is required.'
    if (customerContactPhone.trim().length < 5) return 'Customer contact phone (at least 5 chars) is required.'
    if (summary.trim().length < 5) return 'Work summary (at least 5 characters) is required.'
    if (!toIsoStringOrNull(providerReceivedAt)) return 'Provider received timestamp is required.'
    return null
  }

  const handleSaveOrSubmit = async (submitAfterSave: boolean) => {
    setFormError(null)
    const validationErr = validateFields()
    if (validationErr) {
      setFormError(validationErr)
      return
    }
    const receivedIso = toIsoStringOrNull(providerReceivedAt)!
    const deadlineIso = providerDeadlineAt ? toIsoStringOrNull(providerDeadlineAt) : null
    if (deadlineIso && new Date(deadlineIso).getTime() < new Date(receivedIso).getTime()) {
      setFormError('Provider target date/time cannot be earlier than Provider Received timestamp.')
      return
    }

    const startSnap = captureProtectedSessionSnapshot({
      identityKey: identityScope.identityKey,
      authEpoch: identityScope.authEpoch,
      isReady: identityScope.isAuthReady,
    })

    try {
      assertProtectedSessionCurrent(
        startSnap,
        identityScope.latestRef.current,
        'Authenticated session is unavailable.',
      )

      const saveEnv = await saveMutation.mutateAsync({
        id: editingId,
        providerName: providerName.trim(),
        providerReference: providerReference.trim(),
        requestType,
        priority,
        siteName: siteName.trim(),
        areaLabel: areaLabel.trim(),
        physicalAddress: physicalAddress.trim(),
        accessInstructions: accessInstructions.trim() || null,
        customerContactName: customerContactName.trim(),
        customerContactPhone: customerContactPhone.trim(),
        summary: summary.trim(),
        intakeInternalNotes: intakeInternalNotes.trim() || null,
        receivedSource,
        providerReceivedAt: receivedIso,
        providerDeadlineAt: deadlineIso,
        expectedVersion: editingVersion,
        confirmDuplicate,
        pinnedSessionSnapshot: startSnap,
      })

      assertProtectedSessionCurrent(
        startSnap,
        identityScope.latestRef.current,
        'Account session changed before completing intake workflow.',
      )

      const savedId = typeof saveEnv.result.id === 'string' ? saveEnv.result.id : (editingId ?? '')
      const rawVersion = saveEnv.result.version
      const savedVersion =
        typeof rawVersion === 'number' ? rawVersion : (editingVersion ?? 1)
      setEditingId(savedId)
      setEditingVersion(savedVersion)
      setDuplicateWarning(null)

      if (submitAfterSave) {
        const submitEnv = await submitMutation.mutateAsync({
          id: savedId,
          expectedVersion: savedVersion,
          confirmDuplicate,
          pinnedSessionSnapshot: startSnap,
        })
        assertProtectedSessionCurrent(
          startSnap,
          identityScope.latestRef.current,
          'Account session changed after intake submission.',
        )
        toast(
          submitEnv.replayed
            ? 'Service request already submitted to Dispatch'
            : 'Service request submitted for dispatch',
          { tone: 'success' },
        )
        resetForm()
        setShowForm(false)
        void navigate(`/services/requests/${savedId}?from=${encodeURIComponent('/services/intake')}`)
      } else {
        toast(saveEnv.replayed ? 'Draft save confirmed' : 'Draft saved', { tone: 'success' })
        setSearchParams({ draft: savedId }, { replace: true })
      }
    } catch (error) {
      if (isAbortError(error) || !isProtectedSessionCurrent(startSnap, identityScope.latestRef.current)) {
        return
      }
      const msg = extractErrorMessage(error)
      if (isProviderRefDuplicateError(error)) {
        setDuplicateWarning(msg.replace(/^PROVIDER_REF_EXISTS:\s*/, ''))
      }
      setFormError(msg)
    }
  }

  const intakeQueueRows = listQuery.data?.rows ?? []
  const totalQueueCount = listQuery.data?.total_count ?? intakeQueueRows.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Intake & Provider Handoff"
        subtitle="Log ISP installation or maintenance jobs from email/portal/phone and report verified completions back to providers."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/services">
              <Button type="button" variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Service Overview
              </Button>
            </Link>
            {canIntake && !showForm && (
              <Button
                type="button"
                variant="primary"
                leftIcon={<FilePlus2 className="h-4 w-4" />}
                onClick={() => {
                  resetForm()
                  setShowForm(true)
                }}
              >
                New Intake Request
              </Button>
            )}
          </div>
        }
      />

      <PendingServiceOperationsBanner intentPrefix="service:" />

      {canIntake && showForm && (
        <div className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div>
              <h2 className="font-display text-base font-bold text-ink">
                {editingId ? 'Edit Draft Service Request' : 'Log New Provider Service Request'}
              </h2>
              <p className="text-xs text-soft">
                Save as draft to refine details, or submit directly to Dispatch coordinators.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                resetForm()
                setShowForm(false)
                setSearchParams({}, { replace: true })
              }}
            >
              Close Form
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormGroup label="Provider / ISP Name" required>
              <Input
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="e.g. Roke Telkom"
              />
            </FormGroup>
            <FormGroup label="Provider Ticket Reference" required>
              <Input
                value={providerReference}
                onChange={(e) => {
                  setProviderReference(e.target.value)
                  setDuplicateWarning(null)
                }}
                placeholder="e.g. RK-99812"
              />
            </FormGroup>
            <FormGroup label="Intake Source" required>
              <Select
                value={receivedSource}
                onValueChange={(v) => setReceivedSource(v as ServiceReceivedSource)}
                options={SERVICE_RECEIVED_SOURCES.map((src) => ({
                  value: src,
                  label: SERVICE_SOURCE_LABELS[src],
                }))}
              />
            </FormGroup>
            <FormGroup label="Service Category" required>
              <Select
                value={requestType}
                onValueChange={(v) => setRequestType(v as ServiceRequestType)}
                options={SERVICE_REQUEST_TYPES.map((t) => ({
                  value: t,
                  label: SERVICE_TYPE_LABELS[t],
                }))}
              />
            </FormGroup>
            <FormGroup label="Priority" required>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as ServicePriority)}
                options={SERVICE_PRIORITIES.map((p) => ({
                  value: p,
                  label: SERVICE_PRIORITY_LABELS[p],
                }))}
              />
            </FormGroup>
            <FormGroup label="Provider Received At" required>
              <Input
                type="datetime-local"
                value={providerReceivedAt}
                onChange={(e) => setProviderReceivedAt(e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Provider Target Date/Time (Optional)">
              <Input
                type="datetime-local"
                value={providerDeadlineAt}
                onChange={(e) => setProviderDeadlineAt(e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Site / Building Name" required>
              <Input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="e.g. Acacia Mall Wing B"
              />
            </FormGroup>
            <FormGroup label="Area / Neighbourhood (Safe Display Label)" required>
              <Input
                value={areaLabel}
                onChange={(e) => setAreaLabel(e.target.value)}
                placeholder="e.g. Kololo"
              />
            </FormGroup>
            <FormGroup label="Customer Contact Name" required>
              <Input
                value={customerContactName}
                onChange={(e) => setCustomerContactName(e.target.value)}
                placeholder="Site contact full name"
              />
            </FormGroup>
            <FormGroup label="Customer Contact Phone" required>
              <Input
                value={customerContactPhone}
                onChange={(e) => setCustomerContactPhone(e.target.value)}
                placeholder="+256 7XX XXX XXX"
              />
            </FormGroup>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FormGroup label="Physical Street Address & Landmark" required>
              <Textarea
                value={physicalAddress}
                onChange={(e) => setPhysicalAddress(e.target.value)}
                placeholder="Plot, floor, suite, gate directions..."
              />
            </FormGroup>
            <FormGroup label="Site Access Instructions (Optional)">
              <Textarea
                value={accessInstructions}
                onChange={(e) => setAccessInstructions(e.target.value)}
                placeholder="Security gate desk clearance, landlord contact..."
              />
            </FormGroup>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FormGroup label="Work Summary / Scope" required>
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Describe installation work or fault symptoms..."
              />
            </FormGroup>
            <FormGroup
              label="Internal Intake Notes (Hidden from Field Crew)"
              hint="Visible to Service Desk & Coordinators only."
            >
              <Textarea
                value={intakeInternalNotes}
                onChange={(e) => setIntakeInternalNotes(e.target.value)}
                placeholder="ISP account handler, commercial context, special billing note..."
              />
            </FormGroup>
          </div>

          {duplicateWarning && (
            <div
              role="alert"
              className="rounded-md border border-amber/40 bg-amber-tint p-3.5 text-xs space-y-2"
            >
              <div className="flex items-start gap-2 text-ink">
                <AlertTriangle className="h-4 w-4 text-amber shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Possible Duplicate Provider Reference</p>
                  <p className="mt-0.5 text-soft">{duplicateWarning}</p>
                </div>
              </div>
              <Checkbox
                checked={confirmDuplicate}
                onCheckedChange={(checked) => setConfirmDuplicate(Boolean(checked))}
                label="Confirm intentional separate ticket for this provider reference"
              />
            </div>
          )}

          {formError && !duplicateWarning && (
            <p role="alert" className="text-xs font-medium text-rose">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button
              type="button"
              variant="outline"
              loading={saveMutation.isPending && !submitMutation.isPending}
              disabled={saveMutation.isPending || submitMutation.isPending}
              leftIcon={<Save className="h-4 w-4" />}
              onClick={() => void handleSaveOrSubmit(false)}
            >
              Save Draft
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={submitMutation.isPending}
              disabled={saveMutation.isPending || submitMutation.isPending}
              leftIcon={<Send className="h-4 w-4" />}
              onClick={() => void handleSaveOrSubmit(true)}
            >
              Submit to Dispatch
            </Button>
          </div>
        </div>
      )}

      {canReadAll && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-ink">
              Drafts, Submitted Intake & Provider Reporting Queue
            </h2>
            <span className="text-xs text-muted tabular-nums">
              {totalQueueCount} ticket(s)
            </span>
          </div>

          {listQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton shape="row" />
              <Skeleton shape="row" />
            </div>
          ) : listQuery.isError ? (
            <EmptyState
              title="Could not load intake queue"
              description={listQuery.error.message}
            />
          ) : intakeQueueRows.length === 0 ? (
            <EmptyState
              title={queuePage > 1 ? 'No tickets on this page' : 'No pending intake or provider reporting tickets'}
              description={
                queuePage > 1
                  ? 'Use the pagination bar below to return to an earlier page.'
                  : 'All active service requests are currently assigned or in field progress.'
              }
              action={
                canIntake && !showForm && queuePage === 1 ? (
                  <Button type="button" variant="primary" onClick={() => setShowForm(true)}>
                    Log First Request
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2.5">
              {intakeQueueRows.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ink">
                        {row.internal_code}
                      </span>
                      <ServiceTypeBadge requestType={row.request_type} />
                      <ServicePriorityPill priority={row.priority} />
                      <ServiceStatusPill status={row.status} />
                    </div>
                    <p className="text-sm font-medium text-ink truncate">
                      {row.site_name} ({row.area_label}) — {row.provider_name} [{row.provider_reference}]
                    </p>
                    <p className="text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        Received: <ServiceTimestamp value={row.provider_received_at} />
                      </span>
                      {row.provider_deadline_at && (
                        <span>
                          Target: <ServiceTimestamp value={row.provider_deadline_at} />
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {row.status === 'draft' && canIntake && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowForm(true)
                          setSearchParams({ draft: row.id })
                        }}
                      >
                        Resume Draft
                      </Button>
                    )}
                    <Link
                      to={`/services/requests/${row.id}?from=${encodeURIComponent(location.pathname + location.search)}`}
                    >
                      <Button
                        type="button"
                        variant={row.status === 'coordinator_reviewed' ? 'primary' : 'secondary'}
                        size="sm"
                        leftIcon={
                          row.status === 'coordinator_reviewed' ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : undefined
                        }
                      >
                        {row.status === 'coordinator_reviewed'
                          ? 'Report to Provider'
                          : 'Open Ticket'}
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
              <ServicePaginationBar
                page={queuePage}
                pageSize={INTAKE_PAGE_SIZE}
                totalCount={totalQueueCount}
                onPageChange={updateQueuePage}
                label="Intake queue pagination"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
