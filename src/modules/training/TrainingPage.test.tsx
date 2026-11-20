import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import TrainingPage from './TrainingPage'

const actor = '95000000-0000-4000-8000-000000000003'
const employee = '96000000-0000-4000-8000-000000000001'
const teammate = '96000000-0000-4000-8000-000000000002'
const recordId = '96000000-0000-4000-8000-000000000010'
const foreignId = '96000000-0000-4000-8000-000000000011'
const documentId = '96000000-0000-4000-8000-000000000012'
const certificatePath = [actor, 'training-certificates', recordId, documentId + '.pdf'].join('/')
const signedUrl = 'https://onehub.test/storage/v1/object/sign/private-files/example.pdf?token=test'
const rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>()
const createSignedUrl = vi.fn()
const upload = vi.fn()
const remove = vi.fn()

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', session: { userId: actor }, authEpoch: 1 }),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc,
    from: () => ({
      select: () => ({ is: () => ({ order: () => Promise.resolve({
        data: [
          { id: employee, legal_name: 'Engineer A', employee_number: 'EMP-A' },
          { id: teammate, legal_name: 'Engineer B', employee_number: 'EMP-B' },
        ],
        error: null,
      }) }) }),
    }),
    storage: { from: () => ({ createSignedUrl, upload, remove }) },
  }),
}))

const record = {
  id: recordId,
  employee_id: employee,
  employee_number: 'EMP-A',
  employee_name: 'Engineer A',
  topic: 'First Aid',
  provider: 'Red Cross',
  completion_date: '2026-11-19',
  duration_hours: 8,
  cost_ugx: 150000,
  status: 'passed',
  expiry_date: '2027-11-19',
  certificate_reference: 'CERT-A',
  certificate_count: 1,
  created_at: '2026-11-19T17:24:00Z',
}

function openPage(path: string, manage = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><TrainingPage manage={manage} /></MemoryRouter>
  </QueryClientProvider>)
}

describe('Training workspace', () => {
  beforeEach(() => {
    resetProtectedSessionRegistryForTest()
    rpc.mockReset()
    createSignedUrl.mockReset()
    upload.mockReset()
    remove.mockReset()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://onehub.test')
  })

  it('submits a training form once for its selected employees (DEF-03)', async () => {
    rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'rpc_log_training_records' ? [recordId, foreignId] : [record],
      error: null,
    }))
    openPage('/people/training', true)
    fireEvent.click(await screen.findByRole('button', { name: 'Log training' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Engineer A/u }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Engineer B/u }))
    fireEvent.change(screen.getByLabelText('Topic or course'), { target: { value: 'First Aid' } })
    fireEvent.change(screen.getByLabelText('Training date'), { target: { value: '2026-11-19' } })
    const save = screen.getByRole('button', { name: 'Save training' })
    expect(save).toHaveAttribute('type', 'submit')
    fireEvent.click(save)

    expect(await screen.findByText('Training logged for 2 employees.')).toBeInTheDocument()
    const calls = rpc.mock.calls.filter(([name]) => name === 'rpc_log_training_records')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({
      p_employee_ids: [employee, teammate],
      p_topic: 'First Aid',
      p_completion_date: '2026-11-19',
      p_status: 'passed',
    })
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('rpc_refresh_training_expiry_alerts')
  })

  it('keeps a foreign deep link out of the document RPC', async () => {
    rpc.mockResolvedValue({ data: [record], error: null })
    openPage('/my/training?training=' + foreignId)
    expect(await screen.findByText('This training record is unavailable.')).toBeInTheDocument()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['rpc_list_my_training_records'])
  })

  it('signs an owned certificate on request and omits certificate administration', async () => {
    rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'rpc_list_training_documents'
        ? [{ id: documentId, storage_path: certificatePath, original_file_name: 'first-aid.pdf', size_bytes: 100 }]
        : [record],
      error: null,
    }))
    createSignedUrl.mockResolvedValue({ data: { signedUrl }, error: null })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      openPage('/my/training?training=' + recordId)
      const button = await screen.findByRole('button', { name: 'Open first-aid.pdf' })
      expect(createSignedUrl).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /remove/u })).not.toBeInTheDocument()
      fireEvent.click(button)
      await waitFor(() => expect(open).toHaveBeenCalledWith(signedUrl, '_blank', 'noopener,noreferrer'))
      expect(createSignedUrl).toHaveBeenCalledWith(certificatePath, 60)
      expect(rpc).toHaveBeenCalledWith('rpc_list_training_documents', { p_training_record_id: recordId })
    } finally {
      open.mockRestore()
    }
  })

  it('lets HR cancel an attachment retry and keeps the uploaded object intact', async () => {
    rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'rpc_list_training_documents' ? [] : name === 'rpc_attach_training_document' ? null : [record],
      error: name === 'rpc_attach_training_document' ? { message: 'A training record can contain up to 10 certificate files.' } : null,
    }))
    upload.mockResolvedValue({ data: {}, error: null })
    openPage('/people/training?training=' + recordId, true)
    const bytes = new TextEncoder().encode('%PDF-1.4')
    const file = new File([bytes], 'first-aid.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) })
    const input = await screen.findByLabelText('Certificate file')
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach certificate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel retry' }))
    expect(input).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Attach certificate' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Retry attachment' })).not.toBeInTheDocument()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
  })

  it('retains the private upload when the attachment confirmation is uncertain', async () => {
    let retrySucceeded = false
    rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'rpc_list_training_documents'
        ? []
        : name === 'rpc_attach_training_document'
          ? retrySucceeded ? documentId : null
          : [record],
      error: null,
    }))
    upload.mockResolvedValue({ data: {}, error: null })
    openPage('/people/training?training=' + recordId, true)
    const bytes = new TextEncoder().encode('%PDF-1.4')
    const file = new File([bytes], 'first-aid.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) })
    fireEvent.change(await screen.findByLabelText('Certificate file'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach certificate' }))
    expect(await screen.findByText(/attachment could not be confirmed/u)).toBeInTheDocument()
    retrySucceeded = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry attachment' }))
    expect(await screen.findByText('Certificate attached.')).toBeInTheDocument()
    const attachments = rpc.mock.calls.filter(([name]) => name === 'rpc_attach_training_document')
    expect(attachments).toHaveLength(2)
    expect(attachments[1]).toEqual(attachments[0])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
  })
})
