import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnnouncementsPage from './AnnouncementsPage'
import { PinnedAnnouncements } from './PinnedAnnouncements'
import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'

const rpc = vi.hoisted(() => vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>())
const account = vi.hoisted(() => ({ id: 'employee-one', permissions: ['announcements.read'] }))

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: account.id },
    access: { profile: { id: account.id }, permissionKeys: account.permissions },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ rpc }),
}))

const noticeId = 'ce0247cf-778b-4faf-9e72-552a1500cdf0'
const published = '2026-11-15T06:00:00.000Z'
const notice = {
  id: noticeId,
  title: 'Office hours',
  body: 'Field operations begin at 8 a.m.',
  is_pinned: true,
  published_at: published,
  expires_at: null,
  version: 1,
  status: 'published',
  read_at: null,
  read_count: null,
}
function open(manage = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><AnnouncementsPage manage={manage} /></MemoryRouter></QueryClientProvider>)
}

describe('Announcements', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    account.permissions = ['announcements.read']
    rpc.mockReset()
  })

  it('shows an unread notice and records only its first open', async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({
      data: name === 'rpc_mark_announcement_read' ? published : { items: [notice], has_more: false },
      error: null,
    }))
    open()
    expect(await screen.findByText('Unread')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Office hours' })
    fireEvent.click(toggle)
    expect(screen.getByText(notice.body)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Unread')).not.toBeInTheDocument())
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(rpc.mock.calls.filter(([name]) => name === 'rpc_mark_announcement_read')).toEqual([
      ['rpc_mark_announcement_read', { p_announcement_id: noticeId }],
    ])
    expect(screen.queryByRole('button', { name: 'New announcement' })).not.toBeInTheDocument()
  })

  it('previews pinned notice titles in My Workspace without marking them read', async () => {
    rpc.mockResolvedValue({
      data: { items: [
        notice,
        { ...notice, id: 'b7403ddd-b956-4cf1-ae81-6d363d8a07ea', title: 'Ordinary message', is_pinned: false },
      ], has_more: false },
      error: null,
    })
    const client = new QueryClient()
    render(<QueryClientProvider client={client}><MemoryRouter><PinnedAnnouncements /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText(notice.title)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All announcements' })).toHaveAttribute('href', '/my/announcements')
    expect(screen.queryByText('Ordinary message')).not.toBeInTheDocument()
    expect(screen.queryByText(notice.body)).not.toBeInTheDocument()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['rpc_list_announcements'])
  })

  it('requires announcement management permission even when the page is opened directly', () => {
    open(true)
    expect(screen.getByText(/Permission Denied/u)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('publishes an HR announcement and archives only after confirmation', async () => {
    account.permissions = ['announcements.read', 'announcements.manage']
    rpc.mockImplementation((name: string) => Promise.resolve({
      data: name === 'rpc_save_announcement' ? noticeId
        : name === 'rpc_archive_announcement' ? null
          : { items: [{ ...notice, read_count: 4 }], has_more: false },
      error: null,
    }))
    open(true)
    expect(await screen.findByText(/4 reads/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }))
    const form = screen.getByRole('dialog')
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Upcoming visits' } })
    fireEvent.change(within(form).getByLabelText('Message'), { target: { value: 'Check your assigned jobs.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Publish announcement' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_save_announcement', {
      p_announcement_id: null, p_expected_version: null, p_title: 'Upcoming visits',
      p_body: 'Check your assigned jobs.', p_is_pinned: false, p_published_at: null, p_expires_at: null,
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Archive Office hours' }))
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_archive_announcement')).toBe(false)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive announcement' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_archive_announcement', {
      p_announcement_id: noticeId, p_expected_version: 1,
    }))
  })
})
