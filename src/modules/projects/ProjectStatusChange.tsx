import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, Textarea } from '@/components/ui/Input'
import { isAbortError, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import {
  changeProjectStatus, ProjectWriteUnconfirmed, projectKey, projectStatuses, readProjectCompletion, type ProjectIdentity, type ProjectStatus,
} from './projectApi'
import { projectFieldClass, projectSelectClass, statusOptions } from './projectDisplay'

interface TransitionProps {
  project: ProjectIdentity
  scope: IdentityScopeRef
  onClose: () => void
}

export function ProjectStatusChange({ project, scope, onClose }: TransitionProps) {
  const [target, setTarget] = useState<ProjectStatus>(project.status === 'planned' ? 'active' : 'planned')
  const [reason, setReason] = useState('')
  const lock = useRef(false)
  const queryClient = useQueryClient()
  const completion = useQuery({
    queryKey: [...projectKey(scope), 'completion', project.id],
    queryFn: () => readProjectCompletion(scope, project.id),
    enabled: target === 'completed',
    retry: false,
  })
  const write = useMutation({
    mutationFn: () => changeProjectStatus(scope, project.id, target, reason),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    retry: false,
  })
  const unconfirmed = write.error instanceof ProjectWriteUnconfirmed
  const allowSave = reason.trim().length >= 3 && !unconfirmed
    && (target !== 'completed' || (completion.isSuccess && !completion.isFetching && completion.data.can_complete))

  async function save() {
    if (!allowSave || lock.current) return
    lock.current = true
    try {
      await write.mutateAsync()
      onClose()
    } catch {
      // The response is shown in the open dialog.
    } finally {
      lock.current = false
    }
  }

  return <Dialog open title="Change project status" description={project.name}
    onOpenChange={(open) => { if (!open && !lock.current) onClose() }}
    footer={<>
      <Button type="button" variant="outline" disabled={write.isPending} onClick={onClose}>Cancel</Button>
      <Button type="button" disabled={!allowSave} loading={write.isPending} onClick={() => void save()}>Save status</Button>
    </>}>
    <div className="space-y-4">
      <label className={projectFieldClass}>
        <span>New status</span>
        <select className={projectSelectClass} value={target} disabled={write.isPending || unconfirmed}
          onChange={(event) => { setTarget(event.target.value as ProjectStatus); write.reset() }}>
          {projectStatuses.filter((option) => option !== project.status).map((option) => (
            <option key={option} value={option}>{statusOptions[option].label}</option>
          ))}
        </select>
      </label>
      {target === 'completed' && <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
        <h3 className="text-sm font-semibold text-ink">Completion checks</h3>
        {completion.isFetching && <p role="status" className="text-sm text-muted">Checking project cash and equipment…</p>}
        {completion.isError && <div className="flex items-center gap-3">
          <FieldError>Could not verify the completion checks.</FieldError>
          <Button type="button" size="sm" variant="outline" onClick={() => void completion.refetch()}>Retry</Button>
        </div>}
        {completion.data?.can_complete && !completion.isFetching && <p className="text-sm text-ink">Cash and equipment checks passed.</p>}
        {completion.data && !completion.data.can_complete && <>
          <ul className="space-y-2 text-sm text-ink">
            {completion.data.warnings.map(({ domain, message }) => (
              <li key={domain + message}><span className="font-semibold capitalize">{domain}</span><p>{message}</p></li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="outline" disabled={completion.isFetching}
            onClick={() => void completion.refetch()}>Recheck completion</Button>
        </>}
      </div>}
      <label className={projectFieldClass}>
        <span>Reason for status change</span>
        <Textarea maxLength={500} value={reason} disabled={write.isPending || unconfirmed} onChange={(event) => setReason(event.target.value)} />
      </label>
      {write.isError && !isAbortError(write.error) && <FieldError>{write.error.message}</FieldError>}
    </div>
  </Dialog>
}
