import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Input } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Wrappers'
import { isAbortError, useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth, useHasPermission } from '@/modules/auth/AuthProvider'
import {
  createEmployeePhotoChange,
  EmployeePhotoSaveError,
  loadEmployeePhoto,
  prepareEmployeePhoto,
  saveEmployeePhoto,
  type EmployeePhotoChange,
} from '../api/employeePhoto'

interface PhotoProps {
  employeeId: string
  employeeName: string
  canEdit: boolean
}

export function EmployeeDossierPhoto(props: PhotoProps) {
  const scope = useProtectedIdentityScope(useAuth())
  const canRead = useHasPermission('employees.read')
  if (!scope.isAuthReady || !scope.identityKey || !canRead) {
    return <Avatar name={props.employeeName} size="lg" />
  }
  return (
    <DossierPortrait key={`${scope.identityKey}:${scope.authEpoch}:${props.employeeId}:${props.canEdit}`}
      {...props} scope={scope} />
  )
}

function DossierPortrait({ employeeId, employeeName, canEdit, scope }: PhotoProps & { scope: IdentityScopeRef }) {
  const [editor, setEditor] = useState(false)
  const [notice, setNotice] = useState('')
  const photo = useQuery({
    queryKey: ['employee-dossier-photo', scope.identityKey, scope.authEpoch, employeeId],
    queryFn: () => loadEmployeePhoto(scope, employeeId),
    refetchInterval: 45_000,
    gcTime: 0,
    retry: false,
  })

  return (
    <div className="flex shrink-0 flex-col items-start gap-1.5">
      <Avatar src={photo.isSuccess ? photo.data.url ?? undefined : undefined} name={employeeName} size="lg" />
      {canEdit && (
        <Button type="button" size="sm" variant="outline" onClick={() => { setNotice(''); setEditor(true) }}>
          Edit photo
        </Button>
      )}
      {notice && <span className="max-w-40 text-xs text-muted" role="status">{notice}</span>}
      {editor && (
        <PhotoEditor employeeId={employeeId} employeeName={employeeName} scope={scope}
          current={photo.isSuccess ? photo.data : undefined} failed={photo.isError}
          reload={() => { void photo.refetch() }} onClose={() => setEditor(false)}
          onSaved={(cleanupFailed, hasPhoto) => {
            setNotice(cleanupFailed
              ? 'Photo updated. Previous file cleanup could not be confirmed.'
              : hasPhoto ? 'Profile photo saved.' : 'Profile photo removed.')
            setEditor(false)
            void photo.refetch()
          }}
        />
      )}
    </div>
  )
}

interface EditorProps extends Pick<PhotoProps, 'employeeId' | 'employeeName'> {
  scope: IdentityScopeRef
  current: Awaited<ReturnType<typeof loadEmployeePhoto>> | undefined
  failed: boolean
  reload: () => void
  onClose: () => void
  onSaved: (cleanupFailed: boolean, hasPhoto: boolean) => void
}

function PhotoEditor({ employeeId, employeeName, scope, current, failed, reload, onClose, onSaved }: EditorProps) {
  const fileId = useId()
  const alive = useRef(false)
  const saving = useRef(false)
  const [draft, setDraft] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string>()
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [retryChange, setRetryChange] = useState<EmployeePhotoChange | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!draft) {
      setPreview(undefined)
      return
    }
    const url = URL.createObjectURL(draft)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [draft])

  const save = useMutation({
    mutationFn: (change: EmployeePhotoChange) => saveEmployeePhoto(scope, employeeId, change),
    onSuccess: ({ cleanupFailed }, change) => {
      if (alive.current) onSaved(cleanupFailed, change.path !== null)
    },
    onSettled: () => { saving.current = false },
    onError: (issue, change) => {
      if (!alive.current || isAbortError(issue)) return
      if (issue instanceof EmployeePhotoSaveError) {
        setError(issue.message)
        setRetryChange(issue.retryable ? change : null)
        if (!issue.retryable) reload()
      } else {
        setRetryChange(change)
        setError('The change could not be confirmed. Retry the same change.')
      }
    },
  })

  async function choose(file: File | undefined) {
    if (!file) return
    setPreparing(true)
    setDraft(null)
    setError('')
    setConfirmRemove(false)
    try {
      const image = await prepareEmployeePhoto(file)
      if (alive.current) setDraft(image)
    } catch (issue) {
      if (alive.current) setError(issue instanceof Error ? issue.message : 'The image could not be prepared.')
    } finally {
      if (alive.current) setPreparing(false)
    }
  }

  function submit(remove = false) {
    if (saving.current || !current || (!remove && !draft && !retryChange)) return
    setError('')
    try {
      const change = retryChange ?? createEmployeePhotoChange(scope, employeeId, current, remove ? null : draft)
      saving.current = true
      save.mutate(change)
    } catch (issue) {
      if (!isAbortError(issue)) setError('The photo change could not be prepared.')
    }
  }

  const busy = save.isPending || preparing
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}
      title="Profile photo" description={employeeName}
      footer={<>
        {current?.path && !draft && !retryChange && (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => {
            if (confirmRemove) submit(true)
            else setConfirmRemove(true)
          }}>
            {confirmRemove ? 'Confirm removal' : 'Remove photo'}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={onClose}>Cancel</Button>
        <Button type="button" size="sm" disabled={busy || !current || (!draft && !retryChange)}
          onClick={() => submit()}>
          {save.isPending ? 'Saving…' : retryChange ? 'Retry change' : 'Save photo'}
        </Button>
      </>}>
      <div className="space-y-3">
        {(preview || current?.url) && (
          <img src={preview ?? current?.url ?? undefined} alt="Profile photo preview" referrerPolicy="no-referrer"
            className="mx-auto size-32 rounded-full object-cover ring-1 ring-line" />
        )}
        {current?.path && !current.url && !preview && <p className="text-muted">The current photo preview is unavailable.</p>}
        <FormGroup label="Choose a picture" htmlFor={fileId}
          hint="JPEG, PNG or WebP up to 10 MB. The image is cropped to a square.">
          <Input id={fileId} type="file" accept="image/jpeg,image/png,image/webp"
            disabled={busy || !!retryChange || !current} onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void choose(file)
            }} />
        </FormGroup>
        {preparing && <p role="status" className="text-muted">Preparing photo…</p>}
        {!failed && !current && <p role="status" className="text-muted">Loading current photo…</p>}
        {failed && <div className="flex flex-wrap items-center gap-2">
          <FieldError>The current photo could not be loaded.</FieldError>
          <Button type="button" size="sm" variant="outline" onClick={reload}>Reload photo</Button>
        </div>}
        {confirmRemove && !retryChange && <p role="status" className="text-muted">Remove this photo from the employee dossier?</p>}
        <FieldError error={error} />
      </div>
    </Dialog>
  )
}
