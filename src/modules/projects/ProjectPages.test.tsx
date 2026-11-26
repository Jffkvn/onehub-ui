import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import type { UserRole } from '@/config/modules'
import { ProjectCreatePage, ProjectListPage, ProjectMissedUpdatesPage, ProjectWorkspacePage } from './ProjectPages'

const projectId = 'a7e00000-0000-4000-8000-000000000001'
const userId = 'a7e00000-0000-4000-8000-000000000002'
const project = {
  id: projectId, project_code: 'UG-101', name: 'Kampala CBD', status: 'active', health_status: 'on_track',
  client_name: 'QA Telecom', site_location: 'Kampala', planned_start_date: '2026-11-18', expected_end_date: '2027-01-15',
  actual_completion_date: null, contract_reference: null, budget_reference: 'B-210', operational_notes: 'Plan scope',
  estimated_budget_ugx: 1000, budget_notes: null,
}

const { from, rpc, select } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), select: vi.fn() }))
let permissions: string[]
let roles: UserRole[]
let scopeAssignments: string[]
let projectVisible: boolean

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    authEpoch: 1,
    session: { userId },
    access: { profile: { id: userId, displayName: 'QA Staff' }, roleKeys: roles, permissionKeys: permissions },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))
vi.mock('@/modules/projects/team/ProjectTeamPanel', () => ({ ProjectTeamPanel: () => <h2>Project team</h2> }))
vi.mock('@/modules/projects/tracker/DailyTrackerPanel', () => ({ DailyTrackerPanel: () => <h2>Daily updates</h2> }))
vi.mock('@/modules/projects/documents/ProjectDocumentsPanel', () => ({ ProjectDocumentsPanel: () => <h2>Project documents</h2> }))
vi.mock('@/modules/projects/team/teamApi', () => ({ listProjectTeamCandidates: () => Promise.resolve([]) }))

function mount(path: string) {
  render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ops/projects" element={<ProjectListPage />} />
        <Route path="/projects/new" element={<ProjectCreatePage />} />
        <Route path="/tracker/missed-updates" element={<ProjectMissedUpdatesPage />} />
        <Route path="/projects/:projectId/:projectTab" element={<ProjectWorkspacePage />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>)
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  permissions = ['projects.read', 'daily_updates.read']
  roles = ['project_manager']
  scopeAssignments = ['pm']
  projectVisible = true
  vi.clearAllMocks()
  resetProtectedSessionRegistryForTest()
  from.mockImplementation((table: string) => {
    const row = projectVisible ? project : null
    const response = table === 'project_assignments'
      ? { data: scopeAssignments.map((role_on_project) => ({ role_on_project })), error: null }
      : { data: row ? [row] : [], count: row ? 1 : 0, error: null }
    const responsePromise = Promise.resolve(response)
    const builder = {
      select: (columns: string) => { select(columns); return builder },
      eq: () => builder, is: () => builder, ilike: () => builder, order: () => builder, range: () => builder,
      abortSignal: () => builder, maybeSingle: () => Promise.resolve({ data: row, error: null }),
      then: responsePromise.then.bind(responsePromise),
    }
    return builder
  })
  rpc.mockImplementation((name: string) => Promise.resolve({
    status: 200, error: null,
    data: name === 'rpc_check_project_completion'
      ? { can_complete: false, warnings: [{ domain: 'inventory', message: '1 active equipment custody item.' }] }
      : name === 'rpc_create_project' ? projectId : [],
  }))
})

it('lists visible projects and links to the existing project workspace path', async () => {
  mount('/ops/projects')
  expect(await screen.findByRole('link', { name: 'Kampala CBD' })).toHaveAttribute('href', '/projects/' + projectId + '/summary')
})

it('does not mount a project panel when the project is outside the account scope', async () => {
  projectVisible = false
  mount('/projects/' + projectId + '/team')
  expect(await screen.findByRole('heading', { name: 'Project unavailable' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Project team' })).not.toBeInTheDocument()
})

it('allows a project manager to create a project with themselves as the primary PM', async () => {
  permissions.push('projects.create')
  mount('/projects/new')
  fill('Project code', 'UG-NEW')
  fill('Project name', 'Kampala CBD')
  fill('Planned start date', '2026-11-18')
  fill('Expected end date', '2026-11-17')
  fill('Reason for creation', 'New build')
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Expected end date cannot be before the planned start date.')
  expect(rpc).not.toHaveBeenCalled()

  fill('Expected end date', '2026-12-18')
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
  const expectedFields: unknown = expect.objectContaining({
    project_code: 'UG-NEW', name: 'Kampala CBD', expected_end_date: '2026-12-18',
  })
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_create_project', expect.objectContaining({
    p_primary_pm_id: userId, p_reason: 'New build', p_project: expectedFields,
  })))
})

it('keeps completion disabled while the backend reports a custody blocker', async () => {
  mount('/projects/' + projectId + '/summary')
  fireEvent.click(await screen.findByRole('button', { name: 'Change status' }))
  fill('New status', 'completed')
  fill('Reason for status change', 'Completed site handover')
  expect(await screen.findByText('1 active equipment custody item.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save status' })).toBeDisabled()
  expect(rpc).not.toHaveBeenCalledWith('rpc_transition_project_status', expect.anything())
})

it('shows directors read-only project controls', async () => {
  roles = ['managing_director']
  permissions = ['projects.read_all', 'daily_updates.read_all']
  scopeAssignments = []
  mount('/projects/' + projectId + '/summary')
  expect(await screen.findByRole('heading', { name: 'Kampala CBD' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Change status' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit project' })).not.toBeInTheDocument()
})

it('uses a limited project identity projection for operational warehouse access', async () => {
  roles = ['warehouse_manager']
  permissions = ['projects.read_operational', 'inventory.read']
  scopeAssignments = []
  mount('/projects/' + projectId + '/summary')
  expect(await screen.findByRole('heading', { name: 'Kampala CBD' })).toBeInTheDocument()
  expect(screen.queryByText('QA Telecom')).not.toBeInTheDocument()
  expect(select.mock.calls.flat()).not.toContainEqual(expect.stringContaining('estimated_budget_ugx'))
})

it('saves a patch containing only the fields the project manager edited', async () => {
  mount('/projects/' + projectId + '/summary')
  fireEvent.click(await screen.findByRole('button', { name: 'Edit project' }))
  fill('Site location', 'Kampala Central')
  fill('Reason for the change', 'Confirmed site details')
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByText('Project details saved.')
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_update_project', {
    p_project_id: projectId, p_reason: 'Confirmed site details', p_changes: { site_location: 'Kampala Central' },
  }))
})

it('keeps unsaved project edits when the user cancels and chooses to continue editing', async () => {
  mount('/projects/' + projectId + '/summary')
  fireEvent.click(await screen.findByRole('button', { name: 'Edit project' }))
  fill('Site location', 'Proposed site')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(await screen.findByText(/unsaved changes/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /keep editing/i }))
  expect(screen.getByLabelText('Site location')).toHaveValue('Proposed site')
})

it('checks missed updates by date for the director and opens the matching tracker', async () => {
  roles = ['managing_director']
  permissions = ['projects.read_all', 'daily_updates.read_all']
  rpc.mockResolvedValue({
    status: 200, error: null,
    data: [{ project_id: projectId, project_name: project.name, user_id: userId, user_full_name: 'QA Coordinator' }],
  })
  mount('/tracker/missed-updates')
  fill('Update date', '2026-11-19')
  fireEvent.click(screen.getByRole('button', { name: 'Check updates' }))
  expect(await screen.findByRole('link', { name: 'Kampala CBD' })).toHaveAttribute('href', '/projects/' + projectId + '/updates')
  expect(rpc).toHaveBeenCalledWith('rpc_check_missed_daily_updates', { p_date: '2026-11-19' })
})

it('does not run the cross-project missed update check for a coordinator', () => {
  roles = ['coordinator']
  mount('/tracker/missed-updates')
  expect(screen.getByRole('heading', { name: /Permission Denied/i })).toBeInTheDocument()
  expect(rpc).not.toHaveBeenCalled()
})

it('names the author and uses the action recorded in project history', async () => {
  rpc.mockImplementation((name: string) => Promise.resolve({
    error: null, status: 200,
    data: name === 'rpc_get_project_history' ? [{
      event_type: 'daily_updates.created', actor_name: 'Olivia Pope',
      occurred_at: '2026-07-17T12:31:00Z', reason: null,
    }] : [],
  }))
  mount('/projects/' + projectId + '/history')

  expect(await screen.findByText('Olivia Pope added a daily update')).toBeInTheDocument()
  expect(screen.queryByText('daily updates created')).not.toBeInTheDocument()
})
