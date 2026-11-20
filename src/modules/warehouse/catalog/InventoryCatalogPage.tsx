import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ArrowRight, Boxes, ClipboardCheck, History, Package, QrCode, Search, Warehouse } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { KpiCard } from '@/components/patterns/KpiCard'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { StatusPill, type StatusPillProps } from '@/components/ui/StatusPill'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatDateTimeInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import { equipmentLabelPayload, printEquipmentLabel } from '@/modules/warehouse/labels/equipmentLabel'
import {
  catalogPageSize,
  readConsumables,
  readEquipment,
  readInventoryOverview,
  readStockMovements,
  type CatalogPage,
  type Consumable,
  type Equipment,
  type StockMovement,
} from './catalogApi'

type CatalogView = 'overview' | 'consumables' | 'equipment' | 'ledger'

type ListFilters = { page: number; search: string }

const titles: Record<CatalogView, { title: string; subtitle: string }> = {
  overview: { title: 'Inventory overview', subtitle: 'Stock availability and the latest warehouse activity.' },
  consumables: { title: 'Consumables', subtitle: 'Materials and current stock balances across warehouses.' },
  equipment: { title: 'Equipment assets', subtitle: 'Serialised equipment, warehouse location and availability.' },
  ledger: { title: 'Stock ledger', subtitle: 'Receipts, issues, returns and adjustments. Times are shown in EAT.' },
}

const equipmentStatus: Record<Equipment['status'], { label: string; tone: StatusPillProps['tone'] }> = {
  available: { label: 'Available', tone: 'success' },
  assigned: { label: 'Assigned', tone: 'info' },
  maintenance: { label: 'Maintenance', tone: 'warning' },
  damaged: { label: 'Damaged', tone: 'danger' },
  lost: { label: 'Lost', tone: 'danger' },
}

const movementLabels: Record<StockMovement['movement_type'], string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  return: 'Return',
  adjustment_add: 'Adjustment in',
  adjustment_remove: 'Adjustment out',
}

function namedEntry(label: string, code?: string) {
  return (
    <div className="space-y-0.5">
      <span className="block font-semibold text-ink">{label}</span>
      {code && <span className="block font-mono text-xs text-muted">{code}</span>}
    </div>
  )
}

const movementColumns: ColumnDef<StockMovement>[] = [
  { key: 'time', header: 'Recorded at', accessor: (row) => formatDateTimeInZone(row.created_at, 'Africa/Kampala') },
  {
    key: 'movement', header: 'Movement', accessor: (row) => (
      <StatusPill tone={row.quantity > 0 ? 'success' : 'warning'}>{movementLabels[row.movement_type]}</StatusPill>
    ),
  },
  {
    key: 'item', header: 'Item', accessor: (row) => namedEntry(
      row.consumable_items?.name ?? row.equipment_assets?.model_name ?? 'Item unavailable',
      row.consumable_items?.sku ?? row.equipment_assets?.serial_number,
    ),
  },
  { key: 'warehouse', header: 'Warehouse', accessor: (row) => row.warehouses?.name ?? '—' },
  {
    key: 'quantity', header: 'Change', align: 'right', accessor: (row) => (
      <span className="font-semibold tabular-nums">{row.quantity > 0 ? '+' : ''}{row.quantity.toLocaleString()}</span>
    ),
  },
  { key: 'recordedBy', header: 'Recorded by', accessor: (row) => row.profiles_performed_by?.display_name ?? '—' },
  { key: 'reference', header: 'Reference', accessor: (row) => <span className="break-all font-mono text-xs">{row.reference_id}</span> },
]

const consumableColumns: ColumnDef<Consumable>[] = [
  { key: 'item', header: 'Material', accessor: (row) => namedEntry(row.name, row.sku) },
  { key: 'category', header: 'Category', accessor: (row) => row.item_categories?.name ?? '—' },
  { key: 'balance', header: 'In stock', align: 'right', accessor: (row) => row.balance.toLocaleString() },
  { key: 'reorder', header: 'Reorder minimum', align: 'right', accessor: (row) => row.reorder_level.toLocaleString() },
  { key: 'unit', header: 'Unit', accessor: (row) => row.unit_of_measure },
  {
    key: 'status', header: 'Status', accessor: (row) => (
      row.balance <= 0 ? <StatusPill tone="warning">Out of stock</StatusPill>
        : row.balance < row.reorder_level ? <StatusPill tone="warning">Low stock</StatusPill>
        : <StatusPill tone="success">Available</StatusPill>
    ),
  },
]

function useCatalogQuery<T>(scope: IdentityScopeRef, key: readonly unknown[], read: (signal: AbortSignal) => Promise<T>) {
  return useQuery({
    queryKey: ['warehouse', scope.identityKey, scope.authEpoch, 'catalog', ...key],
    queryFn: ({ signal }) => read(signal),
    enabled: scope.isAuthReady && Boolean(scope.identityKey),
    retry: false,
  })
}

function CatalogError({ title, retry }: { title: string; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <span className="flex-1 font-semibold text-ink">{title} could not be loaded.</span>
      <Button type="button" size="sm" variant="secondary" onClick={retry}>Retry</Button>
    </div>
  )
}

function CatalogTable<T extends { id: string }>({
  query, columns, title, emptyTitle, emptyDescription, page, onPage,
}: {
  query: UseQueryResult<CatalogPage<T>>
  columns: ColumnDef<T>[]
  title: string
  emptyTitle: string
  emptyDescription?: string
  page?: number
  onPage?: (page: number) => void
}) {
  if (query.isError) return <CatalogError title={title} retry={() => void query.refetch()} />

  const rows = query.data?.rows ?? []
  const count = query.data?.count ?? 0
  const first = (page ?? 0) * catalogPageSize

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(row) => row.id}
        loading={query.isPending}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
      {page !== undefined && onPage && !query.isPending && (count > catalogPageSize || page > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-soft" aria-live="polite">
            {rows.length ? (first + 1).toLocaleString() + '–' + (first + rows.length).toLocaleString() : '0'} of {count.toLocaleString()}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</Button>
            <Button type="button" size="sm" variant="secondary" disabled={first + catalogPageSize >= count} onClick={() => onPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </>
  )
}

function InventoryOverviewView({ scope }: { scope: IdentityScopeRef }) {
  const overview = useCatalogQuery(scope, ['overview'], (signal) => readInventoryOverview(scope, signal))
  const movements = useCatalogQuery(scope, ['recent'], (signal) => readStockMovements(0, 5, scope, signal))
  const counts = overview.data
  const links = [
    { title: 'Consumables', path: '/inventory/consumables', icon: Package },
    { title: 'Equipment assets', path: '/inventory/equipment', icon: Boxes },
    { title: 'Stock ledger', path: '/inventory/ledger', icon: History },
  ]

  return (
    <>
      {overview.isError ? <CatalogError title="Inventory totals" retry={() => void overview.refetch()} /> : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard title="Active warehouses" value={counts?.activeWarehouses.toLocaleString() ?? '—'} loading={overview.isPending} icon={<Warehouse size={18} />} tone="blue" />
          <KpiCard title="Consumable types" value={counts?.consumableTypes.toLocaleString() ?? '—'} loading={overview.isPending} icon={<Package size={18} />} tone="violet" />
          <KpiCard
            title="Equipment available"
            value={counts ? counts.availableEquipment.toLocaleString() + ' of ' + counts.totalEquipment.toLocaleString() : '—'}
            loading={overview.isPending}
            icon={<Boxes size={18} />}
          />
          <KpiCard
            title="Requests pending approval"
            value={counts?.requestsPendingApproval.toLocaleString() ?? '—'}
            loading={overview.isPending}
            icon={<ClipboardCheck size={18} />}
            tone="amber"
          />
        </div>
      )}
      <nav aria-label="Inventory shortcuts" className="grid gap-3 sm:grid-cols-3">
        {links.map(({ title, path, icon: Icon }) => (
          <Link key={path} to={path} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink shadow-xs hover:border-emerald focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald">
            <Icon className="shrink-0 text-emerald" size={17} aria-hidden="true" />
            <span className="flex-1">{title}</span>
            <ArrowRight className="shrink-0 text-muted" size={15} aria-hidden="true" />
          </Link>
        ))}
      </nav>
      <section className="space-y-3" aria-labelledby="inventory-recent-heading">
        <h2 id="inventory-recent-heading" className="font-display text-base font-semibold text-ink">Recent stock movements</h2>
        <CatalogTable query={movements} columns={movementColumns} title="Recent stock movements" emptyTitle="No stock movements yet" />
      </section>
    </>
  )
}

function CatalogSearch({ label, placeholder, onApply }: {
  label: string
  placeholder: string
  onApply: (search: string) => void
}) {
  const [draft, setDraft] = useState('')

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onApply(draft.trim())
      }}
    >
      <div className="w-full max-w-xs">
        <Input
          aria-label={label}
          type="search"
          placeholder={placeholder}
          value={draft}
          maxLength={100}
          leftIcon={<Search size={16} aria-hidden="true" />}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary">Search</Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setDraft('')
          onApply('')
        }}
      >
        Clear
      </Button>
    </form>
  )
}

function ConsumablesView({ scope }: { scope: IdentityScopeRef }) {
  const [{ page, search }, setFilters] = useState<ListFilters>({ page: 0, search: '' })
  const query = useCatalogQuery(scope, ['consumables', page, search], (signal) => readConsumables(page, search, scope, signal))
  return (
    <>
      <CatalogSearch label="Search by SKU" placeholder="Search by SKU" onApply={(value) => setFilters({ page: 0, search: value })} />
      <CatalogTable
        query={query}
        columns={consumableColumns}
        title={titles.consumables.title}
        emptyTitle={search ? 'No matching materials' : 'No consumables yet'}
        emptyDescription={search ? 'Check the SKU or clear the search.' : 'Consumable materials will appear here when added to inventory.'}
        page={page}
        onPage={(next) => setFilters({ search, page: next })}
      />
    </>
  )
}

function EquipmentLabel({ equipment, scope, onClose }: { equipment: Equipment; scope: IdentityScopeRef; onClose: () => void }) {
  const payload = equipmentLabelPayload(equipment.id)
  const [printError, setPrintError] = useState('')
  const [printing, setPrinting] = useState(false)
  const qr = useCatalogQuery(scope, ['equipment-label', equipment.id], async () => (
    (await import('qrcode')).default.toDataURL(payload, { width: 256, margin: 2 })
  ))

  async function print() {
    if (!qr.data || printing) return
    setPrinting(true)
    setPrintError('')
    try {
      await printEquipmentLabel(equipment, qr.data)
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'The label could not be printed.')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Dialog
      open
      title="Equipment QR label"
      description={equipment.model_name + ' · ' + equipment.serial_number}
      onOpenChange={(open) => { if (!open) onClose() }}
      footer={<Button type="button" disabled={!qr.data} loading={printing} onClick={() => void print()}>Print label</Button>}
    >
      <div className="flex flex-col items-center gap-3 py-2">
        {qr.isPending && <p role="status" className="text-sm text-muted">Generating QR label…</p>}
        {qr.isError && <p role="alert" className="text-sm text-soft">The QR image could not be generated.</p>}
        {qr.data && <img src={qr.data} alt={'QR code for ' + equipment.serial_number} width={192} height={192} className="rounded-md" />}
        <code className="break-all rounded-md border border-line px-2 py-1 text-xs text-ink">{payload}</code>
        {printError && <p role="alert" className="text-sm text-rose">{printError}</p>}
      </div>
    </Dialog>
  )
}

function EquipmentView({ scope }: { scope: IdentityScopeRef }) {
  const [{ page, search }, setFilters] = useState<ListFilters>({ page: 0, search: '' })
  const [labelFor, setLabelFor] = useState<Equipment | null>(null)
  const query = useCatalogQuery(scope, ['equipment', page, search], (signal) => readEquipment(page, search, scope, signal))
  const columns: ColumnDef<Equipment>[] = [
    { key: 'asset', header: 'Asset', accessor: (row) => namedEntry(row.model_name, row.serial_number) },
    { key: 'category', header: 'Category', accessor: (row) => row.item_categories?.name ?? '—' },
    { key: 'warehouse', header: 'Warehouse', accessor: (row) => row.warehouses?.name ?? '—' },
    {
      key: 'status', header: 'Status', accessor: (row) => (
        <StatusPill tone={equipmentStatus[row.status].tone}>{equipmentStatus[row.status].label}</StatusPill>
      ),
    },
    { key: 'sensitive', header: 'Handling', accessor: (row) => row.is_sensitive ? <StatusPill tone="warning" withDot={false}>Sensitive</StatusPill> : '—' },
    {
      key: 'label', header: 'Label', accessor: (row) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={'QR label for ' + row.serial_number}
          leftIcon={<QrCode size={16} aria-hidden="true" />}
          onClick={() => setLabelFor(row)}
        >
          QR label
        </Button>
      ),
    },
  ]
  return (
    <>
      <CatalogSearch label="Search by serial number" placeholder="Search by serial number" onApply={(value) => setFilters({ page: 0, search: value })} />
      <CatalogTable
        query={query}
        columns={columns}
        title={titles.equipment.title}
        emptyTitle={search ? 'No matching assets' : 'No equipment assets yet'}
        emptyDescription={search ? 'Check the serial number or clear the search.' : 'Registered equipment assets will appear here.'}
        page={page}
        onPage={(next) => setFilters({ search, page: next })}
      />
      {labelFor && <EquipmentLabel equipment={labelFor} scope={scope} onClose={() => setLabelFor(null)} />}
    </>
  )
}

function LedgerView({ scope }: { scope: IdentityScopeRef }) {
  const [page, setPage] = useState(0)
  const query = useCatalogQuery(scope, ['ledger', page], (signal) => readStockMovements(page, catalogPageSize, scope, signal))
  return (
    <CatalogTable
      query={query}
      columns={movementColumns}
      title={titles.ledger.title}
      emptyTitle="No stock movements yet"
      emptyDescription="Recorded receipts, issues, returns and adjustments will appear here."
      page={page}
      onPage={setPage}
    />
  )
}

const views: Record<CatalogView, (props: { scope: IdentityScopeRef }) => ReactNode> = {
  overview: InventoryOverviewView,
  consumables: ConsumablesView,
  equipment: EquipmentView,
  ledger: LedgerView,
}

export function InventoryCatalogPage({ view }: { view: CatalogView }) {
  const scope = useProtectedIdentityScope(useAuth())
  const View = views[view]
  return (
    <div className="space-y-5">
      <PageHeader {...titles[view]} />
      {scope.isAuthReady && scope.identityKey && <View key={[scope.identityKey, scope.authEpoch, view].join(':')} scope={scope} />}
    </div>
  )
}
