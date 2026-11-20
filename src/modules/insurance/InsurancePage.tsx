import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
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
import { useHasPermission } from '@/modules/auth/AuthProvider'
import { useEmployees } from '@/modules/hr/api/employees'
import {
  insuranceApi,
  type ManageInsurancePolicy,
  type MyInsurancePolicy,
  type PolicyDisplayStatus,
  type PolicyStatus,
  type SaveInsurancePolicyInput,
} from './api'

function formatUgx(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `UGX ${Math.round(value).toLocaleString('en-UG')}`
}

function statusTone(status: PolicyDisplayStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success'
  if (status === 'expired') return 'danger'
  if (status === 'lapsed') return 'warning'
  return 'neutral'
}

function statusLabel(status: PolicyDisplayStatus): string {
  if (status === 'active') return 'Active'
  if (status === 'expired') return 'Expired'
  if (status === 'lapsed') return 'Lapsed'
  return 'Cancelled'
}

function RenewalBadge({ policy }: { policy: Pick<MyInsurancePolicy, 'display_status' | 'renewing_soon' | 'days_to_renewal'> }) {
  if (policy.display_status === 'expired') {
    const overdue = policy.days_to_renewal !== null ? Math.abs(policy.days_to_renewal) : null
    return (
      <StatusPill tone="danger" size="sm">
        {overdue !== null ? `Expired ${overdue}d ago` : 'Expired'}
      </StatusPill>
    )
  }
  if (policy.renewing_soon && policy.days_to_renewal !== null) {
    return (
      <StatusPill tone="warning" size="sm">
        Renewing in {policy.days_to_renewal}d
      </StatusPill>
    )
  }
  return null
}

function SelfInsuranceView() {
  const query = useQuery({
    queryKey: ['insurance', 'mine'],
    queryFn: () => insuranceApi.listMine(),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My Workspace"
        title="My Health Insurance"
        subtitle="View your active health insurance cover details, policy numbers, and renewal schedule."
      />

      {query.isError ? (
        <div className="rounded-lg border border-rose/30 bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            tone="rose"
            title="Could not load insurance cover"
            description={query.error instanceof Error ? query.error.message : 'Please try again.'}
            action={<Button variant="outline" onClick={() => void query.refetch()}>Try Again</Button>}
          />
        </div>
      ) : query.isLoading ? (
        <p role="status" className="rounded-lg border border-line bg-surface p-6 text-sm text-muted">
          Loading your health insurance cover…
        </p>
      ) : query.data && !query.data.linked ? (
        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<ShieldAlert className="h-6 w-6" />}
            tone="amber"
            title="Employee dossier not linked"
            description="Your login profile is not linked to an active employee dossier yet. Ask HR to link your employee profile to display cover details."
          />
        </div>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title="No health insurance policy recorded"
            description="No active or historical health insurance policy is currently attached to your profile."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {query.data?.items.map((policy) => (
            <article
              key={policy.id}
              className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-bold text-ink">{policy.insurer}</h2>
                  <p className="text-xs text-muted">{policy.plan_tier || 'Standard Cover'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill tone={statusTone(policy.display_status)} size="sm">
                    {statusLabel(policy.display_status)}
                  </StatusPill>
                  <RenewalBadge policy={policy} />
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-xs border-t border-line pt-3">
                <div>
                  <dt className="text-muted">Policy Number</dt>
                  <dd className="mt-0.5 font-medium text-ink">{policy.policy_number || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Member Number</dt>
                  <dd className="mt-0.5 font-medium text-ink">{policy.member_number || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Start Date</dt>
                  <dd className="mt-0.5 font-medium text-ink">{policy.start_date || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Renewal Date</dt>
                  <dd className="mt-0.5 font-medium text-ink">{policy.renewal_date || '—'}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

interface PolicyFormState {
  policyId: string | null
  expectedVersion: number | null
  employeeId: string
  insurer: string
  planTier: string
  policyNumber: string
  memberNumber: string
  startDate: string
  renewalDate: string
  premiumAmountUgx: string
  dependantsCount: string
  dependantNames: string
  status: PolicyStatus
  notes: string
}

function emptyPolicyForm(existing?: ManageInsurancePolicy): PolicyFormState {
  if (!existing) {
    return {
      policyId: null,
      expectedVersion: null,
      employeeId: '',
      insurer: '',
      planTier: '',
      policyNumber: '',
      memberNumber: '',
      startDate: '',
      renewalDate: '',
      premiumAmountUgx: '',
      dependantsCount: '0',
      dependantNames: '',
      status: 'active',
      notes: '',
    }
  }
  return {
    policyId: existing.id,
    expectedVersion: existing.version,
    employeeId: existing.employee_id,
    insurer: existing.insurer,
    planTier: existing.plan_tier ?? '',
    policyNumber: existing.policy_number ?? '',
    memberNumber: existing.member_number ?? '',
    startDate: existing.start_date ?? '',
    renewalDate: existing.renewal_date ?? '',
    premiumAmountUgx: existing.premium_amount_ugx !== null ? String(existing.premium_amount_ugx) : '',
    dependantsCount: String(existing.dependants_count),
    dependantNames: existing.dependant_names ?? '',
    status: existing.status,
    notes: existing.notes ?? '',
  }
}

function ManageInsuranceView() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const canManage = useHasPermission('insurance.manage')

  const insuranceQuery = useQuery({
    queryKey: ['insurance', 'manage'],
    queryFn: () => insuranceApi.listManage(),
  })
  const employeesQuery = useEmployees()

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editing, setEditing] = useState<PolicyFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [archivingPolicy, setArchivingPolicy] = useState<ManageInsurancePolicy | null>(null)

  const saveMutation = useMutation({
    mutationFn: (input: SaveInsurancePolicyInput) => insuranceApi.savePolicy(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['insurance'] })
      setEditing(null)
      setFormError(null)
      toast('Policy saved', { description: 'Health insurance cover updated cleanly.', tone: 'success' })
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Could not save policy.')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (policy: ManageInsurancePolicy) =>
      insuranceApi.archivePolicy(policy.id, policy.version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['insurance'] })
      setArchivingPolicy(null)
      toast('Policy archived', { description: 'Health insurance policy removed from active list.', tone: 'info' })
    },
    onError: (err) => {
      toast('Archive failed', {
        description: err instanceof Error ? err.message : 'Could not archive policy.',
        tone: 'danger',
      })
    },
  })

  const items = insuranceQuery.data?.items ?? []
  const summary = insuranceQuery.data?.summary

  const filteredItems = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      if (needle) {
        const hay = `${item.employee_name} ${item.employee_number} ${item.insurer} ${item.policy_number ?? ''} ${item.member_number ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (statusFilter === 'renewing_soon') return item.renewing_soon
      if (statusFilter === 'all') return true
      return item.display_status === statusFilter
    })
  }, [items, searchQuery, statusFilter])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setFormError(null)

    if (!editing.employeeId) {
      setFormError('Choose an employee.')
      return
    }
    if (!editing.insurer.trim()) {
      setFormError('Insurer name is required.')
      return
    }
    if (editing.startDate && editing.renewalDate && editing.renewalDate < editing.startDate) {
      setFormError('Renewal date must be on or after start date.')
      return
    }
    const depCount = Number(editing.dependantsCount || '0')
    if (!Number.isInteger(depCount) || depCount < 0 || depCount > 20) {
      setFormError('Dependants count must be a whole number from 0 to 20.')
      return
    }
    const premium = editing.premiumAmountUgx.trim() ? Number(editing.premiumAmountUgx.trim()) : null
    if (premium !== null && (!Number.isFinite(premium) || premium < 0)) {
      setFormError('Enter a valid non-negative annual premium.')
      return
    }

    saveMutation.mutate({
      policyId: editing.policyId,
      expectedVersion: editing.expectedVersion,
      employeeId: editing.employeeId,
      insurer: editing.insurer,
      planTier: editing.planTier || null,
      policyNumber: editing.policyNumber || null,
      memberNumber: editing.memberNumber || null,
      startDate: editing.startDate || null,
      renewalDate: editing.renewalDate || null,
      premiumAmountUgx: premium,
      dependantsCount: depCount,
      dependantNames: editing.dependantNames || null,
      status: editing.status,
      notes: editing.notes || null,
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People & Benefits"
        title="Health Insurance Register"
        subtitle="Track staff medical policies, dependants, annual premiums, and upcoming 60-day renewals."
        actions={
          canManage ? (
            <Button
              variant="primary"
              size="md"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setFormError(null)
                setEditing(emptyPolicyForm())
              }}
            >
              Add Policy
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5" />}
          tone="emerald"
          title="Active Policies"
          value={summary?.activePolicies ?? 0}
          loading={insuranceQuery.isLoading}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          tone="violet"
          title="Staff Covered"
          value={`${summary?.coveredEmployees ?? 0} / ${summary?.activeEmployees ?? 0}`}
          subline="Covered vs active employees"
          loading={insuranceQuery.isLoading}
        />
        <KpiCard
          icon={<CalendarClock className="h-5 w-5" />}
          tone={(summary?.renewingSoonCount ?? 0) > 0 ? 'amber' : 'neutral'}
          title="Renewing (60d)"
          value={summary?.renewingSoonCount ?? 0}
          loading={insuranceQuery.isLoading}
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={(summary?.expiredActiveCount ?? 0) > 0 ? 'rose' : 'neutral'}
          title="Expired While Active"
          value={summary?.expiredActiveCount ?? 0}
          loading={insuranceQuery.isLoading}
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5" />}
          tone="blue"
          title="Annual Premium"
          value={formatUgx(summary?.annualPremiumUgx ?? 0)}
          subline="Active policy spend"
          loading={insuranceQuery.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs sm:grid-cols-2">
        <Input
          type="search"
          aria-label="Search policies"
          placeholder="Search employee, insurer, policy or member #..."
          leftIcon={<Search className="h-4 w-4" />}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: 'all', label: 'All Statuses' },
            { value: 'active', label: 'Active' },
            { value: 'renewing_soon', label: 'Renewing Within 60 Days' },
            { value: 'expired', label: 'Expired' },
            { value: 'lapsed', label: 'Lapsed' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
      </div>

      {insuranceQuery.isError ? (
        <div className="rounded-lg border border-rose/30 bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            tone="rose"
            title="Could not load health insurance register"
            description={insuranceQuery.error instanceof Error ? insuranceQuery.error.message : 'Please retry.'}
            action={<Button variant="outline" onClick={() => void insuranceQuery.refetch()}>Try Again</Button>}
          />
        </div>
      ) : filteredItems.length === 0 && !insuranceQuery.isLoading ? (
        <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title="No matching policies"
            description="Adjust your search filter or add a health insurance policy for an active employee."
          />
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface shadow-xs overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line bg-canvas/60 text-muted uppercase">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Insurer & Plan</th>
                <th className="px-4 py-3">Policy / Member #</th>
                <th className="px-4 py-3">Dates & Renewal</th>
                <th className="px-4 py-3">Dependants</th>
                <th className="px-4 py-3 text-right">Annual Premium</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredItems.map((policy) => (
                <tr key={policy.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{policy.employee_name}</div>
                    <div className="text-muted">{policy.employee_number}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{policy.insurer}</div>
                    <div className="text-muted">{policy.plan_tier || 'Standard'}</div>
                    {policy.notes && <p className="mt-1 text-[11px] text-soft">{policy.notes}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{policy.policy_number || '—'}</div>
                    <div className="text-muted">{policy.member_number || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">
                      {policy.start_date || '—'} → {policy.renewal_date || '—'}
                    </div>
                    <div className="mt-1">
                      <RenewalBadge policy={policy} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{policy.dependants_count}</div>
                    {policy.dependant_names && (
                      <div className="text-muted max-w-[180px] break-words">{policy.dependant_names}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                    {formatUgx(policy.premium_amount_ugx)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={statusTone(policy.display_status)} size="sm">
                      {statusLabel(policy.display_status)}
                    </StatusPill>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit policy for ${policy.employee_name}`}
                        leftIcon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setFormError(null)
                          setEditing(emptyPolicyForm(policy))
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Archive policy for ${policy.employee_name}`}
                        leftIcon={<Archive className="h-3.5 w-3.5" />}
                        onClick={() => setArchivingPolicy(policy)}
                      >
                        Archive
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Dialog
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open && !saveMutation.isPending) setEditing(null)
          }}
          className="max-w-2xl"
          title={editing.policyId ? 'Edit Health Insurance Policy' : 'Add Health Insurance Policy'}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && <FieldError error={formError} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label required>Employee</Label>
                <Select
                  value={editing.employeeId}
                  onValueChange={(value) => setEditing({ ...editing, employeeId: value })}
                  placeholder="Select active employee"
                  disabled={Boolean(editing.policyId)}
                  options={(employeesQuery.data ?? [])
                    .filter((emp) => !emp.archivedAt)
                    .map((emp) => ({
                      value: emp.id,
                      label: `${emp.legalName} (${emp.employeeNumber})`,
                    }))}
                />
              </div>

              <div>
                <Label required htmlFor="ins-insurer">Insurer</Label>
                <Input
                  id="ins-insurer"
                  value={editing.insurer}
                  onChange={(e) => setEditing({ ...editing, insurer: e.target.value })}
                  placeholder="e.g. UAP Old Mutual"
                />
              </div>

              <div>
                <Label htmlFor="ins-plan">Plan Tier</Label>
                <Input
                  id="ins-plan"
                  value={editing.planTier}
                  onChange={(e) => setEditing({ ...editing, planTier: e.target.value })}
                  placeholder="e.g. Gold Family"
                />
              </div>

              <div>
                <Label htmlFor="ins-policy-no">Policy Number</Label>
                <Input
                  id="ins-policy-no"
                  value={editing.policyNumber}
                  onChange={(e) => setEditing({ ...editing, policyNumber: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="ins-member-no">Member Number</Label>
                <Input
                  id="ins-member-no"
                  value={editing.memberNumber}
                  onChange={(e) => setEditing({ ...editing, memberNumber: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="ins-start">Start Date</Label>
                <Input
                  id="ins-start"
                  type="date"
                  value={editing.startDate}
                  onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="ins-renewal">Renewal Date</Label>
                <Input
                  id="ins-renewal"
                  type="date"
                  value={editing.renewalDate}
                  onChange={(e) => setEditing({ ...editing, renewalDate: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="ins-premium">Annual Premium (UGX)</Label>
                <Input
                  id="ins-premium"
                  type="number"
                  min={0}
                  step="1"
                  value={editing.premiumAmountUgx}
                  onChange={(e) => setEditing({ ...editing, premiumAmountUgx: e.target.value })}
                />
              </div>

              <div>
                <Label>Status</Label>
                <Select
                  value={editing.status}
                  onValueChange={(value) => setEditing({ ...editing, status: value as PolicyStatus })}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'lapsed', label: 'Lapsed' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ]}
                />
              </div>

              <div>
                <Label htmlFor="ins-deps">Dependants Count</Label>
                <Input
                  id="ins-deps"
                  type="number"
                  min={0}
                  max={20}
                  value={editing.dependantsCount}
                  onChange={(e) => setEditing({ ...editing, dependantsCount: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="ins-dep-names">Dependant Names (HR/Finance Only)</Label>
                <Input
                  id="ins-dep-names"
                  value={editing.dependantNames}
                  onChange={(e) => setEditing({ ...editing, dependantNames: e.target.value })}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="ins-notes">HR Notes (Redacted from Employee View)</Label>
                <Input
                  id="ins-notes"
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saveMutation.isPending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save Policy'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {archivingPolicy && (
        <Dialog
          open={Boolean(archivingPolicy)}
          onOpenChange={(open) => {
            if (!open && !archiveMutation.isPending) setArchivingPolicy(null)
          }}
          title="Archive Health Insurance Policy"
          description={`Remove ${archivingPolicy.insurer} policy for ${archivingPolicy.employee_name} from the active register?`}
          footer={
            <div className="flex justify-end gap-2 w-full">
              <Button
                type="button"
                variant="outline"
                disabled={archiveMutation.isPending}
                onClick={() => setArchivingPolicy(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={archiveMutation.isPending}
                onClick={() => archiveMutation.mutate(archivingPolicy)}
              >
                {archiveMutation.isPending ? 'Archiving…' : 'Confirm Archive'}
              </Button>
            </div>
          }
        />
      )}
    </div>
  )
}

export default function InsurancePage({ manage = false }: { manage?: boolean }) {
  return manage ? <ManageInsuranceView /> : <SelfInsuranceView />
}
