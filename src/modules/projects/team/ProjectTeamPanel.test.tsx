import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { ProjectTeamPanel } from './ProjectTeamPanel'

const projectId = '12100000-0000-4000-8000-000000000001'
const primaryPm = '12100000-0000-4000-8000-000000000002'
const nextPm = '12100000-0000-4000-8000-000000000003'
const coordinator = '12100000-0000-4000-8000-000000000004'
const nextCoordinator = '12100000-0000-4000-8000-000000000005'
const pmAssignment = '12100000-0000-4000-8000-000000000006'
const coordinatorAssignment = '12100000-0000-4000-8000-000000000007'
const formerCoordinatorAssignment = '12100000-0000-4000-8000-000000000008'
const cfo = '12100000-0000-4000-8000-000000000009'
const director = '12100000-0000-4000-8000-000000000010'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

let session: { id: string; permissions: string[] }
let unknownWrite: boolean

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    authEpoch: 7,
    session: { userId: session.id },
    access: { profile: { id: session.id }, permissionKeys: session.permissions },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

const assigned = [
  {
    id: pmAssignment, project_id: projectId, user_id: primaryPm, role_on_project: 'pm', assigned_by: cfo,
    display_name: 'Pat Project Manager', assigned_at: '2026-11-01T09:00:00+00:00',
    assignment_reason: 'Appointed for construction', unassigned_at: null, unassigned_by: null, unassignment_reason: null,
  },
  {
    id: coordinatorAssignment, project_id: projectId, user_id: coordinator, role_on_project: 'coordinator', assigned_by: cfo,
    display_name: 'Charlie Coordinator', assigned_at: '2026-11-02T09:00:00+00:00',
    assignment_reason: 'Cover the day shift', unassigned_at: null, unassigned_by: null, unassignment_reason: null,
  },
]
const history = [
  ...assigned,
  {
    ...assigned[1], id: formerCoordinatorAssignment, display_name: 'Former Coordinator',
    unassigned_at: '2026-11-05T10:00:00+00:00', unassigned_by: cfo, unassignment_reason: 'Shift rotation',
  },
]

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectTeamPanel projectId={projectId} projectStatus="active" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  session = { id: cfo, permissions: ['projects.read_all', 'projects.assign_all', 'projects.create'] }
  unknownWrite = false
  rpc.mockReset()
  rpc.mockImplementation((name: string, args?: { p_include_history?: boolean }) => {
    let data: unknown = null
    if (name === 'rpc_list_project_assignments') data = args?.p_include_history ? history : assigned
    if (name === 'rpc_list_project_assignment_candidates') data = [
      { profile_id: nextPm, display_name: 'Morgan PM', role_keys: ['project_manager'] },
      { profile_id: nextCoordinator, display_name: 'Casey Coordinator', role_keys: ['coordinator'] },
    ]
    if (name === 'rpc_assign_project_member') data = pmAssignment
    const result = Promise.resolve(
      name === 'rpc_assign_project_member' && unknownWrite
        ? { data: null, error: { code: '' }, status: 503 }
        : { data, error: null, status: 200 },
    )
    return { abortSignal: () => result, then: result.then.bind(result) }
  })
})

it('shows the primary PM, active coordinators, and ended assignment history', async () => {
  session = { id: director, permissions: ['projects.read_all'] }
  mount()

  expect(await screen.findByText('Pat Project Manager')).toBeInTheDocument()
  expect(screen.getByText('Charlie Coordinator')).toBeInTheDocument()
  expect(await screen.findByText('Former Coordinator')).toBeInTheDocument()
  expect(screen.getByText('Shift rotation')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Replace primary PM' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add coordinator' })).not.toBeInTheDocument()
  expect(rpc).not.toHaveBeenCalledWith('rpc_list_project_assignment_candidates', expect.anything())
})

it('requires a reason and calls the guarded replacement for an authorised user', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Replace primary PM' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Team member'), { target: { value: nextPm } })

  const confirm = dialog.getByRole('button', { name: 'Replace primary PM' })
  expect(confirm).toBeDisabled()
  expect(dialog.queryByRole('option', { name: 'Casey Coordinator' })).not.toBeInTheDocument()

  fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: '  Taking over the build  ' } })
  fireEvent.click(confirm)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_assign_project_member', {
    p_project_id: projectId, p_user_id: nextPm, p_project_role: 'pm', p_reason: 'Taking over the build',
  }))
  expect(await screen.findByRole('status')).toHaveTextContent('Primary project manager saved.')
})

it('allows the active PM to manage coordinators without offering primary PM changes', async () => {
  session = { id: primaryPm, permissions: ['projects.read', 'projects.create'] }
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Add coordinator' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Team member'), { target: { value: nextCoordinator } })

  expect(screen.queryByRole('button', { name: 'Replace primary PM' })).not.toBeInTheDocument()
  expect(dialog.queryByRole('option', { name: 'Morgan PM' })).not.toBeInTheDocument()

  fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: 'Cover weekend work' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Add coordinator' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_assign_project_member', {
    p_project_id: projectId, p_user_id: nextCoordinator, p_project_role: 'coordinator', p_reason: 'Cover weekend work',
  }))
  expect(await screen.findByRole('status')).toHaveTextContent('Coordinator assigned.')
})

it('ends only the selected coordinator assignment with a reason', async () => {
  session = { id: primaryPm, permissions: ['projects.read', 'projects.create'] }
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Charlie Coordinator' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: 'Reassigned to a nearby site' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Remove coordinator' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_unassign_project_member', {
    p_assignment_id: coordinatorAssignment, p_reason: 'Reassigned to a nearby site',
  }))
  expect(await screen.findByRole('status')).toHaveTextContent('Coordinator removed.')
})

it('does not expose write actions or candidate data to a coordinator or an unassigned PM', async () => {
  session = { id: coordinator, permissions: ['projects.read'] }
  const first = mount()
  expect(await screen.findByText('Charlie Coordinator')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove Charlie Coordinator' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add coordinator' })).not.toBeInTheDocument()
  first.unmount()

  session = { id: nextPm, permissions: ['projects.read', 'projects.create'] }
  mount()
  expect(await screen.findByText('Pat Project Manager')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add coordinator' })).not.toBeInTheDocument()
  expect(rpc.mock.calls.some(([name]) => name === 'rpc_list_project_assignment_candidates')).toBe(false)
})

it('refreshes current assignments and blocks a second save when the first result is uncertain', async () => {
  unknownWrite = true
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Replace primary PM' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Team member'), { target: { value: nextPm } })
  fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: 'Taking over the build' } })
  const confirm = dialog.getByRole('button', { name: 'Replace primary PM' })
  fireEvent.click(confirm)

  expect(await dialog.findByRole('alert')).toHaveTextContent('Check the current team before submitting again.')
  expect(confirm).toBeDisabled()
  expect(rpc.mock.calls.filter(([name, args]) =>
    name === 'rpc_list_project_assignments' && (args as { p_include_history?: boolean }).p_include_history === false,
  )).toHaveLength(2)
  expect(rpc.mock.calls.filter(([name]) => name === 'rpc_assign_project_member')).toHaveLength(1)
})
