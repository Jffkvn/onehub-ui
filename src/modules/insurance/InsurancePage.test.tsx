import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import InsurancePage from './InsurancePage'

const { rpc, empOrder } = vi.hoisted(() => ({
  rpc: vi.fn(),
  empOrder: vi.fn(),
}))

let currentPermissions: string[] = []

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    session: { userId: 'u-1', email: 'user@example.com' },
    access: {
      profile: { id: 'u-1', displayName: 'QA User', status: 'active' },
      roleKeys: [],
      permissionKeys: currentPermissions,
    },
    authEpoch: 1,
    devPreviewRole: null,
  }),
  useHasPermission: (key: string) => currentPermissions.includes(key),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        is: () => ({
          order: empOrder,
        }),
      }),
    }),
  }),
}))

function renderInsurance(manage = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <InsurancePage manage={manage} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('InsurancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    empOrder.mockResolvedValue({
      data: [
        {
          id: 'e1000000-0000-4000-8000-000000000001',
          employee_number: 'EMP-01',
          legal_name: 'Grace Atim',
          company_email: 'grace@example.com',
          personal_email: null,
          work_phone: null,
          gender: null,
          date_of_birth: null,
          archived_at: null,
          employee_confidential_profiles: [],
          employment_periods: [],
        },
      ],
      error: null,
    })
  })

  it('shows employee unlinked empty state cleanly and renders redacted self-cover cards', async () => {
    currentPermissions = ['insurance.read_self']
    rpc.mockResolvedValueOnce({
      data: { asOf: '2026-11-19', linked: false, items: [] },
      error: null,
    })

    const first = renderInsurance(false)
    expect(await screen.findByText(/employee dossier not linked/i)).toBeInTheDocument()
    first.unmount()

    rpc.mockResolvedValueOnce({
      data: {
        asOf: '2026-11-19',
        linked: true,
        items: [
          {
            id: 'b1000000-0000-4000-8000-000000000001',
            insurer: 'UAP Old Mutual',
            plan_tier: 'Gold Family',
            policy_number: 'POL-900',
            member_number: 'MEM-900',
            start_date: '2026-01-01',
            renewal_date: '2026-12-05',
            status: 'active',
            display_status: 'active',
            is_expired: false,
            renewing_soon: true,
            days_to_renewal: 16,
          },
        ],
      },
      error: null,
    })

    renderInsurance(false)

    expect(await screen.findByText('UAP Old Mutual')).toBeInTheDocument()
    expect(screen.getByText(/renewing in 16d/i)).toBeInTheDocument()
    expect(screen.queryByText(/annual premium/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/dependant/i)).not.toBeInTheDocument()
  })

  it('renders HR register with edit/archive actions and keeps CFO read-only', async () => {
    const managePayload = {
      asOf: '2026-11-19',
      summary: {
        activePolicies: 1,
        coveredEmployees: 1,
        activeEmployees: 3,
        renewingSoonCount: 1,
        expiredActiveCount: 0,
        annualPremiumUgx: 4500000,
      },
      items: [
        {
          id: 'b1000000-0000-4000-8000-000000000001',
          employee_id: 'e1000000-0000-4000-8000-000000000001',
          employee_number: 'EMP-01',
          employee_name: 'Grace Atim',
          insurer: 'Jubilee Health',
          plan_tier: 'Executive',
          policy_number: 'JUB-1',
          member_number: 'MEM-1',
          start_date: '2026-01-01',
          renewal_date: '2026-12-01',
          premium_amount_ugx: 4500000,
          dependants_count: 2,
          dependant_names: 'Spouse, Child',
          status: 'active',
          display_status: 'active',
          is_expired: false,
          renewing_soon: true,
          days_to_renewal: 12,
          notes: 'Internal Broker Note',
          version: 1,
        },
      ],
    }

    currentPermissions = ['insurance.read']
    rpc.mockResolvedValueOnce({ data: managePayload, error: null })
    const cfoRender = renderInsurance(true)

    expect(await screen.findByText('Grace Atim')).toBeInTheDocument()
    expect(screen.getByText('Internal Broker Note')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add policy/i })).not.toBeInTheDocument()
    cfoRender.unmount()

    currentPermissions = ['insurance.read', 'insurance.manage']
    rpc.mockResolvedValue({ data: managePayload, error: null })
    renderInsurance(true)

    expect(await screen.findByRole('button', { name: /add policy/i })).toBeInTheDocument()
    const archiveBtn = await screen.findByRole('button', {
      name: /archive policy for grace atim/i,
    })
    fireEvent.click(archiveBtn)
    fireEvent.click(screen.getByRole('button', { name: /confirm archive/i }))

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('rpc_archive_employee_insurance', {
        p_policy_id: 'b1000000-0000-4000-8000-000000000001',
        p_expected_version: 1,
      })
    })
  })
})
