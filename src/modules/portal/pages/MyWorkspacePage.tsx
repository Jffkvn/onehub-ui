import {
  AlertCircle,
  AlertTriangle,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  FileText,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { PageHeader } from '@/components/patterns/PageHeader'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { IconChip } from '@/components/ui/IconChip'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { Avatar } from '@/components/ui/Wrappers'
import { PinnedAnnouncements } from '@/modules/announcements/PinnedAnnouncements'
import { useAuth } from '@/modules/auth/AuthProvider'
import { useMyProfile, type SelfServiceProfile } from '../api/selfService'
import { formatDate, formatLabel } from '@/modules/hr/lib/formatters'

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line/60 pb-2.5 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium text-muted shrink-0">{label}</dt>
      <dd className="text-xs font-semibold text-ink sm:text-right break-words">{value}</dd>
    </div>
  )
}

export function MyWorkspaceContent({
  profile,
  isProfileView = false,
}: {
  profile: SelfServiceProfile | null
  isProfileView?: boolean
}) {
  const { session } = useAuth()

  if (!profile) {
    return (
      <div className="rounded-lg border border-line bg-surface p-8 shadow-xs">
        <EmptyState
          icon={<AlertCircle className="h-6 w-6" />}
          tone="amber"
          title="Your employee profile is not linked yet"
          description={`Signed in as ${session?.email ?? 'your account'}. Ask HR or the OneHub administrator to link your account to your employee record.`}
        />
      </div>
    )
  }

  const primaryEmail = profile.companyEmail ?? profile.personalEmail ?? 'Not recorded'

  return (
    <div className="space-y-6">
      {/* Linked Employee Identity Card */}
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar name={profile.legalName} size="lg" />
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-muted">
                {profile.employeeNumber}
              </span>
              <StatusPill tone={profile.active ? 'success' : 'neutral'} size="sm">
                {profile.active ? 'Active' : 'Inactive'}
              </StatusPill>
            </div>
            <h2 className="font-display text-xl font-bold text-ink truncate">
              {profile.legalName}
            </h2>
            <p className="text-xs text-soft">
              {profile.jobTitleName ?? 'Role not assigned'} ·{' '}
              {profile.departmentName ?? 'Department not assigned'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="h-4 w-4 text-emerald shrink-0" />
          <span>Managed by HR</span>
        </div>
      </div>

      {/* Overview Assignment Summary */}
      {!isProfileView && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-xs space-y-3">
            <IconChip tone="violet" size="md" icon={<Building2 className="h-5 w-5" />} />
            <div className="min-w-0">
              <p className="font-body text-xs font-medium text-muted">Department</p>
              <p className="mt-0.5 font-display text-base font-bold text-ink break-words leading-snug">
                {profile.departmentName ?? 'Unassigned'}
              </p>
              <p className="mt-1 font-body text-[11px] text-soft break-words">
                {profile.jobTitleName ?? 'Role pending'}
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-xs space-y-3">
            <IconChip tone="emerald" size="md" icon={<BriefcaseBusiness className="h-5 w-5" />} />
            <div className="min-w-0">
              <p className="font-body text-xs font-medium text-muted">Pay Grade</p>
              <p className="mt-0.5 font-display text-base font-bold text-ink break-words leading-snug">
                {profile.payGradeName ?? 'Unassigned'}
              </p>
              <p className="mt-1 font-body text-[11px] text-soft">
                {formatLabel(profile.employmentType)}
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-xs space-y-3">
            <IconChip tone="blue" size="md" icon={<CalendarClock className="h-5 w-5" />} />
            <div className="min-w-0">
              <p className="font-body text-xs font-medium text-muted">Start Date</p>
              <p className="mt-0.5 font-display text-base font-bold text-ink tabular-nums">
                {formatDate(profile.startDate)}
              </p>
              <p className="mt-1 font-body text-[11px] text-soft">
                {formatLabel(profile.contractType)}
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-line bg-surface p-5 shadow-xs space-y-3">
            <IconChip tone="amber" size="md" icon={<ShieldCheck className="h-5 w-5" />} />
            <div className="min-w-0">
              <p className="font-body text-xs font-medium text-muted">Probation Status</p>
              <p className="mt-0.5 font-display text-base font-bold text-ink break-words leading-snug">
                {formatLabel(profile.probationStatus)}
              </p>
              <p className="mt-1 font-body text-[11px] text-soft">
                {profile.probationEndDate
                  ? `Review: ${formatDate(profile.probationEndDate)}`
                  : 'No review date set'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Read-Only Profile Cards (Strict Non-Confidential Self-Service Boundary) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <UserRound className="h-4 w-4 text-violet" />
            <h3 className="font-display text-sm font-bold text-ink">Personal Information</h3>
          </div>
          <dl className="space-y-2.5">
            <ProfileRow label="Full Name" value={profile.legalName} />
            <ProfileRow
              label="Employee Number"
              value={<span className="font-mono">{profile.employeeNumber}</span>}
            />
            <ProfileRow label="Company Email" value={profile.companyEmail ?? 'Not recorded'} />
            <ProfileRow label="Personal Email" value={profile.personalEmail ?? 'Not recorded'} />
          </dl>
        </section>

        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <BriefcaseBusiness className="h-4 w-4 text-emerald" />
            <h3 className="font-display text-sm font-bold text-ink">Employment Details</h3>
          </div>
          <dl className="space-y-2.5">
            <ProfileRow label="Position / Job Title" value={profile.jobTitleName ?? 'Not assigned'} />
            <ProfileRow label="Department" value={profile.departmentName ?? 'Not assigned'} />
            <ProfileRow label="Pay Grade" value={profile.payGradeName ?? 'Not assigned'} />
            <ProfileRow label="Employment Type" value={formatLabel(profile.employmentType)} />
            <ProfileRow label="Start Date" value={formatDate(profile.startDate)} />
          </dl>
        </section>

        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <ShieldCheck className="h-4 w-4 text-amber" />
            <h3 className="font-display text-sm font-bold text-ink">Contract &amp; Probation</h3>
          </div>
          <dl className="space-y-2.5">
            <ProfileRow label="Contract Type" value={formatLabel(profile.contractType)} />
            <ProfileRow
              label="Contract End Date"
              value={profile.endDate ? formatDate(profile.endDate) : 'Open-ended'}
            />
            <ProfileRow label="Probation Status" value={formatLabel(profile.probationStatus)} />
            <ProfileRow
              label="Probation End Date"
              value={formatDate(profile.probationEndDate)}
            />
          </dl>
        </section>

        <section className="rounded-lg border border-line bg-surface p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Phone className="h-4 w-4 text-cyan" />
            <h3 className="font-display text-sm font-bold text-ink">Contact Information</h3>
          </div>
          <dl className="space-y-2.5">
            <ProfileRow
              label="Work Phone"
              value={<span className="font-mono">{profile.workPhone ?? 'Not recorded'}</span>}
            />
            <ProfileRow
              label="Primary Email"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-muted" />
                  <span>{primaryEmail}</span>
                </span>
              }
            />
          </dl>
        </section>
      </div>

      {/* Workspace Notice */}
      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-xs text-soft shadow-xs">
        <FileText className="h-4 w-4 shrink-0 text-muted mt-0.5" />
        <p>
          These employment details come directly from your linked HR record. Contact Human Resources if any assignment or contact information needs an update.
        </p>
      </div>
    </div>
  )
}

export function MyWorkspacePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const isProfileView = location.pathname === '/my/profile'
  const { status } = useAuth()
  const isCheckingSession = status === 'initializing' || status === 'loading_access'

  const { data: profile, isLoading, isError, refetch } = useMyProfile()

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Employee Self-Service"
        title={isProfileView ? 'My Profile' : 'My Workspace'}
        subtitle={
          isProfileView
            ? 'Review your linked employment, assignment, and contact details.'
            : 'Your personal employment summary, department assignment, and HR record.'
        }
        actions={
          profile ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigate(isProfileView ? '/my' : '/my/profile')
              }}
            >
              {isProfileView ? 'Workspace Overview' : 'Focused Profile View'}
            </Button>
          ) : undefined
        }
      />

      {!isProfileView && <PinnedAnnouncements />}

      {isCheckingSession || isLoading ? (
        <div className="space-y-4">
          <Skeleton shape="card" className="h-28" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Skeleton shape="kpi" />
            <Skeleton shape="kpi" />
            <Skeleton shape="kpi" />
            <Skeleton shape="kpi" />
          </div>
          <Skeleton shape="card" className="h-48" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-line bg-surface p-8 shadow-xs">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            tone="rose"
            title="Your workspace could not be loaded"
            description="Try again or contact the OneHub administrator."
            action={
              <Button variant="secondary" onClick={() => void refetch()}>
                Try Again
              </Button>
            }
          />
        </div>
      ) : (
        <MyWorkspaceContent profile={profile ?? null} isProfileView={isProfileView} />
      )}
    </div>
  )
}
