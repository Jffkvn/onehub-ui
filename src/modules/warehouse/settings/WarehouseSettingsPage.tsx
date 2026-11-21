import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { z } from 'zod'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { assertProtectedSessionCurrent, captureProtectedSessionSnapshot, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/modules/auth/AuthProvider'

const approvalModes = ['threshold_escalation', 'warehouse_manager_only', 'cfo_approval_all'] as const
const settingsSchema = z.object({
  approval_mode: z.enum(approvalModes),
  cfo_threshold: z.coerce.number().finite().nonnegative(),
  critical_stock_escalation: z.boolean(),
  updated_at: z.string().datetime({ offset: true }),
})
type Settings = z.infer<typeof settingsSchema>
type SettingsInput = Omit<Settings, 'updated_at'>
const columns = 'approval_mode,cfo_threshold,critical_stock_escalation,updated_at'

export default function WarehouseSettingsPage() {
  const scope = useProtectedIdentityScope(useAuth())
  return <WarehouseSettingsForm key={[scope.identityKey, scope.authEpoch].join(':')} scope={scope} />
}

function WarehouseSettingsForm({ scope }: { scope: IdentityScopeRef }) {
  const queryClient = useQueryClient()
  const key = ['warehouse', 'approval-settings', scope.identityKey, scope.authEpoch] as const
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)

  function currentSession() {
    const snapshot = captureProtectedSessionSnapshot({
      identityKey: scope.identityKey, authEpoch: scope.authEpoch, isReady: scope.isAuthReady,
    })
    const check = () => assertProtectedSessionCurrent(snapshot, scope.latestRef.current)
    check()
    return check
  }

  const settings = useQuery({
    queryKey: key,
    enabled: scope.isAuthReady,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const check = currentSession()
      const { data, error } = await getSupabaseClient().from('inventory_settings')
        .select(columns).eq('singleton', true).abortSignal(signal).single()
      check()
      if (error) throw new Error('Warehouse approval settings could not be loaded.')
      return settingsSchema.parse(data)
    },
  })

  const save = useMutation({
    mutationFn: async ({ values, updatedAt }: { values: SettingsInput; updatedAt: string }) => {
      const check = currentSession()
      const { data, error } = (await getSupabaseClient().rpc('rpc_update_inventory_settings', {
        p_approval_mode: values.approval_mode,
        p_cfo_threshold: values.cfo_threshold,
        p_critical_stock_escalation: values.critical_stock_escalation,
        p_expected_updated_at: updatedAt,
      })) as { data: unknown; error: { code: string } | null }
      check()
      if (error?.code === '40001') {
        setConflict(true)
        throw new Error('Someone else changed these settings. Reload the saved rules before editing again.')
      }
      if (error?.code === '42501') throw new Error('You do not have permission to change warehouse approval settings.')
      if (error) throw new Error('OneHub could not confirm the change. Reload the saved rules before trying again.')
      return settingsSchema.parse(data)
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(key, saved)
      setNotice('Warehouse approval settings saved.')
    },
  })

  function reload() {
    setConflict(false)
    setNotice('')
    save.reset()
    void settings.refetch()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings.data || save.isPending || conflict) return
    const fields = new FormData(event.currentTarget)
    const thresholdInput = fields.get('threshold')
    const threshold = typeof thresholdInput === 'string' ? thresholdInput.trim() : ''
    const result = settingsSchema.omit({ updated_at: true }).safeParse({
      approval_mode: fields.get('mode'),
      cfo_threshold: threshold === '' ? undefined : threshold,
      critical_stock_escalation: fields.has('criticalStock'),
    })
    setNotice('')
    if (!result.success) {
      setNotice('Enter a valid approval mode and a non-negative threshold.')
      return
    }
    save.mutate({ values: result.data, updatedAt: settings.data.updated_at })
  }

  return <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
    <PageHeader eyebrow="Inventory" title="Warehouse approval settings"
      subtitle="Choose how new warehouse requests are routed for approval." />
    {settings.isPending && <p role="status" className="text-sm text-muted">Loading approval rules…</p>}
    {settings.isError && <div role="alert" className="space-y-2 text-sm text-soft">
      <p>{settings.error.message}</p><Button variant="outline" onClick={reload}>Retry</Button>
    </div>}
    {settings.data && <form key={settings.data.updated_at} onSubmit={submit}
      className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <fieldset disabled={save.isPending || settings.isFetching || conflict} className="space-y-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          <span>Approval mode</span>
          <select name="mode" defaultValue={settings.data.approval_mode}
            className="h-10 rounded-lg border border-line bg-surface px-3">
            <option value="threshold_escalation">Escalate sensitive, high-value or critical-stock requests</option>
            <option value="warehouse_manager_only">Warehouse approval</option>
            <option value="cfo_approval_all">Finance approval for all requests</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          <span>CFO escalation threshold (UGX)</span>
          <Input name="threshold" type="number" min={0} step="any" required defaultValue={settings.data.cfo_threshold} />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="criticalStock" defaultChecked={settings.data.critical_stock_escalation} />
          Escalate requests that would take consumables below their reorder level
        </label>
        <p className="text-sm text-muted">The threshold and reorder options apply in escalation mode.</p>
      </fieldset>
      {notice && <p role="status" className="text-sm text-soft">{notice}</p>}
      {save.error && <p role="alert" className="text-sm text-soft">{save.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending} disabled={settings.isFetching || conflict}>Save approval settings</Button>
        {save.error && <Button type="button" variant="outline" disabled={settings.isFetching} onClick={reload}>Reload saved settings</Button>}
      </div>
    </form>}
  </main>
}
