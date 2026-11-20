import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import PerformancePage from './PerformancePage'

const actor = '91000000-0000-4000-8000-000000000001'
const review = '92000000-0000-4000-8000-000000000001'
const employee = '93000000-0000-4000-8000-000000000001'
const reviewer = '94000000-0000-4000-8000-000000000001'
const cycle = '95000000-0000-4000-8000-000000000001'
const goal = '96000000-0000-4000-8000-000000000001'
const rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>()
let permissions: string[]
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    session: { userId: actor },
    access: { profile: { id: actor }, permissionKeys: permissions },
    authEpoch: 1,
  }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

function row(status: string, reviewerId = reviewer) {
  return {
    id: review, cycle_id: cycle, cycle_name: 'Q4 performance',
    employee_id: employee, employee_number: 'QA-001', employee_name: 'QA Engineer',
    reviewer_profile_id: reviewerId, reviewer_name: 'QA Reviewer', status,
    overall_score: 4, manager_comments: 'Persisted reviewer comments',
    recommend_increment: false, recommend_promotion: false, hr_reason: null,
    acknowledged_at: null, acknowledgment_comment: null,
    goals: [{ id: goal, description: 'Site uptime', manager_rating: 4 }],
  }
}

function open(path: string, manage = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><PerformancePage manage={manage} /></MemoryRouter>
  </QueryClientProvider>)
}

describe('Performance workspaces', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    rpc.mockReset()
    permissions = ['performance.read_self']
  })

  it('keeps employee drafts and event history out of unavailable review links', async () => {
    rpc.mockResolvedValue({ data: [row('draft')], error: null })
    open('/my/performance?review=' + review)
    expect(await screen.findByText('This review is unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Persisted reviewer comments')).not.toBeInTheDocument()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['rpc_list_my_performance_reviews'])
  })

  it('acknowledges the released review with the employee comment', async () => {
    let acknowledged = false
    rpc.mockImplementation((name) => {
      if (name === 'rpc_acknowledge_performance_review') acknowledged = true
      return Promise.resolve({
        data: name === 'rpc_list_my_performance_reviews'
          ? [row(acknowledged ? 'employee_acknowledged' : 'hr_approved')]
          : name === 'rpc_acknowledge_performance_review' ? null : [],
        error: null,
      })
    })
    open('/my/performance?review=' + review)
    const button = await screen.findByRole('button', { name: 'Acknowledge review' })
    fireEvent.change(screen.getByLabelText('Acknowledgment comment (optional)'), { target: { value: 'Discussed with my reviewer' } })
    fireEvent.click(button)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_acknowledge_performance_review', {
      p_review_id: review, p_comment: 'Discussed with my reviewer',
    }))
    expect(await screen.findByText('Acknowledged')).toBeInTheDocument()
  })

  it('creates and activates a cycle using the existing HR RPCs', async () => {
    permissions.push('performance.manage')
    let state = ''
    rpc.mockImplementation((name) => {
      if (name === 'rpc_create_performance_cycle') state = 'draft'
      if (name === 'rpc_set_performance_cycle_status') state = 'active'
      return Promise.resolve({
        data: name === 'rpc_list_performance_cycles' && state ? [{
          id: cycle, name: 'End-of-year reviews', start_date: '2026-10-01', end_date: '2026-12-31',
          status: state, total_reviews: 0, completed_reviews: 0,
        }] : name === 'rpc_create_performance_cycle' ? cycle : [],
        error: null,
      })
    })
    open('/people/performance', true)
    fireEvent.click(screen.getByRole('button', { name: 'New cycle' }))
    fireEvent.change(screen.getByLabelText('Cycle name'), { target: { value: 'End-of-year reviews' } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-12-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create cycle' }))
    expect(await screen.findByRole('combobox', { name: 'Review cycle' })).toHaveValue(cycle)
    fireEvent.click(await screen.findByRole('button', { name: 'Activate cycle' }))
    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('rpc_create_performance_cycle', {
      p_name: 'End-of-year reviews', p_start_date: '2026-10-01', p_end_date: '2026-12-31',
    })
    expect(rpc).toHaveBeenCalledWith('rpc_set_performance_cycle_status', { p_cycle_id: cycle, p_status: 'active' })
  })

  it('uses the review-assigned label for the first activity entry', async () => {
    permissions.push('performance.manage')
    rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'rpc_list_performance_reviews' ? [row('draft')]
        : name === 'rpc_list_performance_review_events'
          ? [{ id: goal, event_type: 'started', reason: 'Reviewer assigned', actor_name: 'QA HR', occurred_at: '2026-11-19T10:00:00Z' }]
          : [],
      error: null,
    }))
    open('/people/performance?review=' + review, true)
    expect(await screen.findByText('Review assigned')).toBeInTheDocument()
  })

  it('allows HR to release a submitted review with a decision reason', async () => {
    permissions.push('performance.manage')
    let state = 'manager_submitted'
    rpc.mockImplementation((name) => {
      if (name === 'rpc_decide_performance_review') state = 'hr_approved'
      return Promise.resolve({
        data: name === 'rpc_list_performance_reviews' ? [row(state)] : [],
        error: null,
      })
    })
    open('/people/performance?review=' + review, true)
    fireEvent.change(await screen.findByLabelText('Decision reason'), { target: { value: 'Completed HR calibration' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }))
    expect(await screen.findByText('Released')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('rpc_decide_performance_review', {
      p_review_id: review, p_decision: 'approved', p_reason: 'Completed HR calibration',
    })
  })

  it('requires an assigned reviewer to save edits before submitting to HR', async () => {
    permissions.push('performance.review')
    let status = 'draft'
    let comment = 'Persisted reviewer comments'
    rpc.mockImplementation((name, args) => {
      if (name === 'rpc_save_performance_review') comment = typeof args?.p_manager_comments === 'string' ? args.p_manager_comments : ''
      if (name === 'rpc_submit_performance_review') status = 'manager_submitted'
      return Promise.resolve({
        data: name === 'rpc_list_my_assigned_performance_reviews'
          ? [{ ...row(status, actor), manager_comments: comment }]
          : name.startsWith('rpc_list_') ? [] : null,
        error: null,
      })
    })
    open('/my/performance?review=' + review)
    const submit = await screen.findByRole('button', { name: 'Submit to HR' })
    fireEvent.change(screen.getByLabelText('Manager assessment'), { target: { value: 'Updated manager assessment' } })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    expect(await screen.findByText('Awaiting HR')).toBeInTheDocument()
    expect(rpc).toHaveBeenCalledWith('rpc_submit_performance_review', { p_review_id: review })
  })
})
