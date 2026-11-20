import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetProtectedSessionRegistryForTest } from '@/lib/idempotency/pendingOperations'
import { ProjectDocumentsPanel } from './ProjectDocumentsPanel'

const { from, rpc, storageFrom, upload, exists, createSignedUrl, maybeSingle } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), storageFrom: vi.fn(), upload: vi.fn(), exists: vi.fn(),
  createSignedUrl: vi.fn(), maybeSingle: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({ from, rpc, storage: { from: storageFrom } }),
}))

const actorId = '91000000-0000-4000-8000-000000000001'
const projectId = '91000000-0000-4000-8000-000000000010'
const documentId = '91000000-0000-4000-8000-000000000020'
const storagePath = `${actorId}/projects/${projectId}/${documentId}.pdf`
const storedDocument = {
  id: documentId, project_id: projectId, display_name: 'Site plan.pdf', storage_path: storagePath,
  created_at: '2026-11-15T12:00:00Z',
}
let sessionId = actorId
let listedDocuments: unknown[]
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', session: { userId: sessionId }, authEpoch: 1 }),
}))

function mount(canUpload = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const panel = (allowed = canUpload) => (
    <QueryClientProvider client={client}>
      <ProjectDocumentsPanel projectId={projectId} canUpload={allowed} />
    </QueryClientProvider>
  )
  const view = render(panel())
  return { ...view, panel }
}

function choosePdf(contents = '%PDF-1.7') {
  const bytes = new TextEncoder().encode(contents)
  const file = new File([bytes], 'Site plan.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) })
  fireEvent.change(screen.getByLabelText('Choose project document'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Upload document' }))
}

describe('Project documents', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.restoreAllMocks()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    resetProtectedSessionRegistryForTest()
    sessionId = actorId
    listedDocuments = []
    from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      order: () => Promise.resolve({ data: listedDocuments, error: null }),
      maybeSingle,
    }))
    storageFrom.mockReturnValue({ upload, exists, createSignedUrl })
    upload.mockResolvedValue({ data: { path: storagePath }, error: null })
    exists.mockResolvedValue({ data: false, error: null })
    maybeSingle.mockResolvedValue({ data: null, error: null })
    rpc.mockResolvedValue({ data: documentId, error: null })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(documentId)
  })

  it('lists records for readers and signs only the selected project document when opened', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    listedDocuments = [storedDocument]
    const signedUrl = 'https://example.supabase.co/storage/v1/object/sign/private-files/file.pdf?token=test'
    createSignedUrl.mockResolvedValue({ data: { signedUrl }, error: null })
    mount(false)

    expect(await screen.findByText('Site plan.pdf')).toBeInTheDocument()
    expect(screen.queryByLabelText('Choose project document')).toBeNull()
    expect(createSignedUrl).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open Site plan.pdf' }))

    await waitFor(() => expect(open).toHaveBeenCalledWith(signedUrl, '_blank', 'noopener,noreferrer'))
    expect(storageFrom).toHaveBeenCalledWith('private-files')
    expect(createSignedUrl).toHaveBeenCalledWith(storagePath, 60)
  })

  it('blocks signed URLs from a different origin', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    listedDocuments = [storedDocument]
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://example.com/other.pdf' }, error: null })
    mount(false)

    fireEvent.click(await screen.findByRole('button', { name: 'Open Site plan.pdf' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The private document could not be opened.')
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects bytes that do not match the selected extension and MIME type', async () => {
    mount()
    choosePdf('<script>not a PDF</script>')
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid PDF, JPG, PNG or WebP file up to 10 MB.')
    expect(upload).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reconciles a lost registration response against the matching document record', async () => {
    rpc.mockImplementationOnce(() => {
      listedDocuments = [storedDocument]
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    maybeSingle.mockResolvedValue({ data: storedDocument, error: null })
    mount()
    choosePdf()

    expect(await screen.findByText('Document uploaded.')).toBeInTheDocument()
    expect(await screen.findByText('Site plan.pdf')).toBeInTheDocument()
    expect(upload).toHaveBeenCalledWith(storagePath, expect.any(File), { upsert: false, contentType: 'application/pdf' })
    expect(rpc).toHaveBeenCalledWith('rpc_register_project_document', {
      p_project_id: projectId,
      p_document_id: documentId,
      p_display_name: 'Site plan.pdf',
      p_storage_path: storagePath,
      p_mime_type: 'application/pdf',
      p_size_bytes: 8,
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retries registration without uploading the same document again', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } })
    mount()
    choosePdf()

    expect(await screen.findByRole('alert')).toHaveTextContent('The document record could not be confirmed.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving document' }))
    expect(await screen.findByText('Document uploaded.')).toBeInTheDocument()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0])
  })

  it('stops registration if the account changes while uploading', async () => {
    let finishUpload: () => void = () => { throw new Error('The upload did not start.') }
    upload.mockImplementationOnce(() => new Promise((resolve) => {
      finishUpload = () => resolve({ data: { path: storagePath }, error: null })
    }))
    const view = mount()
    choosePdf()
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))

    sessionId = '91000000-0000-4000-8000-000000000002'
    view.rerender(view.panel(false))
    await act(async () => { finishUpload(); await Promise.resolve() })

    expect(rpc).not.toHaveBeenCalled()
    expect(screen.queryByText('Document uploaded.')).toBeNull()
  })

  it('continues registration if the original private object exists after an uncertain upload', async () => {
    upload.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    exists.mockResolvedValueOnce({ data: true, error: null })
    mount()
    choosePdf()

    expect(await screen.findByText('Document uploaded.')).toBeInTheDocument()
    expect(exists).toHaveBeenCalledWith(storagePath)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
