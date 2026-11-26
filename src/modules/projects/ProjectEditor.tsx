import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/Button'
import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { FieldError, Input, Textarea } from '@/components/ui/Input'
import { isAbortError, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { listProjectTeamCandidates } from './team/teamApi'
import {
  createProject, initialProjectStatuses, ProjectWriteUnconfirmed, projectFields,
  projectHealths, projectKey, updateProject, type ProjectDetails, type ProjectFields,
} from './projectApi'
import { healthOptions, projectCardClass, projectFieldClass, projectLinkClass, projectSelectClass, statusOptions } from './projectDisplay'

type EditorProps = {
  scope: IdentityScopeRef
  canAssignAll: boolean
  project?: ProjectDetails
  onSaved: (id: string) => void
  onCancel?: () => void
}

type ProjectTeam = { primaryId: string | null; coordinators: string[] }
type SaveCommand = {
  fields: ProjectFields
  status: typeof initialProjectStatuses[number]
  team: ProjectTeam
  reason: string
}

function fieldValue(form: FormData, field: string) {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

function editorFields(form: FormData) {
  const optional = (key: string) => fieldValue(form, key) || null
  const budget = fieldValue(form, 'estimated_budget_ugx')
  return projectFields.safeParse({
    project_code: fieldValue(form, 'project_code'),
    name: fieldValue(form, 'name'),
    client_name: optional('client_name'),
    site_location: optional('site_location'),
    planned_start_date: optional('planned_start_date'),
    expected_end_date: optional('expected_end_date'),
    contract_reference: optional('contract_reference'),
    budget_reference: optional('budget_reference'),
    operational_notes: optional('operational_notes'),
    estimated_budget_ugx: budget ? Number(budget) : null,
    budget_notes: optional('budget_notes'),
    health_status: fieldValue(form, 'health_status'),
  })
}

function getChanges(original: ProjectDetails, fields: ProjectFields): Partial<ProjectFields> {
  const keys = Object.keys(fields) as Array<keyof ProjectFields>
  return Object.fromEntries(keys.filter((key) => fields[key] !== original[key]).map((key) => [key, fields[key]]))
}

function EditorInput({ label, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const hintId = useId()
  return <div className="space-y-1">
    <label className={projectFieldClass}><span>{label}</span><Input {...input} aria-describedby={hint ? hintId : undefined} /></label>
    {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
  </div>
}

export function ProjectEditor({ scope, project, canAssignAll, onSaved, onCancel }: EditorProps) {
  const editing = Boolean(project)
  // The form's baseline stays pinned while it is open so refetches do not
  // turn someone else's changes into edits made from this form.
  const [baseline] = useState(project)
  const formId = useId()
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const queryClient = useQueryClient()
  const candidates = useQuery({
    queryKey: [...projectKey(scope), 'assignment-options'],
    queryFn: ({ signal }) => listProjectTeamCandidates(scope, signal),
    enabled: !editing,
    retry: false,
  })
  const primaryOptions = (candidates.data ?? []).filter((option) => option.role_keys.includes('project_manager'))
  const coordinatorOptions = (candidates.data ?? []).filter((option) => option.role_keys.includes('coordinator'))
  const write = useMutation({
    mutationFn: async ({ fields, status, team, reason }: SaveCommand) => {
      if (!baseline) return createProject(scope, fields, status, team, reason)
      const changes = getChanges(baseline, fields)
      if (!Object.keys(changes).length) throw new Error('Change at least one project field before saving.')
      await updateProject(scope, baseline.id, changes, reason)
      return baseline.id
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    retry: false,
  })
  const unconfirmed = write.error instanceof ProjectWriteUnconfirmed

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (lock.current || unconfirmed) return
    setError('')
    write.reset()
    const form = new FormData(event.currentTarget)
    const fields = editorFields(form)
    if (!fields.success) {
      setError(fields.error.issues[0]?.message ?? 'Check the project information.')
      return
    }
    const reason = fieldValue(form, 'reason')
    if (reason.length < 3) {
      setError('Enter a reason of at least three characters.')
      return
    }
    const status = editing ? 'planned' : z.enum(initialProjectStatuses).parse(fieldValue(form, 'status'))
    const primaryId = canAssignAll ? fieldValue(form, 'primaryId') || null : scope.identityKey
    const coordinators = form.getAll('coordinators').filter((value): value is string => typeof value === 'string')

    lock.current = true
    try {
      const id = await write.mutateAsync({ fields: fields.data, status, team: { primaryId, coordinators }, reason })
      onSaved(id)
    } catch {
      // Mutation errors are displayed beside the submit action.
    } finally {
      lock.current = false
    }
  }

  const fieldset = <form id={formId} onChange={() => setDirty(true)} onSubmit={(event) => void save(event)} className="space-y-5">
    <fieldset disabled={write.isPending || unconfirmed} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <EditorInput name="project_code" label="Project code" required minLength={2} maxLength={50}
          defaultValue={baseline?.project_code} placeholder="e.g. UG-101" />
        <EditorInput name="name" label="Project name" required maxLength={250} defaultValue={baseline?.name} />
        <EditorInput name="client_name" label="Client" maxLength={250} defaultValue={baseline?.client_name ?? ''} />
        <EditorInput name="site_location" label="Site location" maxLength={250} defaultValue={baseline?.site_location ?? ''} />
        <EditorInput name="planned_start_date" label="Planned start date" type="date" defaultValue={baseline?.planned_start_date ?? ''} />
        <EditorInput name="expected_end_date" label="Expected end date" type="date" defaultValue={baseline?.expected_end_date ?? ''} />
        {!editing && <label className={projectFieldClass}>
          <span>Initial status</span>
          <select name="status" defaultValue="planned" className={projectSelectClass}>
            {initialProjectStatuses.map((option) => <option key={option} value={option}>{statusOptions[option].label}</option>)}
          </select>
        </label>}
        <label className={projectFieldClass}>
          <span>Project health</span>
          <select name="health_status" defaultValue={baseline?.health_status ?? 'on_track'} className={projectSelectClass}>
            {projectHealths.map((option) => <option key={option} value={option}>{healthOptions[option].label}</option>)}
          </select>
        </label>
      </div>
      <details open={editing || undefined} className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">References and budget</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <EditorInput name="contract_reference" label="Client contract or work order number" hint="Use the number on the client’s signed contract or work order, if available." maxLength={250} defaultValue={baseline?.contract_reference ?? ''} />
          <EditorInput name="budget_reference" label="Internal budget code" hint="Use the code Finance assigned to this project’s budget, if available." maxLength={250} defaultValue={baseline?.budget_reference ?? ''} />
          <EditorInput name="estimated_budget_ugx" label="Estimated budget (UGX)" type="number" min={0} step="0.01"
            defaultValue={baseline?.estimated_budget_ugx ?? ''} />
          <EditorInput name="budget_notes" label="Budget notes" maxLength={2000} defaultValue={baseline?.budget_notes ?? ''} />
        </div>
      </details>
      <label className={projectFieldClass}><span>Operational notes</span>
        <Textarea name="operational_notes" maxLength={4000} defaultValue={baseline?.operational_notes ?? ''} />
      </label>
      {!editing && <section aria-label="Initial project team" className="space-y-3 border-t border-line pt-4">
        <h2 className="font-display text-base font-semibold text-ink">Initial team</h2>
        {candidates.isPending && <p role="status" className="text-sm text-muted">Loading assignment options…</p>}
        {candidates.isError && <div className="flex items-center gap-3">
          <FieldError>Could not load the team options.</FieldError>
          <Button type="button" variant="outline" size="sm" onClick={() => void candidates.refetch()}>Retry</Button>
        </div>}
        {canAssignAll ? (
          <label className={projectFieldClass}>
            <span>Primary project manager</span>
            <select name="primaryId" className={projectSelectClass}>
              <option value="">Assign later</option>
              {primaryOptions.map(({ profile_id, display_name }) => <option key={profile_id} value={profile_id}>{display_name}</option>)}
            </select>
          </label>
        ) : <p className="text-sm text-soft">You’ll be assigned as the primary project manager.</p>}
        {!!coordinatorOptions.length && <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Coordinators</legend>
          <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2">
            {coordinatorOptions.map(({ profile_id, display_name }) => (
              <label key={profile_id} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="coordinators" value={profile_id} className="accent-emerald" /> {display_name}
              </label>
            ))}
          </div>
        </fieldset>}
      </section>}
      <label className={projectFieldClass}><span>{editing ? 'Reason for the change' : 'Reason for creation'}</span>
        <Textarea name="reason" minLength={3} maxLength={500} required />
      </label>
    </fieldset>
    <FieldError error={error || (write.isError && !isAbortError(write.error) ? write.error.message : undefined)} />
    {unconfirmed && <Link className={projectLinkClass} to="/ops/projects">Check the project list</Link>}
  </form>

  const actions = <div className="flex flex-wrap justify-end gap-3">
    {editing ? <DialogClose asChild><Button type="button" variant="outline" disabled={write.isPending}>Cancel</Button></DialogClose>
      : <Link to="/ops/projects" className={projectLinkClass}>Cancel</Link>}
    <Button type="submit" form={formId} loading={write.isPending} disabled={unconfirmed}>
      {editing ? 'Save changes' : 'Create project'}
    </Button>
  </div>

  if (editing) return (
    <Dialog open title="Edit project" description={baseline?.name ?? 'Project details'} className="max-w-3xl"
      hasUnsavedChanges={dirty && !write.isPending} onOpenChange={(open) => { if (!open && !lock.current) onCancel?.() }}
      footer={actions}>
      {fieldset}
    </Dialog>
  )

  return <section className={projectCardClass}>{fieldset}{actions}</section>
}
