import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { BriefcaseBusiness, Contact as ContactIcon, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { FieldError, FormGroup, Input, Textarea } from '@/components/ui/Input'
import { useProtectedIdentityScope, type IdentityScopeRef } from '@/lib/idempotency/pendingOperations'
import { useAuth } from '@/modules/auth/AuthProvider'
import {
  DossierVersionConflict,
  getDossierSection,
  saveDossierSection,
  type DossierPosition,
  type DossierRecord,
  type DossierSection,
  type DossierSectionSnapshot,
  type DossierWriteRecord,
} from '../api/dossierHistory'

interface DossierField {
  name: string
  label: string
  type?: 'tel' | 'month' | 'textarea'
  maxLength?: number
  required?: boolean
}

interface SectionDetails {
  title: string
  editTitle: string
  saveTitle: string
  emptyText: string
  errorText: string
  icon: LucideIcon
  slots: readonly [string, string]
  fields: readonly DossierField[]
}

const slots = [1, 2] as const
const sections: Record<DossierSection, SectionDetails> = {
  emergency_contacts: {
    title: 'Emergency Contacts',
    editTitle: 'Edit emergency contacts',
    saveTitle: 'Save contacts',
    emptyText: 'No emergency contacts on file.',
    errorText: 'Emergency contacts could not load.',
    icon: ContactIcon,
    slots: ['Primary contact', 'Secondary contact'],
    fields: [
      { name: 'full_name', label: 'Full name', maxLength: 160, required: true },
      { name: 'relationship', label: 'Relationship', maxLength: 80, required: true },
      { name: 'phone', label: 'Phone', type: 'tel', maxLength: 32, required: true },
      { name: 'alt_phone', label: 'Alternate phone', type: 'tel', maxLength: 32 },
    ],
  },
  previous_employment: {
    title: 'Previous Employment',
    editTitle: 'Edit previous employment',
    saveTitle: 'Save previous employment',
    emptyText: 'No previous employment on file.',
    errorText: 'Previous employment could not load.',
    icon: BriefcaseBusiness,
    slots: ['Most recent previous employer', 'Earlier employer'],
    fields: [
      { name: 'employer', label: 'Employer', maxLength: 160, required: true },
      { name: 'job_title', label: 'Job title', maxLength: 160 },
      { name: 'started_on', label: 'Start month', type: 'month' },
      { name: 'ended_on', label: 'End month', type: 'month' },
      { name: 'reason_for_leaving', label: 'Reason for leaving', type: 'textarea', maxLength: 500 },
    ],
  },
}

type DraftSlot = { position: DossierPosition; values: Record<string, string> }
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function readValues(record: DossierRecord) {
  const { position, ...values } = record
  return { position, values: values as Record<string, string | null> }
}

function draftRows(details: SectionDetails, records: DossierRecord[]): DraftSlot[] {
  return records.map((record) => {
    const { position, values } = readValues(record)
    return {
      position,
      values: Object.fromEntries(details.fields.map((field) => {
        const stored = values[field.name] ?? ''
        return [field.name, field.type === 'month' ? stored.slice(0, 7) : stored]
      })),
    }
  })
}

function HistoryEditor({
  details,
  snapshot,
  actorCanEdit,
  save,
  reload,
  close,
}: {
  details: SectionDetails
  snapshot: DossierSectionSnapshot
  actorCanEdit: boolean
  save: (version: number, records: DossierWriteRecord[]) => Promise<void>
  reload: () => Promise<DossierSectionSnapshot | undefined>
  close: () => void
}) {
  const formId = useId()
  const [baseline, setBaseline] = useState(snapshot)
  const [draft, setDraft] = useState(() => draftRows(details, snapshot.records))
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const pendingSave = useMutation({
    mutationFn: (records: DossierWriteRecord[]) => save(baseline.version, records),
    retry: false,
  })
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftRows(details, baseline.records))
  const busy = pendingSave.isPending || reloading

  function add(position: DossierPosition) {
    setDraft((rows) => [...rows, { position, values: {} }].sort((a, b) => a.position - b.position))
  }

  function edit(position: DossierPosition, field: string, value: string) {
    setDraft((rows) => rows.map((row) => row.position === position
      ? { ...row, values: { ...row.values, [field]: value } }
      : row))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || conflict || !dirty || !actorCanEdit) return
    setError('')
    for (const slot of draft) {
      if (details.fields.some((field) => field.required && !slot.values[field.name]?.trim())) {
        setError('Complete the required fields for each record.')
        return
      }
      if (slot.values.started_on && slot.values.ended_on && slot.values.ended_on < slot.values.started_on) {
        setError('End month must be the same as or later than start month.')
        return
      }
    }
    const records = draft.map(({ position, values }) => ({
      position,
      ...Object.fromEntries(details.fields.map((field) => {
        const value = values[field.name]?.trim()
        return [field.name, value ? (field.type === 'month' ? value + '-01' : value) : null]
      })),
    }))
    try {
      await pendingSave.mutateAsync(records)
      close()
    } catch (err) {
      if (err instanceof DossierVersionConflict) {
        setConflict(true)
        setError('This section changed since you opened it. Reload it before saving.')
      } else {
        setError('Could not save this section. Your edits are still open.')
      }
    }
  }

  async function reloadSection() {
    setReloading(true)
    try {
      const refreshed = await reload()
      if (!refreshed) {
        setError('Could not reload this section. Your edits are still open.')
        return
      }
      setBaseline(refreshed)
      setDraft(draftRows(details, refreshed.records))
      setError('')
      setConflict(false)
    } finally {
      setReloading(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open && !busy) close() }}
      hasUnsavedChanges={dirty}
      title={details.editTitle}
      description="Keep up to two records in this section."
      footer={
        <div className="w-full space-y-3">
          <FieldError error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {conflict && (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void reloadSection()}>
                Reload and discard edits
              </Button>
            )}
            <DialogClose asChild><Button type="button" variant="outline" disabled={busy}>Cancel</Button></DialogClose>
            <Button type="submit" form={formId} loading={pendingSave.isPending} disabled={busy || conflict || !dirty || !actorCanEdit}>
              {details.saveTitle}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
        {slots.map((position) => {
          const row = draft.find((record) => record.position === position)
          const slotName = details.slots[position - 1]
          if (!row) {
            return (
              <Button key={position} type="button" variant="outline" size="sm" leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => add(position)} disabled={busy || conflict}>
                Add {slotName.toLowerCase()}
              </Button>
            )
          }
          return (
            <fieldset key={position} disabled={busy || conflict} className="space-y-3 rounded-lg border border-line p-4">
              <legend className="px-1 text-xs font-semibold text-ink">{slotName}</legend>
              {details.fields.map((field) => {
                const id = formId + '-' + position + '-' + field.name
                const input = {
                  id,
                  value: row.values[field.name] ?? '',
                  maxLength: field.maxLength,
                  required: field.required,
                  'aria-label': field.label,
                }
                return (
                  <FormGroup key={field.name} label={field.label} htmlFor={id} required={field.required}>
                    {field.type === 'textarea'
                      ? <Textarea {...input} onChange={(event) => edit(position, field.name, event.target.value)} />
                      : <Input {...input} type={field.type ?? 'text'} onChange={(event) => edit(position, field.name, event.target.value)} />}
                  </FormGroup>
                )
              })}
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((rows) => rows.filter((item) => item.position !== position))}>
                Remove {slotName.toLowerCase()}
              </Button>
            </fieldset>
          )
        })}
      </form>
    </Dialog>
  )
}

function HistorySection({
  scope, section, employeeId, canEdit,
}: {
  scope: IdentityScopeRef
  section: DossierSection
  employeeId: string
  canEdit: boolean
}) {
  const details = sections[section]
  const Icon = details.icon
  const titleId = useId()
  const [editor, setEditor] = useState<DossierSectionSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const query = useQuery({
    queryKey: ['hr', 'employee-dossier', scope.identityKey, scope.authEpoch, employeeId, section],
    queryFn: () => getDossierSection(scope, employeeId, section),
    enabled: scope.isAuthReady && Boolean(employeeId),
    retry: false,
  })

  async function save(version: number, records: DossierWriteRecord[]) {
    await saveDossierSection(scope, employeeId, section, version, records)
    await query.refetch()
    setNotice('Section saved.')
  }

  async function reload() {
    const result = await query.refetch()
    return result.isSuccess ? result.data : undefined
  }

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-violet" aria-hidden="true" />
          <h2 id={titleId} className="font-display text-sm font-bold text-ink">{details.title}</h2>
        </div>
        {canEdit && query.isSuccess && (
          <Button type="button" variant="outline" size="sm" leftIcon={<Pencil className="h-4 w-4" />}
            onClick={() => { setNotice(''); setEditor(query.data) }}>
            {details.editTitle}
          </Button>
        )}
      </div>
      {query.isLoading && <p className="text-xs text-muted">Loading…</p>}
      {query.isError && (
        <div className="flex items-center justify-between gap-2">
          <FieldError error={details.errorText} />
          <Button type="button" onClick={() => void query.refetch()} variant="outline" size="sm">Retry</Button>
        </div>
      )}
      {query.isSuccess && query.data.records.length === 0 && <p className="text-sm text-muted">{details.emptyText}</p>}
      {query.isSuccess && query.data.records.map((record) => {
        const { values } = readValues(record)
        return (
          <article key={record.position} className="space-y-2 border-b border-line/60 pb-3 last:border-b-0 last:pb-0">
            <h3 className="text-xs font-semibold text-muted">{details.slots[record.position - 1]}</h3>
            <dl className="space-y-1.5">
              {details.fields.map((field) => {
                const value = values[field.name]
                if (!value) return null
                return (
                  <div key={field.name} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:justify-between sm:gap-3">
                    <dt className="shrink-0 text-muted">{field.label}</dt>
                    <dd className="break-words font-semibold text-ink sm:text-right">
                      {field.type === 'month' ? monthLabel.format(new Date(value + 'T00:00:00Z')) : value}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </article>
        )
      })}
      {notice && <p role="status" className="text-xs text-soft">{notice}</p>}
      {canEdit && editor && (
        <HistoryEditor details={details} snapshot={editor} actorCanEdit={query.isSuccess}
          save={save} reload={reload} close={() => setEditor(null)} />
      )}
    </section>
  )
}

export function EmployeeDossierHistory({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const scope = useProtectedIdentityScope(useAuth())
  if (!scope.isAuthReady || !scope.identityKey) return null
  const key = [scope.identityKey, scope.authEpoch, employeeId].join(':')
  return (
    <>
      <HistorySection key={key + ':contacts'} employeeId={employeeId} section="emergency_contacts" scope={scope} canEdit={canEdit} />
      <HistorySection key={key + ':history'} employeeId={employeeId} section="previous_employment" scope={scope} canEdit={canEdit} />
    </>
  )
}
