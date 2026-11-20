import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Textarea } from '@/components/ui/Input'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatDateTimeInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'

import {
  assignProjectTeamMember,
  listProjectTeamAssignments,
  listProjectTeamCandidates,
  removeProjectTeamMember,
  UnknownAssignmentOutcome,
  type ProjectTeamAssignment,
  type ProjectTeamCandidate,
  type ProjectTeamRole,
} from './teamApi'

type TeamAction =
  | { kind: 'assign'; role: ProjectTeamRole; previous?: ProjectTeamAssignment }
  | { kind: 'remove'; member: ProjectTeamAssignment }

const card = 'space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5'
const select = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald'
const heading = 'font-display text-base font-semibold text-ink'

function actionTitle(action: TeamAction) {
  if (action.kind === 'remove') return 'Remove coordinator'
  if (action.role === 'coordinator') return 'Add coordinator'
  return action.previous ? 'Replace primary PM' : 'Appoint primary PM'
}

function LoadingError({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FieldError error={text} />
      <Button type="button" variant="outline" size="sm" onClick={retry}>Retry</Button>
    </div>
  )
}

function TeamChangeDialog({
  action,
  candidates,
  scope,
  projectId,
  onClose,
  onSaved,
}: {
  action: TeamAction
  candidates: ProjectTeamCandidate[]
  scope: IdentityScopeRef
  projectId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [candidateId, setCandidateId] = useState('')
  const [reason, setReason] = useState('')
  const formId = useId()
  const saving = useRef(false)
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (trimmedReason: string) => action.kind === 'remove'
      ? removeProjectTeamMember(scope, action.member.id, trimmedReason)
      : assignProjectTeamMember(scope, projectId, candidateId, action.role, trimmedReason),
    retry: false,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
  const trimmedReason = reason.trim()
  const canSubmit = trimmedReason.length >= 3 && trimmedReason.length <= 500
    && (action.kind === 'remove' || candidates.some((candidate) => candidate.profile_id === candidateId))
    && !(change.error instanceof UnknownAssignmentOutcome)
  const title = actionTitle(action)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current || !canSubmit) return
    saving.current = true
    try {
      await change.mutateAsync(trimmedReason)
      onSaved()
    } catch {
      // Keep the entered values in the form when a change fails.
    } finally {
      saving.current = false
    }
  }

  let description = 'Enter the reason for changing the project team.'
  if (action.kind === 'remove') description = 'This ends the active assignment for ' + action.member.display_name + '.'
  else if (action.previous) description = 'This ends the active assignment for ' + action.previous.display_name + ' and appoints a new primary PM.'

  return (
    <Dialog open title={title} description={description}
      onOpenChange={(open) => { if (!open && !saving.current) onClose() }}
      footer={(
        <>
          <Button type="button" variant="outline" disabled={change.isPending} onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant={action.kind === 'remove' ? 'danger' : 'primary'}
            disabled={!canSubmit} loading={change.isPending}>{title}</Button>
        </>
      )}
    >
      <form id={formId} className="space-y-4" onSubmit={(event) => void save(event)}>
        {action.kind === 'assign' && (
          <FormGroup label="Team member" htmlFor={formId + '-member'}>
            <select id={formId + '-member'} className={select} value={candidateId} disabled={change.isPending}
              onChange={(event) => setCandidateId(event.target.value)}>
              <option value="">Select team member</option>
              {candidates.map((candidate) => <option key={candidate.profile_id} value={candidate.profile_id}>{candidate.display_name}</option>)}
            </select>
          </FormGroup>
        )}
        <FormGroup label="Reason" htmlFor={formId + '-reason'}>
          <Textarea id={formId + '-reason'} value={reason} minLength={3} maxLength={500} rows={3} disabled={change.isPending}
            onChange={(event) => setReason(event.target.value)} placeholder="Enter 3 to 500 characters" />
        </FormGroup>
        {change.isError && !isAbortError(change.error) && <FieldError error={change.error.message} />}
      </form>
    </Dialog>
  )
}

function TeamMember({ member, action }: { member: ProjectTeamAssignment; action?: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="break-words text-sm font-semibold text-ink">{member.display_name}</p>
        <p className="text-xs text-muted">Assigned {formatDateTimeInZone(member.assigned_at)}</p>
        <p className="break-words text-sm text-soft">{member.assignment_reason}</p>
      </div>
      {action && (
        <Button type="button" variant="outline" size="sm" aria-label={'Remove ' + member.display_name} onClick={action}>Remove</Button>
      )}
    </div>
  )
}

function TeamContent({ projectId, scope, actorId, permissions }: {
  projectId: string
  scope: IdentityScopeRef
  actorId: string
  permissions: string[]
}) {
  const [action, setAction] = useState<TeamAction>()
  const [notice, setNotice] = useState('')
  const queryKey = ['projects', scope.identityKey, scope.authEpoch, 'team'] as const

  const current = useQuery({
    queryKey: [...queryKey, projectId, 'active'],
    queryFn: ({ signal }) => listProjectTeamAssignments(scope, projectId, false, signal),
    retry: false,
  })
  const history = useQuery({
    queryKey: [...queryKey, projectId, 'history'],
    queryFn: ({ signal }) => listProjectTeamAssignments(scope, projectId, true, signal),
    retry: false,
  })
  const members = current.data ?? []
  const primary = members.find((member) => member.role_on_project === 'pm')
  const coordinators = members.filter((member) => member.role_on_project === 'coordinator')
  const canAssignAll = current.isSuccess && permissions.includes('projects.assign_all')
  const canManageCoordinators = canAssignAll || (current.isSuccess && primary?.user_id === actorId)
  const canListCandidates = canAssignAll || (canManageCoordinators && permissions.includes('projects.create'))
  const candidates = useQuery({
    queryKey: [...queryKey, 'candidates'],
    queryFn: ({ signal }) => listProjectTeamCandidates(scope, signal),
    enabled: canListCandidates,
    retry: false,
  })
  const available = candidates.data ?? []
  const availableManagers = available.filter((candidate) =>
    candidate.role_keys.includes('project_manager') && candidate.profile_id !== primary?.user_id)
  const availableCoordinators = available.filter((candidate) =>
    candidate.role_keys.includes('coordinator') && !coordinators.some((member) => member.user_id === candidate.profile_id))
  const ended = (history.data ?? []).filter((member) => member.unassigned_at !== null)

  function open(next: TeamAction) {
    setNotice('')
    setAction(next)
  }

  return (
    <div className="space-y-5">
      {notice && <p role="status" className="rounded-md bg-emerald-tint p-3 text-sm text-ink">{notice}</p>}
      {current.isPending && <p role="status" className="text-sm text-muted">Loading the project team…</p>}
      {current.isError && <LoadingError text="The current project team could not be loaded." retry={() => void current.refetch()} />}
      {current.isSuccess && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={card} aria-label="Primary project manager">
            <h3 className={heading}>Primary project manager</h3>
            {primary ? <TeamMember member={primary} /> : <p className="text-sm text-muted">No primary PM appointed.</p>}
            {canAssignAll && candidates.isSuccess && (
              <Button type="button" variant="outline" size="sm" disabled={availableManagers.length === 0}
                onClick={() => open({ kind: 'assign', role: 'pm', previous: primary })}>
                {primary ? 'Replace primary PM' : 'Appoint primary PM'}
              </Button>
            )}
            {canAssignAll && candidates.isSuccess && availableManagers.length === 0 && (
              <p className="text-xs text-muted">No eligible project managers are available.</p>
            )}
          </section>
          <section className={card} aria-label="Coordinators">
            <h3 className={heading}>Coordinators</h3>
            {coordinators.length ? (
              <ul className="divide-y divide-line">
                {coordinators.map((member) => (
                  <li key={member.id} className="py-3 first:pt-0 last:pb-0">
                    <TeamMember member={member} action={canManageCoordinators ? () => open({ kind: 'remove', member }) : undefined} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No coordinators assigned.</p>}
            {canListCandidates && candidates.isSuccess && (
              <Button type="button" variant="outline" size="sm" disabled={availableCoordinators.length === 0}
                onClick={() => open({ kind: 'assign', role: 'coordinator' })}>Add coordinator</Button>
            )}
            {canListCandidates && candidates.isSuccess && availableCoordinators.length === 0 && (
              <p className="text-xs text-muted">No eligible coordinators are available.</p>
            )}
          </section>
        </div>
      )}
      {canListCandidates && candidates.isPending && <p role="status" className="text-sm text-muted">Loading eligible team members…</p>}
      {canListCandidates && candidates.isError && (
        <LoadingError text="Eligible team members could not be loaded." retry={() => void candidates.refetch()} />
      )}
      <section className={card} aria-label="Assignment history">
        <h3 className={heading}>Assignment history</h3>
        {history.isPending && <p role="status" className="text-sm text-muted">Loading assignment history…</p>}
        {history.isError && <LoadingError text="Assignment history could not be loaded." retry={() => void history.refetch()} />}
        {history.isSuccess && (ended.length ? (
          <ul className="divide-y divide-line">
            {ended.map((member) => (
              <li key={member.id} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-2">
                <TeamMember member={member} />
                <div className="min-w-0">
                  <p className="text-xs text-muted">Ended {formatDateTimeInZone(member.unassigned_at)}</p>
                  <p className="break-words text-sm text-soft">{member.unassignment_reason}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No ended assignments.</p>)}
      </section>
      {action && (action.kind === 'assign' && action.role === 'pm' ? canAssignAll : canManageCoordinators) && (
        <TeamChangeDialog action={action} scope={scope} projectId={projectId}
          candidates={action.kind === 'assign' && action.role === 'pm' ? availableManagers : availableCoordinators}
          onClose={() => setAction(undefined)} onSaved={() => {
            setNotice(action.kind === 'remove' ? 'Coordinator removed.'
              : action.role === 'pm' ? 'Primary project manager saved.' : 'Coordinator assigned.')
            setAction(undefined)
          }} />
      )}
    </div>
  )
}

export function ProjectTeamPanel({ projectId }: { projectId: string; projectStatus: string }) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const actorId = auth.access?.profile?.id ?? scope.identityKey
  if (!scope.isAuthReady || !actorId) return null

  return <TeamContent key={JSON.stringify([scope.identityKey, scope.authEpoch, projectId])}
    scope={scope} projectId={projectId} actorId={actorId} permissions={auth.access?.permissionKeys ?? []} />
}
