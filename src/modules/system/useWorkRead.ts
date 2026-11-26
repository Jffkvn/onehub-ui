import { useQuery } from '@tanstack/react-query'
import type { IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { systemSessionGuard } from './systemSession'

export type WorkAccess = {
  scope: IdentityScopeRef
  canOpen: (key: string) => boolean
  hasPermission: (key: string) => boolean
}

export function useWorkRead<T>(
  scope: IdentityScopeRef,
  key: readonly string[],
  enabled: boolean,
  load: (signal: AbortSignal, check: () => void) => Promise<T>,
  interval?: number,
) {
  return useQuery({
    queryKey: ['work-dashboard', scope.identityKey, scope.authEpoch, ...key],
    enabled: enabled && scope.isAuthReady,
    queryFn: async ({ signal }) => {
      const current = systemSessionGuard(scope)
      const check = () => {
        signal.throwIfAborted()
        current()
      }
      const data = await load(signal, check)
      check()
      return data
    },
    retry: false,
    refetchInterval: interval,
  })
}
