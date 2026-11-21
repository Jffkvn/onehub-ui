import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import type { IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { getSupabaseClient } from '@/lib/supabase/client'
import { systemSessionGuard } from './systemSession'

export const companySchema = z.object({
  name: z.string(), slug: z.string(), timezone: z.string(), currency_code: z.string(), updated_at: z.string(),
})

export function companyProfileKey(scope: IdentityScopeRef) {
  return ['company-profile', scope.identityKey, scope.authEpoch] as const
}

export function useCompanyProfile(scope: IdentityScopeRef, enabled = true) {
  return useQuery({
    queryKey: companyProfileKey(scope),
    enabled: enabled && scope.isAuthReady,
    retry: false,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const check = systemSessionGuard(scope)
      const { data, error } = await getSupabaseClient().from('company_profile')
        .select('name,slug,timezone,currency_code,updated_at').eq('singleton', true).abortSignal(signal).single()
      check()
      if (error) throw new Error('Company settings could not be loaded.')
      return companySchema.parse(data)
    },
  })
}
