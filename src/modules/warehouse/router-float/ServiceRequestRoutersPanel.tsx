import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Router } from 'lucide-react'
import { useState } from 'react'

import { routerName } from './routerName'
import { Button } from '@/components/ui/Button'
import { FieldError } from '@/components/ui/Input'
import { StatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { extractErrorMessage, isAbortError, useProtectedIdentityScope } from '@/lib/idempotency/pendingOperations'
import { ServiceTimestamp } from '@/modules/field-services/components/ServiceBadges'
import type { ServiceRequestStatus } from '@/modules/field-services/schemas/services'
import { useAuth } from '@/modules/auth/AuthProvider'

import {
  installRouterOnServiceRequest,
  listServiceRequestRouters,
  readMyRouterFloat,
} from './routerFloatApi'

const selectClass =
  'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald disabled:opacity-50'

export function ServiceRequestRoutersPanel({
  serviceRequestId,
  status,
  openVisitId,
  isActiveCrewMember,
}: {
  serviceRequestId: string
  status: ServiceRequestStatus
  openVisitId: string | null
  isActiveCrewMember: boolean
}) {
  const auth = useAuth()
  const scope = useProtectedIdentityScope(auth)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [installError, setInstallError] = useState<string>()

  const canInstallNow =
    isActiveCrewMember && ['assigned', 'in_progress', 'follow_up_required'].includes(status)

  const installedQuery = useQuery({
    queryKey: ['warehouse', 'service-request-routers', serviceRequestId, scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => listServiceRequestRouters(scope, serviceRequestId, signal),
    enabled: scope.isAuthReady && Boolean(scope.identityKey) && Boolean(serviceRequestId),
    retry: false,
  })

  const myFloatQuery = useQuery({
    queryKey: ['warehouse', 'my-router-float', scope.identityKey, scope.authEpoch],
    queryFn: ({ signal }) => readMyRouterFloat(scope, signal),
    enabled: scope.isAuthReady && Boolean(scope.identityKey) && canInstallNow,
    retry: false,
  })

  const installMutation = useMutation({
    mutationFn: () =>
      installRouterOnServiceRequest(scope, {
        equipmentAssetId: selectedAssetId,
        serviceRequestId,
        serviceVisitId: openVisitId,
      }),
    onSuccess: () => {
      setSelectedAssetId('')
      setInstallError(undefined)
      void queryClient.invalidateQueries({ queryKey: ['warehouse'] })
      toast('Installed router recorded against this service ticket', { tone: 'success' })
    },
    onError: (err) => {
      if (!isAbortError(err)) setInstallError(extractErrorMessage(err))
    },
  })

  const installedRouters = installedQuery.data ?? []
  const confirmedFloat =
    myFloatQuery.data?.items.filter((item) => item.float_state === 'with_technician') ?? []

  if (installedRouters.length === 0 && !canInstallNow) {
    return null
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Router className="h-4 w-4 text-emerald-600" />
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
            Installed CPE Routers ({installedRouters.length})
          </h2>
        </div>
        {canInstallNow && myFloatQuery.data && (
          <StatusPill tone="info" withDot={false}>
            My float: {myFloatQuery.data.confirmed_count} ready ({myFloatQuery.data.active_total}/{myFloatQuery.data.cap})
          </StatusPill>
        )}
      </div>

      {installedRouters.length === 0 ? (
        <p className="text-xs text-muted">No CPE router recorded as installed on this ticket yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {installedRouters.map((router) => (
            <li
              key={router.custody_id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
            >
              <div>
                <p className="font-semibold text-ink">{routerName(router.model_name)}</p>
                <p className="font-mono text-soft">
                  SN: {router.serial_number}
                  {router.mac_address ? ` · MAC: ${router.mac_address}` : ''}
                </p>
              </div>
              <div className="text-right text-muted">
                <p>Installed by {router.installed_by_name ?? 'Technician'}</p>
                <ServiceTimestamp value={router.installed_at} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {canInstallNow && (
        <div className="border-t border-line pt-4 space-y-2.5">
          <p className="text-xs font-semibold text-ink">Install router from your confirmed float</p>
          {confirmedFloat.length === 0 ? (
            <p className="text-xs text-muted">
              You have no confirmed routers ready to install. Pick up routers at the warehouse and tap Confirm Received on My Router Float.
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                aria-label="Select router from my float"
                className={selectClass}
                value={selectedAssetId}
                disabled={installMutation.isPending}
                onChange={(e) => {
                  setSelectedAssetId(e.target.value)
                  setInstallError(undefined)
                }}
              >
                <option value="">Choose confirmed router…</option>
                {confirmedFloat.map((item) => (
                  <option key={item.equipment_asset_id} value={item.equipment_asset_id}>
                    {routerName(item.model_name)} · {item.serial_number}
                    {item.mac_address ? ` · ${item.mac_address}` : ''}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="primary"
                className="shrink-0"
                loading={installMutation.isPending}
                disabled={!selectedAssetId}
                leftIcon={<CheckCircle2 className="h-4 w-4" />}
                onClick={() => installMutation.mutate()}
              >
                Record Installed Router
              </Button>
            </div>
          )}
          <FieldError error={installError} />
        </div>
      )}
    </section>
  )
}
