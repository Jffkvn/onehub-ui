import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/modules/auth/AuthProvider'
import { systemSessionGuard } from './systemSession'
import { companyProfileKey, companySchema, useCompanyProfile } from './companyProfile'

const settingsKeys = ['attendance.policy', 'notifications.channels', 'service.checklists'] as const
const settingsSchema = z.array(z.object({ key: z.enum(settingsKeys), value: z.record(z.unknown()) }))
const section = 'space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5'

async function loadRolloutSettings(scope: IdentityScopeRef, signal: AbortSignal) {
  const check = systemSessionGuard(scope)
  const { data, error } = await getSupabaseClient().from('feature_settings')
    .select('key,value').in('key', settingsKeys).abortSignal(signal)
  check()
  if (error) throw new Error('Rollout settings could not be loaded.')
  return Object.fromEntries(settingsSchema.parse(data).map(({ key, value }) => [key, value]))
}

function stateLabel(value: unknown, enabled: string, disabled: string) {
  return typeof value === 'boolean' ? (value ? enabled : disabled) : 'Unavailable'
}

export default function CompanySettingsPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  return <CompanySettingsForm key={String(scope.identityKey) + ':' + scope.authEpoch} scope={scope}
    canReadFlags={auth.access?.permissionKeys.includes('features.read') ?? false} />
}

function CompanySettingsForm({ scope, canReadFlags }: { scope: IdentityScopeRef; canReadFlags: boolean }) {
  const queryClient = useQueryClient()
  const key = ['system-settings', scope.identityKey, scope.authEpoch] as const
  const companyKey = companyProfileKey(scope)
  const company = useCompanyProfile(scope)
  const rollout = useQuery({
    queryKey: [...key, 'rollout'], enabled: scope.isAuthReady && canReadFlags,
    queryFn: ({ signal }) => loadRolloutSettings(scope, signal),
  })
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const save = useMutation({
    mutationFn: async ({ name, version }: { name: string; version: string }) => {
      const check = systemSessionGuard(scope)
      const { data, error } = (await getSupabaseClient().rpc('rpc_update_company_profile', {
        p_name: name, p_expected_updated_at: version,
      })) as { data: unknown; error: { code: string } | null }
      check()
      if (error?.code === '40001') {
        setConflict(true)
        throw new Error('Company settings changed. Reload the saved profile before editing again.')
      }
      if (error?.code === '42501') throw new Error('Company settings management permission is required.')
      if (error) throw new Error('The save could not be confirmed. Check the current profile and try again.')
      return companySchema.parse(data)
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(companyKey, profile)
      void queryClient.invalidateQueries({ queryKey: ['system-audit'] })
      setNotice('Company profile saved.')
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!company.isSuccess || company.isFetching || conflict || save.isPending) return
    const value = new FormData(event.currentTarget).get('name')
    const name = typeof value === 'string' ? value.trim() : ''
    setNotice('')
    if (!name || name.length > 160) {
      setNotice('Enter a company name.')
      return
    }
    save.mutate({ name, version: company.data.updated_at })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="System" title="Company Settings" />
      {company.isPending && <p role="status" className="text-sm text-soft">Loading the company profile…</p>}
      {company.isError && <div role="alert" className={section}>
        <p>{company.error.message}</p>
        <Button variant="outline" onClick={() => void company.refetch()}>Try again</Button>
      </div>}
      {company.isSuccess && (
        <section className={section} aria-labelledby="company-profile-title">
          <h2 id="company-profile-title" className="font-display text-lg font-semibold text-ink">Company profile</h2>
          {company.data && <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-soft">Workspace identifier</dt><dd className="break-words font-medium">{company.data.slug}</dd></div>
            <div><dt className="text-soft">Time zone</dt><dd className="font-medium">{company.data.timezone}</dd></div>
            <div><dt className="text-soft">Currency</dt><dd className="font-medium">{company.data.currency_code}</dd></div>
          </dl>}
          <form onSubmit={submit} key={company.data.updated_at} className="space-y-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Company name
              <Input name="name" required maxLength={160} defaultValue={company.data.name} disabled={save.isPending || conflict} />
            </label>
            {notice && <p role="status" className="text-sm text-soft">{notice}</p>}
            {save.error && <p role="alert" className="text-sm text-rose">{save.error.message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={save.isPending} disabled={company.isFetching || conflict}>Save company profile</Button>
              {save.error && <Button type="button" variant="outline" onClick={() => {
                save.reset()
                setConflict(false)
                setNotice('')
                void company.refetch()
              }}>Reload profile</Button>}
            </div>
          </form>
        </section>
      )}
      {canReadFlags && <section className={section} aria-labelledby="rollout-title">
        <h2 id="rollout-title" className="font-display text-lg font-semibold text-ink">Rollout status</h2>
        {rollout.isPending && <p role="status" className="text-sm text-soft">Loading rollout status…</p>}
        {rollout.isError && <div role="alert" className="space-y-2 text-sm">
          <p>Rollout status could not be loaded.</p>
          <Button variant="outline" onClick={() => void rollout.refetch()}>Try again</Button>
        </div>}
        {rollout.data && <dl className="divide-y divide-line text-sm">
          {[
            ['Live attendance', stateLabel(rollout.data['attendance.policy']?.enabled, 'Enabled', 'Disabled')],
            ['Outbound notifications', stateLabel(rollout.data['notifications.channels']?.email, 'Email enabled', 'Email disabled')],
            ['Service checklists', stateLabel(rollout.data['service.checklists']?.provisional, 'Provisional', 'Final')],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-2 py-3">
              <dt className="text-soft">{label}</dt><dd className="font-medium text-ink">{value}</dd>
            </div>
          ))}
        </dl>}
      </section>}
    </div>
  )
}
