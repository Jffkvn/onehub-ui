import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { NotificationBell } from './NotificationBell'
import type { NotificationBellFilter, NotificationItem } from './api/notifications'

const mockUseAuth = vi.fn()
const mockUseBellState = vi.fn()
const mockUsePreferences = vi.fn()
const mockMarkRead = vi.fn()
const mockMarkAllRead = vi.fn()
const mockSetEmailPref = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth() as unknown,
}))

vi.mock('./api/notifications', async () => {
  const actual = await vi.importActual<typeof import('./api/notifications')>('./api/notifications')
  return {
    ...actual,
    useNotificationBellState: (args: unknown) => mockUseBellState(args) as unknown,
    useNotificationPreferences: () => mockUsePreferences() as unknown,
    useMarkNotificationRead: () => ({ mutateAsync: mockMarkRead, isPending: false }),
    useMarkAllNotificationsRead: () => ({ mutateAsync: mockMarkAllRead, isPending: false }),
    useSetNotificationEmailPreference: () => ({ mutateAsync: mockSetEmailPref, isPending: false }),
  }
})

function renderBell(onNavigate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    onNavigate,
    ...render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <NotificationBell onNavigate={onNavigate} />
        </ToastProvider>
      </QueryClientProvider>,
    ),
  }
}

const URGENT_OLD_ITEM: NotificationItem = {
  id: 'n-11111111-1111-4111-8111-111111111111',
  recipient_profile_id: 'coord-1',
  title: 'URGENT Flag: SRV-2026-00055',
  message: 'Older safety hazard buried beyond page 1.',
  is_read: false,
  category: 'service_urgent',
  created_at: '2026-11-16T08:30:00Z',
  action_path:
    '/services/requests/d5100000-0000-4000-8000-000000000055?urgent=f5100000-0000-4000-8000-000000000055',
}

describe('NotificationBell & Category Preferences (Batch 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'coord-1' },
      access: {
        profile: { id: 'coord-1', displayName: 'Coordinator One', status: 'active' },
        roleKeys: ['coordinator'],
        permissionKeys: ['service_requests.read', 'service_alerts.ack'],
      },
    })
    mockUseBellState.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        total_count: 2,
        unread_count: 1,
        unread_urgent_count: 1,
        filter: 'all',
        filtered_count: 2,
        limit: 20,
        offset: 0,
        rows: [
          URGENT_OLD_ITEM,
          {
            id: 'n-22222222-2222-4222-8222-222222222222',
            recipient_profile_id: 'coord-1',
            title: 'Ticket Assigned',
            message: 'Crew dispatched.',
            is_read: true,
            category: 'service',
            created_at: '2026-11-17T08:00:00Z',
            action_path: '/services/requests/d5100000-0000-4000-8000-000000000055',
          },
        ],
      },
    })
    mockUsePreferences.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: [
        { profile_id: 'coord-1', category: 'service_urgent', email_enabled: false },
        { profile_id: 'coord-1', category: 'general', email_enabled: false },
      ],
    })
    mockMarkRead.mockResolvedValue(undefined)
    mockMarkAllRead.mockResolvedValue(undefined)
    mockSetEmailPref.mockResolvedValue(undefined)
  })

  it('shows unread count, marks urgent item read, and navigates with ?urgent= query param', async () => {
    const { onNavigate } = renderBell()
    const trigger = screen.getByRole('button', { name: /Notifications \(1 unread, 1 urgent\)/i })
    fireEvent.click(trigger)

    expect(await screen.findByText('URGENT Flag: SRV-2026-00055')).toBeInTheDocument()
    fireEvent.click(screen.getByText('URGENT Flag: SRV-2026-00055'))

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith('n-11111111-1111-4111-8111-111111111111')
      expect(onNavigate).toHaveBeenCalledWith(
        '/services/requests/d5100000-0000-4000-8000-000000000055?urgent=f5100000-0000-4000-8000-000000000055',
      )
    })
  })

  it('B6-03: preserves complete unread urgent badge when 50+ newer read notifications fill earlier pages and lets users page & filter to buried urgent alert', async () => {
    const readItems: NotificationItem[] = Array.from({ length: 55 }, (_, i) => ({
      id: `n-read-${String(i).padStart(32, '0')}`,
      recipient_profile_id: 'coord-1',
      title: `Read Notification #${i + 1}`,
      message: 'Completed update.',
      is_read: true,
      category: i % 2 === 0 ? 'service' : 'general',
      created_at: '2026-11-17T10:00:00Z',
      action_path: null,
    }))

    mockUseBellState.mockImplementation(
      ({ filter = 'all', limit = 20, offset = 0 }: { filter?: NotificationBellFilter; limit?: number; offset?: number } = {}) => {
        const pool = filter === 'urgent_unread' ? [URGENT_OLD_ITEM] : filter === 'unread' ? [URGENT_OLD_ITEM] : [...readItems, URGENT_OLD_ITEM]
        return {
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
          data: {
            total_count: 56,
            unread_count: 1,
            unread_urgent_count: 1,
            filter,
            filtered_count: pool.length,
            limit,
            offset,
            rows: pool.slice(offset, offset + limit),
          },
        }
      },
    )

    const { onNavigate } = renderBell()
    // Badge reports complete server unread total (1) + urgent even though page 1 contains ONLY read notifications!
    const trigger = screen.getByRole('button', { name: /Notifications \(1 unread, 1 urgent\)/i })
    fireEvent.click(trigger)

    expect(await screen.findByText('Read Notification #1')).toBeInTheDocument()
    expect(screen.queryByText('URGENT Flag: SRV-2026-00055')).not.toBeInTheDocument()
    expect(screen.getByText(/Showing 1–20 of 56 · Page 1 of 3/i)).toBeInTheDocument()

    // Browsing pages reaches older notifications (page 3 reaches index 40..55 including urgent item)
    fireEvent.click(screen.getByRole('button', { name: /Next notifications page/i }))
    expect(await screen.findByText('Read Notification #21')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Next notifications page/i }))
    expect(await screen.findByText('URGENT Flag: SRV-2026-00055')).toBeInTheDocument()

    // Returning to page 1 and clicking sticky urgent banner switches filter to urgent_unread immediately
    fireEvent.click(screen.getByRole('button', { name: /All \(56\)/i }))
    fireEvent.click(await screen.findByRole('button', { name: /1 unread urgent alert.*View urgent/i }))
    expect(await screen.findByText('URGENT Flag: SRV-2026-00055')).toBeInTheDocument()

    // Opening urgent item marks ONLY the notification read and routes cleanly to ?urgent=<flagId>
    fireEvent.click(screen.getByText('URGENT Flag: SRV-2026-00055'))
    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledWith(URGENT_OLD_ITEM.id)
      expect(onNavigate).toHaveBeenCalledWith(URGENT_OLD_ITEM.action_path)
    })
  })

  it('B6-03: surfaces explicit error & Retry without presenting partial counts on query failure', async () => {
    const refetch = vi.fn()
    mockUseBellState.mockReturnValue({
      isLoading: false,
      isError: true,
      refetch,
      data: undefined,
    })

    renderBell()
    const trigger = screen.getByRole('button', { name: /Notifications \(unavailable\)/i })
    fireEvent.click(trigger)
    expect(await screen.findByText(/Could not load notification counts or history/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('locks service_urgent email alerts ON even if legacy opt-out exists, while allowing toggles on general', async () => {
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: /Notifications \(1 unread, 1 urgent\)/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Email Prefs/i }))

    const urgentSwitch = screen.getByRole('switch', {
      name: /Urgent Field Service Alerts email alerts \(locked on\)/i,
    })
    expect(urgentSwitch).toBeDisabled()
    expect(urgentSwitch).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Mandatory')).toBeInTheDocument()

    const generalSwitch = screen.getByRole('switch', {
      name: /General Announcements email alerts/i,
    })
    expect(generalSwitch).not.toBeDisabled()
    expect(generalSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(generalSwitch)
    await waitFor(() => {
      expect(mockSetEmailPref).toHaveBeenCalledWith({ category: 'general', enabled: true })
    })
  })

  it('renders mark all read cleanly and hides bell for service_monitor accounts', async () => {
    const view = renderBell()
    fireEvent.click(screen.getByRole('button', { name: /Notifications \(1 unread, 1 urgent\)/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Mark all read/i }))
    await waitFor(() => {
      expect(mockMarkAllRead).toHaveBeenCalledTimes(1)
    })

    // Monitor display accounts never see notification inbox or prefs
    mockUseAuth.mockReturnValue({
      status: 'authenticated',
      devPreviewRole: null,
      session: { userId: 'mon-1' },
      access: {
        profile: { id: 'mon-1', displayName: 'Wallboard Display', status: 'active' },
        roleKeys: ['service_monitor'],
        permissionKeys: ['service_requests.monitor', 'service_alerts.read'],
      },
    })
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <NotificationBell />
        </ToastProvider>
      </QueryClientProvider>,
    )
    expect(screen.queryByTitle('Notifications')).not.toBeInTheDocument()
  })
})
