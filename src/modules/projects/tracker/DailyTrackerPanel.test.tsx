import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { DailyTrackerPanel } from './DailyTrackerPanel'

const projectId = 'e9000000-0000-4000-8000-000000000001'
const viewerId = 'e9000000-0000-4000-8000-000000000002'
const teammateId = 'e9000000-0000-4000-8000-000000000003'
const firstUpdate = 'e9000000-0000-4000-8000-000000000004'
const secondUpdate = 'e9000000-0000-4000-8000-000000000005'
const savedPhoto = viewerId + '/daily-evidence/' + projectId + '/e9000000-0000-4000-8000-000000000006.jpg'
const department = { from: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() }
const { from, rpc, upload, remove, createSignedUrl } = department

let permissions: string[]
let assignment: 'pm' | 'coordinator' | null
type UpdateStatus = 'draft' | 'submitted' | 'revision_requested' | 'endorsed'

function buildUpdate(id: string, author: string, summary: string, status: UpdateStatus) {
  return {
    id, project_id: projectId, submitted_by: author, update_date: '2026-09-09', summary, photo_urls: [] as string[], status,
    pm_feedback: null as string | null,
    profiles_submitted_by: { display_name: author === viewerId ? 'Sam Author' : 'Alex Coordinator', role_name: 'Coordinator' },
    profiles_endorsed_by: null,
  }
}
let updates: ReturnType<typeof buildUpdate>[]

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated', authEpoch: 1, session: { userId: viewerId },
    access: { profile: { id: viewerId }, permissionKeys: permissions },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ from, rpc, storage: { from: () => ({ upload, remove, createSignedUrl }) } }),
}))

function mount(projectStatus = 'active') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><DailyTrackerPanel projectId={projectId} projectStatus={projectStatus} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetProtectedSessionRegistryForTest()
  permissions = ['projects.read', 'daily_updates.read', 'daily_updates.create']
  assignment = 'coordinator'
  updates = []
  rpc.mockReset()
  from.mockReset()
  upload.mockReset()
  remove.mockReset()
  createSignedUrl.mockReset()
  rpc.mockImplementation((name: string) => {
    if (name === 'rpc_list_daily_updates') return Promise.resolve({ data: updates, error: null, status: 200 })
    return Promise.resolve({ data: firstUpdate, error: null, status: 200 })
  })
  from.mockImplementation((table: string) => {
    const response = Promise.resolve({ data: table === 'project_assignments' && assignment ? [{ role_on_project: assignment }] : [], error: null })
    const builder = { select: () => builder, eq: () => builder, is: () => builder, order: () => builder, then: response.then.bind(response) }
    return builder
  })
  upload.mockResolvedValue({ data: { path: savedPhoto }, error: null })
  remove.mockResolvedValue({ data: null, error: null })
})

function jpeg(name = 'inspection.jpg', bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) {
  const photo = new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' })
  Object.defineProperty(photo, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) })
  return photo
}

it('attaches private evidence when submitting from an active assignment', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'New daily update' }))
  const form = within(screen.getByRole('dialog'))
  fireEvent.change(form.getByLabelText('Update date'), { target: { value: '2026-09-09' } })
  fireEvent.change(form.getByLabelText('Work summary'), { target: { value: ' Completed foundation inspection. ' } })
  fireEvent.change(form.getByLabelText(/Attach photos/), { target: { files: [jpeg()] } })
  fireEvent.click(form.getByRole('button', { name: 'Submit update' }))

  await screen.findByRole('status')
  expect(upload).toHaveBeenCalledWith(
    expect.stringMatching(new RegExp('^' + viewerId + '/daily-evidence/' + projectId + '/[a-f0-9-]+[.]jpg$')),
    expect.any(File),
    { upsert: false, contentType: 'image/jpeg' },
  )
  expect(rpc).toHaveBeenCalledWith('rpc_save_daily_update', {
    p_update_id: null, p_project_id: projectId, p_update_date: '2026-09-09',
    p_summary: 'Completed foundation inspection.', p_photo_urls: [upload.mock.calls[0][0]], p_submit: true,
  })
})

it('rejects a photo with an invalid signature before any storage or update write', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'New daily update' }))
  const form = within(screen.getByRole('dialog'))
  fireEvent.change(form.getByLabelText('Work summary'), { target: { value: 'Day report' } })
  fireEvent.change(form.getByLabelText(/Attach photos/), { target: { files: [jpeg('renamed.jpg', new Uint8Array([1, 2, 3]))] } })
  fireEvent.click(form.getByRole('button', { name: 'Submit update' }))
  expect(await form.findByRole('alert')).toHaveTextContent('valid JPG')
  expect(upload).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalledWith('rpc_save_daily_update', expect.anything())
})

it('lets an assigned PM request revision with feedback on a different user’s submission', async () => {
  permissions.push('daily_updates.endorse')
  assignment = 'pm'
  updates = [
    buildUpdate(firstUpdate, teammateId, 'Teammate progress', 'submitted'),
    buildUpdate(secondUpdate, viewerId, 'My progress', 'submitted'),
  ]
  mount()
  expect(await screen.findByText('My progress')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Endorse' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Request revision' }))
  const form = within(screen.getByRole('dialog'))
  const confirm = form.getByRole('button', { name: 'Request revision' })
  expect(confirm).toBeDisabled()
  fireEvent.change(form.getByLabelText('Feedback'), { target: { value: 'Include the tower location.' } })
  fireEvent.click(confirm)
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_review_daily_update', {
    p_update_id: firstUpdate, p_decision: 'request_revision', p_feedback: 'Include the tower location.',
  }))
})

it('resubmits a requested revision with its saved evidence and original record ID', async () => {
  const draft = buildUpdate(firstUpdate, viewerId, 'Missing tower location', 'revision_requested')
  draft.pm_feedback = 'Include the tower location.'
  draft.photo_urls = [savedPhoto]
  updates = [draft]
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit update' }))
  const form = within(screen.getByRole('dialog'))
  fireEvent.change(form.getByLabelText('Work summary'), { target: { value: 'Tower E7, northern site.' } })
  fireEvent.click(form.getByRole('button', { name: 'Resubmit update' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rpc_save_daily_update', {
    p_update_id: firstUpdate, p_project_id: projectId, p_update_date: '2026-09-09',
    p_summary: 'Tower E7, northern site.', p_photo_urls: [savedPhoto], p_submit: true,
  }))
  expect(upload).not.toHaveBeenCalled()
})

it('shows read-only project activity to a director without write grants', async () => {
  permissions = ['projects.read_all', 'daily_updates.read_all']
  assignment = null
  updates = [buildUpdate(firstUpdate, teammateId, 'Submitted field report', 'submitted')]
  mount()
  expect(await screen.findByText('Submitted field report')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New daily update' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Request revision' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument()
  expect(from).not.toHaveBeenCalledWith('project_assignments')
})

it('keeps uploaded photos available when the server may already have recorded the update', async () => {
  rpc.mockImplementation((name: string) => Promise.resolve(name === 'rpc_list_daily_updates'
    ? { data: updates, error: null, status: 200 }
    : { data: null, error: {}, status: 503 }))
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'New daily update' }))
  const form = within(screen.getByRole('dialog'))
  fireEvent.change(form.getByLabelText('Work summary'), { target: { value: 'Submitted during a connection drop.' } })
  fireEvent.change(form.getByLabelText(/Attach photos/), { target: { files: [jpeg()] } })
  fireEvent.click(form.getByRole('button', { name: 'Submit update' }))
  expect(await form.findByRole('alert')).toHaveTextContent('could not confirm')
  expect(form.getByRole('button', { name: 'Submit update' })).toBeDisabled()
  expect(remove).not.toHaveBeenCalled()
})
