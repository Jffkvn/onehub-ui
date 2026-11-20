import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { FieldError, Input, Textarea } from '@/components/ui/Input'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatLocalDateLabel, getTodayIsoInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { ForbiddenPage } from '@/modules/auth/ForbiddenPage'

import {
  executeStockCommand, readActiveWarehouses, readCategoryOptions, readMaterialOptions, readRecentReceipts,
  UnconfirmedStockWrite, type StockCommand, type StockReceipt,
} from './stockApi'

const modes = [
  { key: 'existing', label: 'Existing material' },
  { key: 'new', label: 'New material' },
  { key: 'equipment', label: 'New equipment' },
] as const

type ReceiptMode = typeof modes[number]['key']

const selectClass = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald disabled:opacity-50'
const fieldClass = 'block min-w-0 space-y-1 text-sm font-medium text-ink'
const amountFormat = new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX' })

const receiptColumns: ColumnDef<StockReceipt>[] = [
  { key: 'reference', header: 'GRN reference', accessor: (row) => row.reference_number },
  { key: 'received', header: 'Received', accessor: (row) => formatLocalDateLabel(row.received_date) },
  { key: 'supplier', header: 'Supplier', accessor: (row) => row.supplier_name ?? '—' },
  { key: 'invoice', header: 'Invoice', accessor: (row) => row.invoice_number ?? '—' },
  { key: 'warehouse', header: 'Warehouse', accessor: (row) => row.warehouses?.name ?? '—' },
  {
    key: 'value', header: 'Purchase value', align: 'right',
    accessor: (row) => row.purchase_value || row.supplier_name || row.invoice_number ? amountFormat.format(row.purchase_value) : '—',
  },
]

function ReceiptField({ label, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className={fieldClass}><span>{label}</span><Input required {...input} /></label>
}

function receiptCommand(mode: ReceiptMode, fields: FormData): StockCommand {
  const text = (key: string) => {
    const value = fields.get(key)
    return typeof value === 'string' ? value.trim() : ''
  }
  const warehouseId = text('warehouse')
  const categoryId = text('category')
  const shared = {
    p_warehouse_id: warehouseId === 'new' ? null : warehouseId,
    p_warehouse_code: text('warehouseCode').toUpperCase() || null,
    p_warehouse_name: text('warehouseName') || null,
    p_warehouse_location: text('warehouseLocation') || null,
    p_category_id: categoryId === 'new' ? null : categoryId || null,
    p_category_name: text('categoryName') || null,
    p_category_description: text('categoryDescription') || null,
    p_supplier_name: text('supplier'),
    p_grn_number: text('grn'),
    p_invoice_number: text('invoice'),
    p_received_date: text('receivedDate'),
  }
  if (mode === 'equipment') return {
    name: 'rpc_receive_new_equipment_inline',
    args: {
      ...shared,
      p_model_name: text('model'),
      p_serial_number: text('serial'),
      p_is_sensitive: fields.has('sensitive'),
      p_condition_notes: text('condition'),
      p_purchase_value: Number(text('value')),
    },
  }
  return {
    name: 'rpc_receive_consumable_inline',
    args: {
      ...shared,
      p_item_id: text('item') || null,
      p_name: text('materialName') || null,
      p_sku: text('sku').toUpperCase() || null,
      p_unit_of_measure: text('unit') || null,
      p_reorder_level: Number(text('reorder')),
      p_quantity: Number(text('quantity')),
      p_unit_price: Number(text('value')),
    },
  }
}

function ReceivingContent({ scope, canRead }: { scope: IdentityScopeRef; canRead: boolean }) {
  const [mode, setMode] = useState<ReceiptMode>('existing')
  const [warehouse, setWarehouse] = useState('')
  const [category, setCategory] = useState('')
  const [recorded, setRecorded] = useState('')
  const submitLock = useRef(false)
  const queryClient = useQueryClient()
  const key = ['warehouse', scope.identityKey, scope.authEpoch, 'stock'] as const
  const today = getTodayIsoInZone('Africa/Kampala')
  const warehouses = useQuery({ queryKey: [...key, 'warehouses'], queryFn: ({ signal }) => readActiveWarehouses(scope, signal), retry: false })
  const materials = useQuery({
    queryKey: [...key, 'materials'], queryFn: ({ signal }) => readMaterialOptions(scope, signal),
    enabled: mode === 'existing', retry: false,
  })
  const categories = useQuery({
    queryKey: [...key, 'categories'], queryFn: ({ signal }) => readCategoryOptions(scope, signal),
    enabled: mode !== 'existing', retry: false,
  })
  const receipts = useQuery({
    queryKey: [...key, 'receipts'], queryFn: ({ signal }) => readRecentReceipts(scope, signal), enabled: canRead, retry: false,
  })
  const write = useMutation({
    mutationFn: (command: StockCommand) => executeStockCommand(scope, command),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['warehouse'] }),
    retry: false,
  })
  const unconfirmed = write.error instanceof UnconfirmedStockWrite
  const choice = mode === 'existing' ? materials : categories
  const ready = warehouses.isSuccess && choice.isSuccess

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || unconfirmed || submitLock.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    submitLock.current = true
    setRecorded('')
    try {
      const command = receiptCommand(mode, fields)
      await write.mutateAsync(command)
      const reference = command.args.p_grn_number
      if (typeof reference === 'string') setRecorded(reference)
      form.reset()
      setCategory('')
    } catch {
      // The mutation state shows the error and keeps the form intact.
    } finally {
      submitLock.current = false
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Inventory" title="Stock receiving" subtitle="Record a material delivery or register an individual asset." />
      {recorded && <p role="status" className="rounded-lg bg-emerald-tint p-3 text-sm text-ink">Receipt recorded for {recorded}.</p>}
      <section className="space-y-5 rounded-xl border border-line bg-surface p-4 sm:p-6" aria-label="New stock receipt">
        <div role="group" aria-label="Receipt type" className="flex flex-wrap gap-2">
          {modes.map(({ key: itemMode, label }) => (
            <Button key={itemMode} type="button" size="sm" variant={mode === itemMode ? 'primary' : 'outline'}
              aria-pressed={mode === itemMode} disabled={write.isPending || unconfirmed}
              onClick={() => { setMode(itemMode); setCategory(''); write.reset(); setRecorded('') }}>
              {label}
            </Button>
          ))}
        </div>
        {(warehouses.isPending || choice.isPending) && <p role="status" className="text-sm text-muted">Loading warehouse options…</p>}
        {(warehouses.isError || choice.isError) && (
          <div className="flex items-center justify-between gap-3">
            <FieldError>Could not load warehouse options.</FieldError>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (warehouses.isError) void warehouses.refetch()
              if (choice.isError) void choice.refetch()
            }}>Retry</Button>
          </div>
        )}
        <form key={mode} onSubmit={(event) => void record(event)}>
          <fieldset disabled={!ready || write.isPending || unconfirmed} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {mode === 'existing' ? (
                <label className={fieldClass}>
                  <span>Existing material</span>
                  <select name="item" required className={selectClass}>
                    <option value="">{materials.data?.length === 0 ? 'No materials available' : 'Select material'}</option>
                    {materials.data?.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  <label className={fieldClass}>
                    <span>Category</span>
                    <select name="category" required value={category} onChange={(event) => setCategory(event.target.value)} className={selectClass}>
                      <option value="">Select category</option>
                      {categories.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      <option value="new">Create a category</option>
                    </select>
                  </label>
                  {category === 'new' && <>
                    <ReceiptField label="New category name" name="categoryName" minLength={2} maxLength={100} />
                    <ReceiptField label="Category description" name="categoryDescription" required={false} maxLength={500} />
                  </>}
                </>
              )}
              {mode === 'new' && <>
                <ReceiptField label="Material name" name="materialName" minLength={2} maxLength={160} />
                <ReceiptField label="SKU" name="sku" pattern="[A-Za-z0-9\-]+" maxLength={80} />
                <ReceiptField label="Unit of measure" name="unit" placeholder="e.g. metre" maxLength={60} />
                <ReceiptField label="Reorder minimum" name="reorder" type="number" min={0} max={2147483647} step={1} defaultValue={0} />
              </>}
              {mode === 'equipment' && <>
                <ReceiptField label="Model name" name="model" minLength={2} maxLength={160} />
                <ReceiptField label="Serial number" name="serial" minLength={2} maxLength={120} />
                <label className={fieldClass}><span>Condition on receipt</span><Textarea required minLength={2} maxLength={500} name="condition" /></label>
                <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink">
                  <input type="checkbox" name="sensitive" className="accent-emerald" /> Sensitive equipment
                </label>
              </>}
            </div>
            <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
              <label className={fieldClass}>
                <span>Warehouse</span>
                <select name="warehouse" required value={warehouse} onChange={(event) => setWarehouse(event.target.value)} className={selectClass}>
                  <option value="">Select warehouse</option>
                  {warehouses.data?.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
                  <option value="new">Create a warehouse</option>
                </select>
              </label>
              {warehouse === 'new' && <>
                <ReceiptField label="New warehouse code" name="warehouseCode" pattern="[A-Za-z0-9\-]{2,30}" />
                <ReceiptField label="New warehouse name" name="warehouseName" minLength={2} maxLength={160} />
                <ReceiptField label="New warehouse location" name="warehouseLocation" minLength={2} maxLength={160} />
              </>}
              <ReceiptField label="Supplier" name="supplier" minLength={2} maxLength={160} />
              <ReceiptField label="GRN reference" name="grn" minLength={2} maxLength={120} />
              <ReceiptField label="Invoice number" name="invoice" minLength={2} maxLength={120} />
              <ReceiptField label="Received date" name="receivedDate" type="date" max={today} defaultValue={today} />
              {mode !== 'equipment' && <ReceiptField label="Quantity" name="quantity" type="number" min={1} max={2147483647} step={1} defaultValue={1} />}
              <ReceiptField label={mode === 'equipment' ? 'Purchase value (UGX)' : 'Unit price (UGX)'}
                name="value" type="number" min={0} max={9999999999999.99} step="0.01" />
            </div>
          </fieldset>
          <div className="mt-5 space-y-3">
            {write.isError && !isAbortError(write.error) && <FieldError>{write.error.message}</FieldError>}
            {unconfirmed && <Link className="block text-sm font-semibold text-emerald underline" to="/inventory/ledger">Open stock ledger</Link>}
            <Button type="submit" loading={write.isPending} disabled={!ready || unconfirmed}>Record receipt</Button>
          </div>
        </form>
      </section>
      {canRead && <section aria-labelledby="receipts-heading" className="space-y-3">
        <h2 id="receipts-heading" className="font-display text-lg font-semibold text-ink">Recent receipts</h2>
        {receipts.isError ? (
          <div className="flex gap-3">
            <FieldError>{receipts.error.message}</FieldError>
            <Button type="button" size="sm" variant="outline" onClick={() => void receipts.refetch()}>Retry</Button>
          </div>
        ) : (
          <DataTable columns={receiptColumns} data={receipts.data ?? []} keyExtractor={(receipt) => receipt.id}
            loading={receipts.isPending} emptyTitle="No receipts yet" />
        )}
      </section>}
    </main>
  )
}

export function ReceivingPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  if (!scope.isAuthReady || !scope.identityKey) return null
  const permissions = auth.access?.permissionKeys ?? []
  if (!permissions.includes('inventory.receipt')) return <ForbiddenPage />

  return <ReceivingContent key={JSON.stringify([scope.identityKey, scope.authEpoch])}
    scope={scope} canRead={permissions.includes('inventory.read')} />
}
