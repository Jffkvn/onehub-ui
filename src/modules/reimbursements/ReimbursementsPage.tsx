import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  FileText,
  Info,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/patterns/PageHeader'
import { KpiCard } from '@/components/patterns/KpiCard'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, Input, Label } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { StatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { useAuth, useHasPermission } from '@/modules/auth/AuthProvider'
import {
  REIMBURSEMENT_CATEGORIES,
  REIMBURSEMENT_CURRENCIES,
  REIMBURSEMENT_PAYMENT_METHODS,
  reimbursementsApi,
  todayKampalaIso,
  type ReceiptPayload,
  type ReimbursementCategory,
  type ReimbursementClaim,
  type ReimbursementCurrency,
  type ReimbursementPaymentMethod,
  type ReimbursementReceipt,
  type ReimbursementStatus,
} from './api'

function formatMoney(amount: number, currency: ReimbursementCurrency): string {
  return `${currency} ${amount.toLocaleString('en-UG', {
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

function statusTone(
  status: ReimbursementStatus,
): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  if (status === 'pending') return 'warning'
  if (status === 'needs_information') return 'info'
  if (status === 'approved' || status === 'paid') return 'success'
  if (status === 'rejected') return 'danger'
  return 'neutral'
}

function statusLabel(status: ReimbursementStatus): string {
  if (status === 'needs_information') return 'Needs Info'
  if (status === 'approved') return 'Approved'
  if (status === 'paid') return 'Paid'
  if (status === 'rejected') return 'Rejected'
  if (status === 'withdrawn') return 'Withdrawn'
  return 'Pending'
}

function categoryLabel(cat: ReimbursementCategory): string {
  return REIMBURSEMENT_CATEGORIES.find((c) => c.value === cat)?.label ?? cat
}

function paymentMethodLabel(method: ReimbursementPaymentMethod | null): string {
  if (!method) return '—'
  return REIMBURSEMENT_PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method
}

function ClaimDetailDialog({
  claim,
  onClose,
  onDownloadReceipt,
  downloadingPath,
  footer,
}: {
  claim: ReimbursementClaim
  onClose: () => void
  onDownloadReceipt: (receipt: ReimbursementReceipt) => void
  downloadingPath: string | null
  footer?: React.ReactNode
}) {
  return (
    <Dialog
      open={Boolean(claim)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="max-w-2xl"
      title={`${categoryLabel(claim.category)} — ${formatMoney(claim.amount, claim.currency_code)}`}
      description={`${claim.employee_name} (${claim.employee_number}) · Spent ${claim.spent_on}`}
      footer={footer}
    >
      <div className="space-y-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone(claim.status)} size="sm">
            {statusLabel(claim.status)}
          </StatusPill>
          <span className="text-muted">Version v{claim.version}</span>
          {claim.is_own_claim && (
            <StatusPill tone="info" size="sm">
              Your Claim
            </StatusPill>
          )}
        </div>

        <div className="rounded-md border border-line bg-canvas/50 p-3">
          <p className="font-semibold text-ink mb-1">Description</p>
          <p className="text-soft whitespace-pre-wrap">{claim.description}</p>
        </div>

        {claim.review_note && (
          <div className="rounded-md border border-line bg-surface p-3">
            <p className="font-semibold text-ink">
              Review Note {claim.reviewed_by_name ? `(${claim.reviewed_by_name})` : ''}
            </p>
            <p className="mt-1 text-soft whitespace-pre-wrap">{claim.review_note}</p>
          </div>
        )}

        {claim.status === 'paid' && (
          <div className="rounded-md border border-emerald/30 bg-emerald-tint p-3 space-y-1">
            <p className="font-semibold text-ink">Settlement Recorded</p>
            <p className="text-soft">
              {paymentMethodLabel(claim.payment_method)} · Paid {claim.paid_at || '—'}
              {claim.payment_reference ? ` · Ref: ${claim.payment_reference}` : ''}
              {claim.paid_by_name ? ` · By ${claim.paid_by_name}` : ''}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <p className="font-semibold text-ink">Private Receipts ({claim.receipts.length})</p>
          {claim.receipts.length === 0 ? (
            <p className="text-muted">No receipts attached.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {claim.receipts.map((receipt) => (
                <li
                  key={receipt.id ?? receipt.storage_path}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-muted shrink-0" />
                    <span className="truncate font-medium text-ink">{receipt.original_file_name}</span>
                    <span className="text-muted shrink-0">
                      ({Math.max(1, Math.round(receipt.size_bytes / 1024))} KB)
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    leftIcon={<Download className="h-3.5 w-3.5" />}
                    disabled={downloadingPath === receipt.storage_path}
                    onClick={() => onDownloadReceipt(receipt)}
                  >
                    {downloadingPath === receipt.storage_path ? 'Opening…' : 'Open'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <p className="font-semibold text-ink">Timeline</p>
          <ul className="space-y-1.5 border-l-2 border-line pl-3">
            {claim.events.map((ev) => (
              <li key={ev.id} className="text-soft">
                <span className="font-medium text-ink uppercase">{ev.event_type.replace('_', ' ')}</span>
                {ev.actor_name ? ` by ${ev.actor_name}` : ''} ·{' '}
                <span className="text-muted">{ev.occurred_at.slice(0, 16).replace('T', ' ')}</span>
                {ev.note && <p className="text-muted mt-0.5">{ev.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  )
}

interface ClaimDraftState {
  mode: 'create' | 'resubmit'
  claimId: string
  expectedVersion?: number
  category: ReimbursementCategory
  amount: string
  currencyCode: ReimbursementCurrency
  spentOn: string
  description: string
  keptReceipts: ReceiptPayload[]
  newFiles: File[]
}

interface ReviewDialogState {
  claim: ReimbursementClaim
  decision: 'approved' | 'needs_information' | 'rejected'
  note: string
}

interface PayDialogState {
  claim: ReimbursementClaim
  paymentMethod: ReimbursementPaymentMethod
  paidAt: string
  paymentReference: string
  selfPaymentNote: string
}

export default function ReimbursementsPage({ manage = false }: { manage?: boolean }) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const canReview = useHasPermission('reimbursements.review')
  const canPay = useHasPermission('reimbursements.pay')
  const ownerProfileId = auth.access?.profile?.id ?? auth.session?.userId ?? ''

  const [statusFilter, setStatusFilter] = useState<'all' | ReimbursementStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedClaim, setSelectedClaim] = useState<ReimbursementClaim | null>(null)
  const [draft, setDraft] = useState<ClaimDraftState | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [reviewState, setReviewState] = useState<ReviewDialogState | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [payState, setPayState] = useState<PayDialogState | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)

  const deepLinkClaimId = searchParams.get('claim')

  const claimsQuery = useQuery({
    queryKey: ['reimbursements', manage ? 'manage' : 'mine'],
    queryFn: () => reimbursementsApi.listClaims(manage, null),
  })

  const items = claimsQuery.data?.items ?? []
  const summary = claimsQuery.data?.summary ?? null

  useEffect(() => {
    if (!deepLinkClaimId || items.length === 0) return
    const target = items.find((item) => item.id === deepLinkClaimId)
    if (target) {
      setStatusFilter('all')
      setSelectedClaim(target)
    }
  }, [deepLinkClaimId, items])

  const filteredItems = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!needle) return true
      const hay = `${item.employee_name} ${item.employee_number} ${item.category} ${item.description}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [items, searchQuery, statusFilter])

  const submitMutation = useMutation({
    mutationFn: async (current: ClaimDraftState) => {
      const numericAmount = Number(current.amount)
      if (current.mode === 'create') {
        return reimbursementsApi.submitClaim({
          claimId: current.claimId,
          ownerProfileId,
          category: current.category,
          amount: numericAmount,
          currencyCode: current.currencyCode,
          spentOn: current.spentOn,
          description: current.description,
          files: current.newFiles,
        })
      }
      return reimbursementsApi.resubmitClaim({
        claimId: current.claimId,
        expectedVersion: current.expectedVersion ?? 1,
        ownerProfileId,
        category: current.category,
        amount: numericAmount,
        currencyCode: current.currencyCode,
        spentOn: current.spentOn,
        description: current.description,
        keptReceipts: current.keptReceipts,
        newFiles: current.newFiles,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reimbursements'] })
      setDraft(null)
      setSelectedClaim(null)
      toast('Reimbursement submitted', {
        description: 'Reviewers have been notified.',
        tone: 'success',
      })
    },
    onError: (err) => {
      setDraftError(err instanceof Error ? err.message : 'Could not submit reimbursement claim.')
    },
  })

  const withdrawMutation = useMutation({
    mutationFn: (claim: ReimbursementClaim) =>
      reimbursementsApi.withdrawClaim(claim.id, claim.version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reimbursements'] })
      setSelectedClaim(null)
      toast('Claim withdrawn', { description: 'The claim has been withdrawn.', tone: 'info' })
    },
    onError: (err) => {
      toast('Withdraw failed', {
        description: err instanceof Error ? err.message : 'Could not withdraw claim.',
        tone: 'danger',
      })
    },
  })

  const decideMutation = useMutation({
    mutationFn: (state: ReviewDialogState) =>
      reimbursementsApi.decideClaim({
        claimId: state.claim.id,
        expectedVersion: state.claim.version,
        decision: state.decision,
        note: state.note,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reimbursements'] })
      setReviewState(null)
      setSelectedClaim(null)
      toast('Decision recorded', { description: 'Claim status updated and claimant notified.', tone: 'success' })
    },
    onError: (err) => {
      setReviewError(err instanceof Error ? err.message : 'Could not record decision.')
    },
  })

  const payMutation = useMutation({
    mutationFn: (state: PayDialogState) =>
      reimbursementsApi.markPaid({
        claimId: state.claim.id,
        expectedVersion: state.claim.version,
        paymentMethod: state.paymentMethod,
        paidAt: state.paidAt,
        paymentReference: state.paymentReference,
        selfPaymentNote: state.claim.is_own_claim ? state.selfPaymentNote : null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reimbursements'] })
      setPayState(null)
      setSelectedClaim(null)
      toast('Payment recorded', { description: 'Reimbursement settled and claimant notified.', tone: 'success' })
    },
    onError: (err) => {
      setPayError(err instanceof Error ? err.message : 'Could not record payment.')
    },
  })

  function openNewClaim() {
    setDraftError(null)
    setDraft({
      mode: 'create',
      claimId: crypto.randomUUID(),
      category: 'travel',
      amount: '',
      currencyCode: 'UGX',
      spentOn: todayKampalaIso(),
      description: '',
      keptReceipts: [],
      newFiles: [],
    })
  }

  function openResubmit(claim: ReimbursementClaim) {
    setSelectedClaim(null)
    setDraftError(null)
    setDraft({
      mode: 'resubmit',
      claimId: claim.id,
      expectedVersion: claim.version,
      category: claim.category,
      amount: String(claim.amount),
      currencyCode: claim.currency_code,
      spentOn: claim.spent_on,
      description: claim.description,
      keptReceipts: claim.receipts.map((r) => ({
        storage_path: r.storage_path,
        original_file_name: r.original_file_name,
        mime_type: r.mime_type,
        size_bytes: r.size_bytes,
      })),
      newFiles: [],
    })
  }

  function handleDraftSubmit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    setDraftError(null)

    const amount = Number(draft.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      setDraftError('Enter a reimbursement amount greater than zero.')
      return
    }
    const today = todayKampalaIso()
    if (!draft.spentOn || draft.spentOn > today) {
      setDraftError('Date spent cannot be in the future.')
      return
    }
    if (draft.description.trim().length < 3) {
      setDraftError('Provide an expense description of at least 3 characters.')
      return
    }
    if (draft.keptReceipts.length + draft.newFiles.length > 5) {
      setDraftError('Attach up to 5 receipt files per claim.')
      return
    }
    if (!ownerProfileId) {
      setDraftError('Active user session is required to attach receipts and submit.')
      return
    }

    submitMutation.mutate(draft)
  }

  function handleReviewSubmit(event: FormEvent) {
    event.preventDefault()
    if (!reviewState) return
    setReviewError(null)

    const requiresNote =
      reviewState.decision === 'rejected' ||
      reviewState.decision === 'needs_information' ||
      reviewState.claim.is_own_claim

    if (requiresNote && reviewState.note.trim().length < 3) {
      setReviewError(
        reviewState.claim.is_own_claim
          ? 'Own-claim review requires an explanatory note of at least 3 characters.'
          : 'Enter a clear explanation note of at least 3 characters.',
      )
      return
    }

    decideMutation.mutate(reviewState)
  }

  function handlePaySubmit(event: FormEvent) {
    event.preventDefault()
    if (!payState) return
    setPayError(null)

    if (!payState.paidAt || payState.paidAt > todayKampalaIso()) {
      setPayError('Paid date cannot be in the future.')
      return
    }
    if (payState.claim.is_own_claim && payState.selfPaymentNote.trim().length < 3) {
      setPayError('Recording payment on your own claim requires a note of at least 3 characters.')
      return
    }
    payMutation.mutate(payState)
  }

  async function handleDownloadReceipt(receipt: ReimbursementReceipt) {
    setDownloadingPath(receipt.storage_path)
    try {
      const url = await reimbursementsApi.getReceiptDownloadUrl(receipt.storage_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast('Could not open receipt', {
        description: err instanceof Error ? err.message : 'Try again.',
        tone: 'danger',
      })
    } finally {
      setDownloadingPath(null)
    }
  }

  function closeDetail() {
    setSelectedClaim(null)
    if (deepLinkClaimId) {
      const next = new URLSearchParams(searchParams)
      next.delete('claim')
      setSearchParams(next, { replace: true })
    }
  }

  const unlinkedSelf = !manage && claimsQuery.data && !claimsQuery.data.linked

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={manage ? 'Finance & Operations' : 'My Workspace'}
        title={manage ? 'Personal Reimbursements' : 'My Reimbursements'}
        subtitle={
          manage
            ? 'Review employee personal expense claims, inspect private receipts, and record settlement details.'
            : 'Submit personal out-of-pocket expenses, respond to reviewer questions, and track reimbursement payments.'
        }
        actions={
          !manage && !unlinkedSelf && (
            <Button
              variant="primary"
              size="md"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={openNewClaim}
            >
              Submit Claim
            </Button>
          )
        }
      />

      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/70 px-4 py-2.5 text-xs text-soft">
        <Info className="h-4 w-4 text-blue shrink-0" />
        <span>
          Personal Reimbursements track direct staff out-of-pocket claims only and remain strictly separate from
          Project Cash advances and Payroll runs.
        </span>
      </div>

      {manage && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={<Receipt className="h-5 w-5" />}
            tone={(summary?.pendingCount ?? 0) > 0 ? 'amber' : 'neutral'}
            title="Pending Review"
            value={summary?.pendingCount ?? 0}
            subline={
              summary ? `UGX ${Math.round(summary.pendingAmountUgx).toLocaleString('en-UG')} (UGX claims)` : undefined
            }
            loading={claimsQuery.isLoading}
          />
          <KpiCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone={(summary?.approvedUnpaidCount ?? 0) > 0 ? 'blue' : 'neutral'}
            title="Approved Unpaid"
            value={summary?.approvedUnpaidCount ?? 0}
            subline={
              summary
                ? `UGX ${Math.round(summary.approvedUnpaidAmountUgx).toLocaleString('en-UG')} awaiting settlement`
                : undefined
            }
            loading={claimsQuery.isLoading}
          />
          <KpiCard
            icon={<RotateCcw className="h-5 w-5" />}
            tone="violet"
            title="Needs Info"
            value={summary?.needsInfoCount ?? 0}
            subline="Awaiting employee update"
            loading={claimsQuery.isLoading}
          />
          <KpiCard
            icon={<CreditCard className="h-5 w-5" />}
            tone="emerald"
            title="Paid This Year"
            value={summary ? `UGX ${Math.round(summary.paidThisYearUgx).toLocaleString('en-UG')}` : 'UGX 0'}
            subline={`${summary?.paidCountThisYear ?? 0} settled claim(s)`}
            loading={claimsQuery.isLoading}
          />
        </div>
      )}

      {!unlinkedSelf && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs sm:grid-cols-2">
          <Input
            type="search"
            aria-label="Search reimbursement claims"
            placeholder={manage ? 'Search employee, category, or description...' : 'Search description or category...'}
            leftIcon={<Search className="h-4 w-4" />}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as 'all' | ReimbursementStatus)}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'needs_information', label: 'Needs Info' },
              { value: 'approved', label: 'Approved' },
              { value: 'paid', label: 'Paid' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'withdrawn', label: 'Withdrawn' },
            ]}
          />
        </div>
      )}

      {claimsQuery.isError ? (
        <div className="rounded-lg border border-rose/30 bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            tone="rose"
            title="Reimbursement claims could not be loaded"
            description={claimsQuery.error instanceof Error ? claimsQuery.error.message : 'Please try again.'}
            action={<Button variant="outline" onClick={() => void claimsQuery.refetch()}>Try Again</Button>}
          />
        </div>
      ) : unlinkedSelf ? (
        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<ShieldAlert className="h-6 w-6" />}
            tone="amber"
            title="Employee dossier not linked"
            description="Ask HR to link your login account to an active employee profile before submitting personal reimbursement claims."
          />
        </div>
      ) : filteredItems.length === 0 && !claimsQuery.isLoading ? (
        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="No reimbursement claims found"
            description={
              manage
                ? 'No personal reimbursement claims match the selected filter.'
                : 'Submit an out-of-pocket receipt claim to track approval and payment here.'
            }
          />
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface shadow-xs overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line bg-canvas/60 text-muted uppercase">
              <tr>
                {manage && <th className="px-4 py-3">Employee</th>}
                <th className="px-4 py-3">Date & Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Receipts</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredItems.map((claim) => (
                <tr key={claim.id} className="align-top">
                  {manage && (
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{claim.employee_name}</div>
                      <div className="text-muted">{claim.employee_number}</div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{categoryLabel(claim.category)}</div>
                    <div className="text-muted">{claim.spent_on}</div>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-ink break-words">{claim.description}</p>
                    {claim.review_note && (
                      <p className="mt-1 text-[11px] text-soft">Note: {claim.review_note}</p>
                    )}
                    {claim.status === 'paid' && claim.paid_at && (
                      <p className="mt-1 text-[11px] text-emerald-600">
                        Paid {claim.paid_at} ({paymentMethodLabel(claim.payment_method)})
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                    {formatMoney(claim.amount, claim.currency_code)}
                  </td>
                  <td className="px-4 py-3 text-muted">{claim.receipts.length} file(s)</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={statusTone(claim.status)} size="sm">
                      {statusLabel(claim.status)}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      leftIcon={<Eye className="h-3.5 w-3.5" />}
                      onClick={() => setSelectedClaim(claim)}
                    >
                      Details
                    </Button>
                    {!manage && claim.status === 'needs_information' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        leftIcon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => openResubmit(claim)}
                      >
                        Edit & Resubmit
                      </Button>
                    )}
                    {!manage &&
                      (claim.status === 'pending' || claim.status === 'needs_information') && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={withdrawMutation.isPending}
                          onClick={() => withdrawMutation.mutate(claim)}
                        >
                          Withdraw
                        </Button>
                      )}
                    {manage && canReview && claim.status === 'pending' && claim.is_own_claim && !claim.can_self_handle && (
                      <StatusPill tone="neutral" size="sm">
                        Separate reviewer required
                      </StatusPill>
                    )}
                    {manage && canReview && claim.status === 'pending' && (!claim.is_own_claim || claim.can_self_handle) && (
                      <>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setReviewError(null)
                            setReviewState({ claim, decision: 'approved', note: '' })
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setReviewError(null)
                            setReviewState({ claim, decision: 'needs_information', note: '' })
                          }}
                        >
                          Request Info
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          leftIcon={<XCircle className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setReviewError(null)
                            setReviewState({ claim, decision: 'rejected', note: '' })
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {manage && canPay && claim.status === 'approved' && claim.is_own_claim && !claim.can_self_handle && (
                      <StatusPill tone="neutral" size="sm">
                        Separate payer required
                      </StatusPill>
                    )}
                    {manage && canPay && claim.status === 'approved' && (!claim.is_own_claim || claim.can_self_handle) && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        leftIcon={<CreditCard className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setPayError(null)
                          setPayState({
                            claim,
                            paymentMethod: 'bank_transfer',
                            paidAt: todayKampalaIso(),
                            paymentReference: '',
                            selfPaymentNote: '',
                          })
                        }}
                      >
                        Mark Paid
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedClaim && (
        <ClaimDetailDialog
          claim={selectedClaim}
          onClose={closeDetail}
          onDownloadReceipt={(r) => void handleDownloadReceipt(r)}
          downloadingPath={downloadingPath}
          footer={
            <div className="flex justify-end gap-2 w-full">
              {!manage && selectedClaim.status === 'needs_information' && (
                <Button variant="primary" size="sm" onClick={() => openResubmit(selectedClaim)}>
                  Edit & Resubmit
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={closeDetail}>
                Close
              </Button>
            </div>
          }
        />
      )}

      {draft && (
        <Dialog
          open={Boolean(draft)}
          onOpenChange={(open) => {
            if (!open && !submitMutation.isPending) setDraft(null)
          }}
          className="max-w-xl"
          title={draft.mode === 'create' ? 'Submit Personal Reimbursement' : 'Edit & Resubmit Claim'}
          description="Attach up to 5 private receipts (PDF or image, max 10 MB each)."
        >
          <form onSubmit={handleDraftSubmit} className="space-y-4">
            {draftError && <FieldError error={draftError} />}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label required>Category</Label>
                <Select
                  value={draft.category}
                  onValueChange={(value) =>
                    setDraft({ ...draft, category: value as ReimbursementCategory })
                  }
                  options={[...REIMBURSEMENT_CATEGORIES]}
                />
              </div>

              <div>
                <Label required htmlFor="rmb-spent-on">Date Spent</Label>
                <Input
                  id="rmb-spent-on"
                  type="date"
                  max={todayKampalaIso()}
                  value={draft.spentOn}
                  onChange={(e) => setDraft({ ...draft, spentOn: e.target.value })}
                />
              </div>

              <div>
                <Label required htmlFor="rmb-amount">Amount</Label>
                <Input
                  id="rmb-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                />
              </div>

              <div>
                <Label required>Currency</Label>
                <Select
                  value={draft.currencyCode}
                  onValueChange={(value) =>
                    setDraft({ ...draft, currencyCode: value as ReimbursementCurrency })
                  }
                  options={REIMBURSEMENT_CURRENCIES.map((c) => ({ value: c, label: c }))}
                />
              </div>
            </div>

            <div>
              <Label required htmlFor="rmb-desc">Description</Label>
              <textarea
                id="rmb-desc"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Explain the business purpose of this expense..."
                className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20"
              />
            </div>

            {draft.keptReceipts.length > 0 && (
              <div className="space-y-1.5">
                <Label>Existing Receipts</Label>
                <ul className="divide-y divide-line rounded-md border border-line text-xs">
                  {draft.keptReceipts.map((r) => (
                    <li key={r.storage_path} className="flex items-center justify-between px-3 py-2">
                      <span className="truncate text-ink">{r.original_file_name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            keptReceipts: draft.keptReceipts.filter(
                              (item) => item.storage_path !== r.storage_path,
                            ),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rmb-files">Upload Receipt Files (Optional, max 5 total)</Label>
              <input
                id="rmb-files"
                type="file"
                multiple
                accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : []
                  setDraft({ ...draft, newFiles: [...draft.newFiles, ...files].slice(0, 5) })
                }}
                className="block w-full text-xs text-soft file:mr-3 file:rounded-md file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
              />
              {draft.newFiles.length > 0 && (
                <ul className="space-y-1 text-xs text-muted">
                  {draft.newFiles.map((f, idx) => (
                    <li key={`${f.name}-${idx}`} className="flex items-center justify-between">
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            newFiles: draft.newFiles.filter((_, i) => i !== idx),
                          })
                        }
                        className="text-rose hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitMutation.isPending}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitMutation.isPending}>
                {submitMutation.isPending
                  ? 'Submitting…'
                  : draft.mode === 'create'
                    ? 'Submit Claim'
                    : 'Resubmit Claim'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {reviewState && (
        <Dialog
          open={Boolean(reviewState)}
          onOpenChange={(open) => {
            if (!open && !decideMutation.isPending) setReviewState(null)
          }}
          title={
            reviewState.decision === 'approved'
              ? 'Approve Reimbursement Claim'
              : reviewState.decision === 'needs_information'
                ? 'Request Clarification'
                : 'Reject Reimbursement Claim'
          }
          description={`${reviewState.claim.employee_name} · ${formatMoney(reviewState.claim.amount, reviewState.claim.currency_code)}`}
        >
          <form onSubmit={handleReviewSubmit} className="space-y-4">
            {reviewError && <FieldError error={reviewError} />}

            {reviewState.claim.is_own_claim && (
              <div className="rounded-md border border-amber/40 bg-amber-tint p-3 text-xs text-ink">
                <p className="font-semibold">Executive self-review note required</p>
                <p className="mt-0.5 text-soft">
                  You are reviewing your own claim under the executive HR/CFO exception. Provide a clear note (3+
                  characters); the audit trail will record <code className="font-mono">self_reviewed</code>
                  {reviewState.decision === 'approved' ? (
                    <>
                      {' '}and <code className="font-mono">self_approved</code>
                    </>
                  ) : null}
                  .
                </p>
              </div>
            )}

            <div>
              <Label
                required={
                  reviewState.decision !== 'approved' || Boolean(reviewState.claim.is_own_claim)
                }
                htmlFor="rmb-review-note"
              >
                Review Note
              </Label>
              <textarea
                id="rmb-review-note"
                rows={3}
                value={reviewState.note}
                onChange={(e) => setReviewState({ ...reviewState, note: e.target.value })}
                placeholder={
                  reviewState.decision === 'approved' && !reviewState.claim.is_own_claim
                    ? 'Optional approval note...'
                    : 'Enter clear note (minimum 3 characters)...'
                }
                className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={decideMutation.isPending}
                onClick={() => setReviewState(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={reviewState.decision === 'rejected' ? 'danger' : 'primary'}
                disabled={decideMutation.isPending}
              >
                {decideMutation.isPending
                  ? 'Saving…'
                  : reviewState.decision === 'approved'
                    ? 'Confirm Approval'
                    : reviewState.decision === 'needs_information'
                      ? 'Send Question'
                      : 'Confirm Rejection'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {payState && (
        <Dialog
          open={Boolean(payState)}
          onOpenChange={(open) => {
            if (!open && !payMutation.isPending) setPayState(null)
          }}
          title="Record Reimbursement Payment"
          description={`${payState.claim.employee_name} · ${formatMoney(payState.claim.amount, payState.claim.currency_code)}`}
        >
          <form onSubmit={handlePaySubmit} className="space-y-4">
            {payError && <FieldError error={payError} />}
            <div>
              <Label required>Payment Method</Label>
              <Select
                value={payState.paymentMethod}
                onValueChange={(value) =>
                  setPayState({ ...payState, paymentMethod: value as ReimbursementPaymentMethod })
                }
                options={[...REIMBURSEMENT_PAYMENT_METHODS]}
              />
            </div>
            <div>
              <Label required htmlFor="rmb-paid-at">Paid Date</Label>
              <Input
                id="rmb-paid-at"
                type="date"
                max={todayKampalaIso()}
                value={payState.paidAt}
                onChange={(e) => setPayState({ ...payState, paidAt: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="rmb-pay-ref">Payment Reference (Optional)</Label>
              <Input
                id="rmb-pay-ref"
                value={payState.paymentReference}
                onChange={(e) => setPayState({ ...payState, paymentReference: e.target.value })}
                placeholder="e.g. EFT-9021 / MM-7788"
              />
            </div>
            {payState.claim.is_own_claim && (
              <>
                <div className="rounded-md border border-amber/40 bg-amber-tint p-3 text-xs text-ink">
                  <p className="font-semibold">Executive self-payment note required</p>
                  <p className="mt-0.5 text-soft">
                    You are recording settlement on your own claim under the executive HR/CFO exception. Provide a
                    note (3+ characters); this will be audited as <code className="font-mono">self_paid</code>.
                  </p>
                </div>
                <div>
                  <Label required htmlFor="rmb-self-pay-note">
                    Self-payment Note
                  </Label>
                  <textarea
                    id="rmb-self-pay-note"
                    rows={2}
                    value={payState.selfPaymentNote}
                    onChange={(e) =>
                      setPayState({ ...payState, selfPaymentNote: e.target.value })
                    }
                    placeholder="Document settlement evidence or voucher justification..."
                    className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20"
                  />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={payMutation.isPending}
                onClick={() => setPayState(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={payMutation.isPending}>
                {payMutation.isPending ? 'Recording…' : 'Mark Paid'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  )
}
