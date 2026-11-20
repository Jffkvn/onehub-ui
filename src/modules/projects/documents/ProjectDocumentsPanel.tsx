import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Upload } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { FieldError, FormGroup, Input } from '@/components/ui/Input'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { formatDateTimeInZone } from '@/modules/attendance/lib/zonedTime'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  listProjectDocuments,
  prepareProjectDocument,
  projectDocumentAccept,
  projectDocumentDownloadUrl,
  type ProjectDocument,
  type ProjectDocumentDraft,
  registerProjectDocument,
  storeProjectDocument,
} from './projectDocumentsApi'

interface ProjectDocumentsProps {
  projectId: string
  canUpload: boolean
}

function DocumentsContent({ scope, projectId, canUpload }: ProjectDocumentsProps & { scope: IdentityScopeRef }) {
  const queryClient = useQueryClient()
  const documents = useQuery({
    queryKey: ['projects', 'documents', scope.identityKey, scope.authEpoch, projectId],
    queryFn: () => listProjectDocuments(scope, projectId),
  })
  const fileInput = useRef<HTMLInputElement>(null)
  const active = useRef(false)
  const uploadLock = useRef(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [pending, setPending] = useState<{ draft: ProjectDocumentDraft; stored: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [uploaded, setUploaded] = useState(false)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canUpload || !selectedFile || uploadLock.current) return
    uploadLock.current = true
    setSaving(true)
    setUploaded(false)
    setError('')
    try {
      const operation = pending ?? { draft: await prepareProjectDocument(scope, projectId, selectedFile), stored: false }
      setPending(operation)
      if (!operation.stored) {
        await storeProjectDocument(scope, operation.draft, selectedFile)
        setPending({ ...operation, stored: true })
      }
      await registerProjectDocument(scope, operation.draft)
      setPending(null)
      setSelectedFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setUploaded(true)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    } catch (cause) {
      if (!isAbortError(cause)) setError(cause instanceof Error ? cause.message : 'The document could not be saved.')
    } finally {
      uploadLock.current = false
      setSaving(false)
    }
  }

  async function openDocument(item: ProjectDocument) {
    setError('')
    setOpeningId(item.id)
    try {
      const url = await projectDocumentDownloadUrl(scope, projectId, item)
      if (active.current) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (cause) {
      if (!isAbortError(cause)) setError('The private document could not be opened.')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <section className="space-y-4" aria-label="Project documents">
      {canUpload && (
        <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
          <FormGroup className="min-w-0 flex-1 basis-64" label="Choose project document" htmlFor="project-document-file" hint="PDF, JPG, PNG or WebP up to 10 MB.">
            <Input id="project-document-file" ref={fileInput} type="file" accept={projectDocumentAccept} disabled={saving || Boolean(pending)}
              onChange={(event) => {
                setSelectedFile(event.currentTarget.files?.[0] ?? null)
                setUploaded(false)
                setError('')
              }} />
          </FormGroup>
          <Button type="submit" variant="secondary" disabled={!selectedFile} loading={saving} leftIcon={<Upload size={16} aria-hidden="true" />}>
            {pending && !saving ? 'Retry saving document' : 'Upload document'}
          </Button>
        </form>
      )}
      <FieldError error={error} />
      {uploaded && <p className="text-sm text-emerald-600" role="status">Document uploaded.</p>}
      {documents.isPending && <p className="text-sm text-muted" role="status">Loading documents…</p>}
      {documents.isError && (
        <div className="flex flex-wrap items-center gap-3">
          <FieldError>Project documents could not be loaded.</FieldError>
          <Button variant="outline" size="sm" type="button" onClick={() => void documents.refetch()}>Try again</Button>
        </div>
      )}
      {documents.isSuccess && documents.data.length === 0 && (
        <EmptyState className="rounded-lg border border-line bg-surface" title="No project documents yet"
          description="Contracts, site evidence, and completion records appear here when uploaded." />
      )}
      {Boolean(documents.data?.length) && (
        <ul className="space-y-2">
          {documents.data?.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
              <FileText size={18} aria-hidden="true" className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1 basis-44">
                <p className="break-words text-sm font-semibold text-ink">{item.display_name}</p>
                <p className="text-xs text-muted">{formatDateTimeInZone(item.created_at, 'Africa/Kampala')}</p>
              </div>
              <Button type="button" variant="outline" size="sm" aria-label={`Open ${item.display_name}`} loading={openingId === item.id}
                disabled={openingId !== null} onClick={() => void openDocument(item)} leftIcon={<Download size={14} aria-hidden="true" />}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ProjectDocumentsPanel({ projectId, canUpload }: ProjectDocumentsProps) {
  const scope = useProtectedIdentityScope(useAuth())
  if (!scope.isAuthReady || !scope.identityKey) return null
  return <DocumentsContent key={JSON.stringify([scope.identityKey, scope.authEpoch, projectId])}
    scope={scope} projectId={projectId.toLowerCase()} canUpload={canUpload} />
}
