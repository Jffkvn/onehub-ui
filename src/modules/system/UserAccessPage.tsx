import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ZodError } from 'zod'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Textarea } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { roleLabels } from '@/config/modules'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import { createUserAdministrationApi, type UserAccount, type RoleKey } from './userAdministration'

type Action = { kind: 'connect' } | { kind: 'edit' | 'status'; account: UserAccount }
const field = 'flex flex-col gap-1.5 text-sm font-medium text-ink'
const select = 'min-h-10 rounded-lg border border-line bg-surface px-3 text-sm'
const card = 'space-y-3 rounded-xl border border-line bg-surface p-4'
const pageSize = 20

function formText(body: FormData, name: string) {
  const value = body.get(name)
  return typeof value === 'string' ? value : ''
}

function UserAccessEditor({ action, scope, onClose, onSaved }: {
  action: Action
  scope: IdentityScopeRef
  onClose: () => void
  onSaved: (ownAccess: boolean) => void
}) {
  const api = createUserAdministrationApi(scope)
  const target = action.kind === 'connect' ? undefined : action.account
  const editingAccess = action.kind !== 'status'
  const targetStatus = target?.status === 'active' ? 'deactivated' : 'active'
  const title = action.kind === 'connect' ? 'Connect an Auth account'
    : action.kind === 'edit' ? 'Edit access' : targetStatus === 'active' ? 'Reactivate account' : 'Deactivate account'
  const [dirty, setDirty] = useState(false)
  const directoryOptions = useQuery({
    queryKey: ['system-access', scope.identityKey, scope.authEpoch, 'editor-options'],
    enabled: scope.isAuthReady && editingAccess,
    queryFn: async () => {
      const [roles, employees] = await Promise.all([api.listRoles(), api.listEmployees()])
      return { roles, employees }
    },
  })
  const save = useMutation({
    mutationFn: async (body: FormData) => {
      const reason = formText(body, 'reason')
      if (action.kind === 'status') return api.setStatus({ profileId: action.account.profileId, status: targetStatus, reason })
      const fields = {
        displayName: formText(body, 'displayName'),
        roleKeys: body.getAll('roles').filter((value) => typeof value === 'string') as RoleKey[],
        employeeId: formText(body, 'employeeId') || null,
        reason,
      }
      return action.kind === 'connect'
        ? api.connectUser({ ...fields, email: formText(body, 'email') })
        : api.updateAccess({ ...fields, profileId: action.account.profileId })
    },
    onSuccess: () => onSaved(Boolean(target?.isSelf)),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!save.isPending && (!editingAccess || directoryOptions.data)) {
      save.mutate(new FormData(event.currentTarget))
    }
  }

  const employees = directoryOptions.data?.employees.filter((employee) =>
    employee.available || employee.linkedProfileId === target?.profileId,
  ) ?? []
  const currentLink = target?.employee?.id ?? ''
  return (
    <Dialog open title={title} description={action.kind === 'connect'
      ? 'Use the exact email of an existing Supabase Auth user or invitation.'
      : target?.displayName}
      hasUnsavedChanges={dirty && !save.isPending}
      onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}>
      <form className="space-y-4" onSubmit={submit} onChange={() => setDirty(true)}>
        {editingAccess && directoryOptions.isPending && <p role="status" className="text-sm text-soft">Loading roles and employees…</p>}
        {editingAccess && directoryOptions.isError && (
          <div role="alert" className="space-y-2 text-sm text-soft">
            <p>Roles and employee links could not be loaded.</p>
            <Button type="button" variant="outline" onClick={() => void directoryOptions.refetch()}>Try again</Button>
          </div>
        )}
        <fieldset className="space-y-4" disabled={save.isPending || (editingAccess && !directoryOptions.data)}>
          {action.kind === 'connect' && <label className={field}>Email<Input required name="email" type="email" autoComplete="off" /></label>}
          {editingAccess && (
            <>
              <label className={field}>Display name<Input required name="displayName" maxLength={160} defaultValue={target?.displayName} /></label>
              <label className={field}>Employee link
                <select name="employeeId" className={select} defaultValue={currentLink}>
                  <option value="">Unlinked account</option>
                  {currentLink && !employees.some(({ id }) => id === currentLink) && (
                    <option value={currentLink}>{target?.employee?.legalName} (current link)</option>
                  )}
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.legalName}</option>
                  ))}
                </select>
              </label>
              <fieldset className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">Roles</legend>
                {directoryOptions.data?.roles.map(({ key, description }) => (
                  <label key={key} className="flex items-start gap-2 text-sm" title={description}>
                    <input className="mt-1" type="checkbox" name="roles" value={key} defaultChecked={target?.roleKeys.includes(key)} />
                    {roleLabels[key]}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <label className={field}>Reason for change<Textarea required name="reason" minLength={3} maxLength={500} /></label>
        </fieldset>
        {save.error && (
          <p role="alert" className="text-sm text-rose">
            {save.error instanceof ZodError ? save.error.issues[0]?.message : save.error.message}
          </p>
        )}
        <Button type="submit" loading={save.isPending} disabled={editingAccess && !directoryOptions.data}>
          {action.kind === 'edit' ? 'Save access' : title}
        </Button>
      </form>
    </Dialog>
  )
}

export default function UserAccessPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  return <UserAccessWorkspace key={String(scope.identityKey) + ':' + scope.authEpoch} scope={scope}
    canManage={auth.access?.permissionKeys.includes('users.manage') ?? false} refreshSecurity={() => auth.refreshSecurity()} />
}

function UserAccessWorkspace({ scope, canManage, refreshSecurity }: {
  scope: IdentityScopeRef
  canManage: boolean
  refreshSecurity: () => void
}) {
  const client = useQueryClient()
  const api = createUserAdministrationApi(scope)
  const key = ['system-access', scope.identityKey, scope.authEpoch] as const
  const directory = useQuery({ queryKey: [...key, 'accounts'], enabled: scope.isAuthReady, queryFn: () => api.listUsers() })
  const audit = useQuery({ queryKey: [...key, 'audit'], enabled: scope.isAuthReady, queryFn: () => api.listAudit(20) })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [action, setAction] = useState<Action>()
  const [notice, setNotice] = useState('')
  const term = search.trim().toLowerCase()
  const accounts = directory.data?.filter((account) =>
    (!status || account.status === status) && (!term ||
      [account.displayName, account.email, account.employee?.employeeNumber, ...account.roleKeys.map((role) => roleLabels[role])]
        .some((value) => value?.toLowerCase().includes(term))),
  ) ?? []
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(accounts.length / pageSize) - 1))

  function saved(ownAccess: boolean) {
    setAction(undefined)
    setNotice('User access saved.')
    void client.invalidateQueries({ queryKey: key })
    if (ownAccess) refreshSecurity()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="System" title="User Access & Roles" actions={canManage && (
        <Button leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => { setNotice(''); setAction({ kind: 'connect' }) }}>
          Connect Auth account
        </Button>
      )} />
      {notice && <p role="status" className="text-sm text-soft">{notice}</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <label className={field}>Find users
          <Input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Name, email, employee number or role" />
        </label>
        <label className={field}>Status
          <select value={status} className={select} onChange={(event) => { setStatus(event.target.value); setPage(0) }}>
            <option value="">All users</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </label>
      </div>
      {directory.isPending && <p role="status" className="text-sm text-soft">Loading accounts…</p>}
      {directory.isError && (
        <div role="alert" className={card}>
          <p>Could not load user accounts.</p>
          <Button variant="outline" onClick={() => void directory.refetch()}>Try again</Button>
        </div>
      )}
      {directory.data && <section aria-label="User accounts" className="space-y-3">
        {accounts.length === 0 && <p className={card}>No matching accounts.</p>}
        {accounts.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map((account) => (
          <article key={account.profileId} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-display font-semibold text-ink">{account.displayName}</h2>
                {account.email && <p className="break-all text-sm text-soft">{account.email}</p>}
              </div>
              <StatusPill tone={account.status === 'active' ? 'success' : 'neutral'}>{account.status === 'active' ? 'Active' : 'Deactivated'}</StatusPill>
            </div>
            <p className="text-sm text-ink">{account.roleKeys.map((role) => roleLabels[role]).join(' · ') || 'No assigned roles'}</p>
            <p className="text-sm text-soft">{account.employee
              ? account.employee.employeeNumber + ' · ' + account.employee.legalName
              : 'Unlinked account'}</p>
            {canManage && account.canManage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { setNotice(''); setAction({ kind: 'edit', account }) }}>Edit access</Button>
                <Button size="sm" variant="outline" onClick={() => { setNotice(''); setAction({ kind: 'status', account }) }}>
                  {account.status === 'active' ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            )}
          </article>
        ))}
        {accounts.length > pageSize && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button variant="outline" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</Button>
            <span>{visiblePage * pageSize + 1}–{Math.min(accounts.length, (visiblePage + 1) * pageSize)} of {accounts.length}</span>
            <Button variant="outline" disabled={(visiblePage + 1) * pageSize >= accounts.length} onClick={() => setPage(visiblePage + 1)}>Next</Button>
          </div>
        )}
      </section>}
      <section aria-labelledby="access-history" className={card}>
        <h2 id="access-history" className="flex items-center gap-2 font-display font-semibold"><KeyRound className="h-4 w-4" /> Recent access changes</h2>
        {audit.isPending && <p role="status" className="text-sm text-soft">Loading access history…</p>}
        {audit.isError && <p role="alert" className="text-sm text-soft">Could not load access history.</p>}
        {audit.data?.length === 0 && <p className="text-sm text-soft">No access changes recorded.</p>}
        {audit.data && <ul className="divide-y divide-line">{audit.data.map((entry) => (
          <li key={entry.id} className="space-y-1 py-3 text-sm">
            <p className="font-medium text-ink">{entry.targetDisplayName ?? 'User account'} · {entry.eventType.split('.')[1]?.replaceAll('_', ' ')}</p>
            <p className="text-soft">{entry.actorDisplayName ?? 'System'} · {new Date(entry.occurredAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}</p>
            {entry.reason && <p className="whitespace-pre-wrap break-words text-soft">{entry.reason}</p>}
          </li>
        ))}</ul>}
      </section>
      {canManage && scope.isAuthReady && action && <UserAccessEditor action={action} scope={scope} onClose={() => setAction(undefined)} onSaved={saved} />}
    </div>
  )
}
