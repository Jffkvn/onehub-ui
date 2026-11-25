import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Router, Wrench } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/patterns/EmptyState'
import { KpiCard } from '@/components/patterns/KpiCard'
import { PageHeader } from '@/components/patterns/PageHeader'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Textarea } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { extractErrorMessage, isAbortError, useProtectedIdentityScope } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'

import {
  confirmRouterHandover,
  readMyRouterFloat,
  reportRouterFaulty,
  type MyFloatItem,
} from './routerFloatApi'

function FaultyDialog({
  item,
  onClose,
  onConfirm,
  isPending,
  error,
}: {
  item: MyFloatItem
  onClose: () => void
  onConfirm: (notes: string) => void
  isPending: boolean
  error?: string
}) {
  const [notes, setNotes] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (notes.trim().length < 3 || isPending) return
    onConfirm(notes)
  }

  return (
    <Dialog
      open
      title="Report faulty float router"
      description={`${item.model_name} · SN ${item.serial_number}`}
      onOpenChange={(next) => {
        if (!next && !isPending) onClose()
      }}
    >
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-xs text-soft">
          Faulty float routers stay counted in your 5-router allowance until physically handed back and confirmed at the warehouse.
        </p>
        <FormGroup label="Fault description" htmlFor="faulty-router-notes" required>
          <Textarea
            id="faulty-router-notes"
            value={notes}
            minLength={3}
            maxLength={500}
            required
            disabled={isPending}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. No power / red LOS LED on bench test"
          />
        </FormGroup>
        <FieldError error={error} />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={isPending} disabled={notes.trim().length < 3}>
            Flag as faulty
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export function MyRouterFloatPage() {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [faultyTarget, setFaultyTarget] = useState<MyFloatItem | null>(null)
  const [faultyError, setFaultyError] = useState<string>()

  const floatQuery = useQuery({
    queryKey: ['warehouse', 'my-router-float', scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => readMyRouterFloat(scope, signal),
    enabled: scope.isAuthReady && Boolean(scope.identityKey),
    retry: false,
  })

  const confirmMutation = useMutation({
    mutationFn: (custodyIds: string[]) => confirmRouterHandover(scope, custodyIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      toast('Counter pickup confirmed — router added to your active float', { tone: 'success' })
    },
    onError: (err) => {
      if (!isAbortError(err)) toast(extractErrorMessage(err), { tone: 'danger' })
    },
  })

  const faultyMutation = useMutation({
    mutationFn: ({ custodyId, notes }: { custodyId: string; notes: string }) =>
      reportRouterFaulty(scope, custodyId, notes),
    onSuccess: () => {
      setFaultyTarget(null)
      setFaultyError(undefined)
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      toast('Router flagged faulty — return it to the depot to free your cap slot', { tone: 'success' })
    },
    onError: (err) => {
      if (!isAbortError(err)) setFaultyError(extractErrorMessage(err))
    },
  })

  if (!scope.isAuthReady || !scope.identityKey) return null

  const data = floatQuery.data
  const pendingItems = data?.items.filter((i) => i.float_state === 'pending_handover') ?? []
  const confirmedItems = data?.items.filter((i) => i.float_state === 'with_technician') ?? []
  const faultyItems = data?.items.filter((i) => i.float_state === 'faulty_to_return') ?? []

  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Service Ops"
        title="My Router Float"
        subtitle="Confirm warehouse counter pickups, manage your 5-router installation float, or flag DOA units."
        actions={
          <Link to="/services/my-jobs">
            <Button type="button" variant="outline" size="sm" leftIcon={<Wrench className="h-4 w-4" />}>
              Open My Service Jobs
            </Button>
          </Link>
        }
      />

      {floatQuery.isPending ? (
        <p role="status" className="text-sm text-muted">Loading your router float…</p>
      ) : floatQuery.isError ? (
        <div role="alert" className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <FieldError>{extractErrorMessage(floatQuery.error)}</FieldError>
          <Button type="button" variant="outline" size="sm" onClick={() => void floatQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard title="Active float" value={`${data.active_total} / ${data.cap}`} icon={<Router size={18} />} tone="blue" />
            <KpiCard title="Pending pickup" value={String(data.pending_count)} icon={<Clock size={18} />} tone="amber" />
            <KpiCard title="Ready to install" value={String(data.confirmed_count)} icon={<CheckCircle2 size={18} />} tone="emerald" />
            <KpiCard title="Faulty to return" value={String(data.faulty_count)} icon={<AlertTriangle size={18} />} tone="rose" />
          </div>

          {data.items.length === 0 && (
            <EmptyState
              title="No routers in your float"
              description="When the warehouse issues CPE routers to you, confirm receipt here before installing on a job."
              icon={<Router className="h-6 w-6" />}
            />
          )}

          {pendingItems.length > 0 && (
            <section className="space-y-3 rounded-xl border border-amber/50 bg-amber-tint/20 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink">
                    Awaiting counter confirmation ({pendingItems.length})
                  </h2>
                  <p className="text-xs text-soft">
                    Check the serial number on the box at the depot counter and tap Confirm Received.
                  </p>
                </div>
                {pendingItems.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    loading={confirmMutation.isPending}
                    leftIcon={<CheckCircle2 className="h-4 w-4" />}
                    onClick={() => confirmMutation.mutate(pendingItems.map((i) => i.custody_id))}
                  >
                    Confirm all ({pendingItems.length})
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {pendingItems.map((item) => (
                  <div
                    key={item.custody_id}
                    className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium text-ink">{item.model_name}</p>
                      <p className="font-mono text-xs text-soft">
                        SN: {item.serial_number}
                        {item.mac_address ? ` · MAC: ${item.mac_address}` : ''}
                      </p>
                      <p className="text-xs text-muted">Depot: {item.warehouse_name}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      loading={confirmMutation.isPending}
                      leftIcon={<CheckCircle2 className="h-4 w-4" />}
                      onClick={() => confirmMutation.mutate([item.custody_id])}
                    >
                      Confirm Received
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {confirmedItems.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-base font-semibold text-ink">
                Confirmed float — ready to install ({confirmedItems.length})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {confirmedItems.map((item) => (
                  <div
                    key={item.custody_id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-surface p-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-ink">{item.model_name}</p>
                        <StatusPill tone="success">Ready</StatusPill>
                      </div>
                      <p className="font-mono text-xs text-soft">SN: {item.serial_number}</p>
                      {item.mac_address && (
                        <p className="font-mono text-xs text-muted">MAC: {item.mac_address}</p>
                      )}
                      <p className="text-xs text-muted">Issued from {item.warehouse_name}</p>
                    </div>
                    <div className="flex items-center justify-end border-t border-line pt-2.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        leftIcon={<AlertTriangle className="h-3.5 w-3.5 text-rose" />}
                        onClick={() => {
                          setFaultyError(undefined)
                          setFaultyTarget(item)
                        }}
                      >
                        Report Faulty
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {faultyItems.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-base font-semibold text-ink">
                Faulty — pending depot return ({faultyItems.length})
              </h2>
              <div className="space-y-2">
                {faultyItems.map((item) => (
                  <div
                    key={item.custody_id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose/40 bg-rose-tint/15 p-4"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium text-ink">{item.model_name}</p>
                      <p className="font-mono text-xs text-soft">
                        SN: {item.serial_number}
                        {item.mac_address ? ` · MAC: ${item.mac_address}` : ''}
                      </p>
                      {item.faulty_notes && (
                        <p className="text-xs text-rose">Reason: {item.faulty_notes}</p>
                      )}
                    </div>
                    <StatusPill tone="danger">Return to {item.warehouse_name}</StatusPill>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {faultyTarget && (
        <FaultyDialog
          item={faultyTarget}
          isPending={faultyMutation.isPending}
          error={faultyError}
          onClose={() => setFaultyTarget(null)}
          onConfirm={(notes) => faultyMutation.mutate({ custodyId: faultyTarget.custody_id, notes })}
        />
      )}
    </main>
  )
}
