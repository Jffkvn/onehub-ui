import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { FieldError, Input, Textarea } from '@/components/ui/Input'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'

import { executeStockCommand, readActiveWarehouses, readMaterialOptions, UnconfirmedStockWrite, type StockCommand } from './stockApi'

const selectClass = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald'
const fieldClass = 'block min-w-0 space-y-1 text-sm font-medium text-ink'

function AdjustmentContent({ scope }: { scope: IdentityScopeRef }) {
  const key = ['warehouse', scope.identityKey, scope.authEpoch, 'stock'] as const
  const warehouses = useQuery({ queryKey: [...key, 'warehouses'], queryFn: ({ signal }) => readActiveWarehouses(scope, signal), retry: false })
  const materials = useQuery({ queryKey: [...key, 'materials'], queryFn: ({ signal }) => readMaterialOptions(scope, signal), retry: false })
  const queryClient = useQueryClient()
  const lock = useRef(false)
  const write = useMutation({
    mutationFn: (command: StockCommand) => executeStockCommand(scope, command),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['warehouse'] }),
    retry: false,
  })
  const unconfirmed = write.error instanceof UnconfirmedStockWrite
  const warehouseOptions = warehouses.data ?? []
  const materialOptions = materials.data ?? []
  const ready = warehouseOptions.length > 0 && materialOptions.length > 0

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || unconfirmed || lock.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const amount = Number(fields.get('quantity'))
    const warehouseId = fields.get('warehouse')
    const materialId = fields.get('material')
    const reasonField = fields.get('reason')
    const reason = typeof reasonField === 'string' ? reasonField.trim() : ''
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 2147483647 || !reason
      || !warehouseOptions.some(({ id }) => id === warehouseId) || !materialOptions.some(({ id }) => id === materialId)) return

    lock.current = true
    try {
      await write.mutateAsync({
        name: 'rpc_adjust_stock',
        args: {
          p_warehouse_id: warehouseId, p_consumable_item_id: materialId, p_equipment_asset_id: null,
          p_quantity: amount, p_reason: reason,
        },
      })
      form.reset()
    } catch {
      // Keep the reason and previous values available while the error is displayed.
    } finally {
      lock.current = false
    }
  }

  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
    <PageHeader eyebrow="Inventory" title="Stock adjustment"
      subtitle="Correct a material quantity in the ledger and record the reason."
      actions={<Link to="/inventory/ledger" className="text-sm font-semibold text-emerald underline">Stock ledger</Link>} />
    {(warehouses.isPending || materials.isPending) && <p role="status" className="text-sm text-muted">Loading warehouse and material options…</p>}
    {(warehouses.isError || materials.isError) && <div className="flex items-center gap-3">
      <FieldError>Could not load warehouse and material options.</FieldError>
      <Button type="button" variant="outline" size="sm" onClick={() => {
        if (warehouses.isError) void warehouses.refetch()
        if (materials.isError) void materials.refetch()
      }}>Retry</Button>
    </div>}
    {warehouses.isSuccess && materials.isSuccess && !ready && <p className="text-sm text-muted">Add an active warehouse and material before making an adjustment.</p>}
    <form onSubmit={(event) => void save(event)} className="space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!ready || write.isPending || unconfirmed}>
        <label className={fieldClass}>
          <span>Warehouse</span>
          <select required name="warehouse" className={selectClass}>
            <option value="">Select warehouse</option>
            {warehouseOptions.map(({ id, code, name }) => <option key={id} value={id}>{code} · {name}</option>)}
          </select>
        </label>
        <label className={fieldClass}>
          <span>Material</span>
          <select required name="material" className={selectClass}>
            <option value="">Select material</option>
            {materialOptions.map(({ id, sku, name }) => <option key={id} value={id}>{sku} · {name}</option>)}
          </select>
        </label>
        <label className={fieldClass}>
          <span>Quantity change</span>
          <Input required name="quantity" type="number" step={1} min={-2147483647} max={2147483647} placeholder="e.g. −2 or 5"
            onChange={(event) => event.currentTarget.setCustomValidity(Number(event.currentTarget.value) === 0 && event.currentTarget.value ? 'Enter a non-zero quantity.' : '')} />
        </label>
        <label className={fieldClass}>
          <span>Reason</span>
          <Textarea required name="reason" maxLength={500} placeholder="Explain why the stock count changed"
            onChange={(event) => event.currentTarget.setCustomValidity(event.currentTarget.value.trim() ? '' : 'Enter the reason for the adjustment.')} />
        </label>
      </fieldset>
      {write.isSuccess && <p role="status" className="rounded-md bg-emerald-tint p-3 text-sm text-ink">Stock adjustment recorded.</p>}
      {write.isError && !isAbortError(write.error) && <FieldError>{write.error.message}</FieldError>}
      <Button type="submit" loading={write.isPending} disabled={!ready || unconfirmed}>Save adjustment</Button>
    </form>
  </main>
}

export function StockAdjustmentPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  if (!scope.isAuthReady || !scope.identityKey) return null
  if (!auth.access?.permissionKeys.includes('inventory.adjust')) return <ForbiddenPage />
  return <AdjustmentContent key={JSON.stringify([scope.identityKey, scope.authEpoch])} scope={scope} />
}
