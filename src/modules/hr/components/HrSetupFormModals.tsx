import { useEffect, useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle } from 'lucide-react'

import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { FormGroup, Input, Textarea } from '@/components/ui/Input'
import {
  departmentInputSchema,
  jobTitleInputSchema,
  payGradeInputSchema,
  setSetupArchivedInputSchema,
  type DepartmentInput,
  type JobTitleInput,
  type PayGradeInput,
  type SetSetupArchivedInput,
} from '../schemas/setup'
import {
  useSaveDepartment,
  useSaveJobTitle,
  useSavePayGrade,
  useSetSetupArchived,
  type DepartmentSetupRecord,
  type JobTitleSetupRecord,
  type PayGradeSetupRecord,
} from '../api/setup'

type DepartmentFormInput = z.input<typeof departmentInputSchema>

type JobTitleFormInput = z.input<typeof jobTitleInputSchema>

type PayGradeFormInput = z.input<typeof payGradeInputSchema>

type ArchiveFormInput = z.input<typeof setSetupArchivedInputSchema>

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'HR setup request could not be completed.'
}

function SetupModalFooter({
  formId,
  submitError,
  isPending,
  submitLabel,
  submitVariant = 'primary',
}: {
  formId: string
  submitError: string
  isPending: boolean
  submitLabel: string
  submitVariant?: 'primary' | 'danger'
}) {
  return (
    <div className="w-full space-y-3">
      {submitError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-rose/30 bg-rose-tint p-3 text-xs text-rose"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-2.5">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" form={formId} variant={submitVariant} loading={isPending}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

/* ─── Department Form Modal ───────────────────────────────────────────────── */

export function DepartmentFormModal({
  open,
  onOpenChange,
  record,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: DepartmentSetupRecord | null
}) {
  const formId = useId()
  const codeId = useId()
  const nameId = useId()
  const descId = useId()
  const reasonId = useId()
  const [submitError, setSubmitError] = useState('')
  const mutation = useSaveDepartment()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<DepartmentFormInput>({
    resolver: zodResolver(departmentInputSchema),
    defaultValues: {
      id: null,
      code: '',
      name: '',
      description: '',
      reason: '',
    },
  })

  useEffect(() => {
    setSubmitError('')
    if (open && record) {
      reset({
        id: record.id,
        code: record.code,
        name: record.name,
        description: record.description,
        reason: '',
      })
    } else {
      reset({ id: null, code: '', name: '', description: '', reason: '' })
    }
  }, [open, record, reset])

  const onSubmit = async (rawValues: DepartmentFormInput) => {
    if (mutation.isPending) return
    setSubmitError('')
    try {
      const parsed: DepartmentInput = departmentInputSchema.parse(rawValues)
      await mutation.mutateAsync(parsed)
      reset({ id: null, code: '', name: '', description: '', reason: '' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(errorText(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={isDirty}
      title={record ? 'Edit Department' : 'Add Department'}
      description="Maintain organizational departments referenced on employee records."
      footer={
        <SetupModalFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Save Department"
        />
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event)
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormGroup label="Code" htmlFor={codeId} required error={errors.code?.message}>
            <Input
              id={codeId}
              placeholder="e.g. OPS"
              disabled={mutation.isPending}
              error={Boolean(errors.code)}
              {...register('code')}
            />
          </FormGroup>
          <FormGroup label="Name" htmlFor={nameId} required error={errors.name?.message}>
            <Input
              id={nameId}
              placeholder="e.g. Operations"
              disabled={mutation.isPending}
              error={Boolean(errors.name)}
              {...register('name')}
            />
          </FormGroup>
        </div>

        <FormGroup label="Description" htmlFor={descId} error={errors.description?.message}>
          <Textarea
            id={descId}
            placeholder="Department scope or notes..."
            disabled={mutation.isPending}
            error={Boolean(errors.description)}
            {...register('description')}
          />
        </FormGroup>

        <FormGroup
          label="Reason for Change"
          htmlFor={reasonId}
          required
          hint="Saved in the HR setup audit trail."
          error={errors.reason?.message}
        >
          <Input
            id={reasonId}
            placeholder="e.g. Initial department setup"
            disabled={mutation.isPending}
            error={Boolean(errors.reason)}
            {...register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Job Title Form Modal ────────────────────────────────────────────────── */

export function JobTitleFormModal({
  open,
  onOpenChange,
  departments,
  record,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  departments: DepartmentSetupRecord[]
  record: JobTitleSetupRecord | null
}) {
  const formId = useId()
  const codeId = useId()
  const nameId = useId()
  const descId = useId()
  const reasonId = useId()
  const [submitError, setSubmitError] = useState('')
  const mutation = useSaveJobTitle()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<JobTitleFormInput>({
    resolver: zodResolver(jobTitleInputSchema),
    defaultValues: {
      id: null,
      departmentId: null,
      code: '',
      name: '',
      description: '',
      reason: '',
    },
  })

  useEffect(() => {
    setSubmitError('')
    if (open && record) {
      reset({
        id: record.id,
        departmentId: record.departmentId,
        code: record.code,
        name: record.name,
        description: record.description,
        reason: '',
      })
    } else {
      reset({
        id: null,
        departmentId: null,
        code: '',
        name: '',
        description: '',
        reason: '',
      })
    }
  }, [open, record, reset])

  const onSubmit = async (rawValues: JobTitleFormInput) => {
    if (mutation.isPending) return
    setSubmitError('')
    try {
      const parsed: JobTitleInput = jobTitleInputSchema.parse(rawValues)
      await mutation.mutateAsync(parsed)
      reset({ id: null, departmentId: null, code: '', name: '', description: '', reason: '' })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(errorText(error))
    }
  }

  const departmentOptions = [
    { value: '', label: 'Company-wide title' },
    ...departments
      .filter((d) => !d.archivedAt || d.id === record?.departmentId)
      .map((d) => ({ value: d.id, label: d.name, subtitle: d.code })),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={isDirty}
      title={record ? 'Edit Job Title' : 'Add Job Title'}
      description="Assign a title to one department or keep it company-wide."
      footer={
        <SetupModalFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Save Job Title"
        />
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event)
        }}
        className="space-y-4"
      >
        <Controller
          name="departmentId"
          control={control}
          render={({ field }) => (
            <FormGroup
              label="Department"
              hint="Company-wide titles remain available across every department."
              error={errors.departmentId?.message}
            >
              <Combobox
                value={field.value ?? ''}
                onValueChange={(val) => field.onChange(val === '' ? null : val)}
                disabled={mutation.isPending}
                placeholder="Company-wide title"
                searchPlaceholder="Search departments..."
                options={departmentOptions}
              />
            </FormGroup>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormGroup label="Code" htmlFor={codeId} required error={errors.code?.message}>
            <Input
              id={codeId}
              placeholder="e.g. ENG"
              disabled={mutation.isPending}
              error={Boolean(errors.code)}
              {...register('code')}
            />
          </FormGroup>
          <FormGroup label="Name" htmlFor={nameId} required error={errors.name?.message}>
            <Input
              id={nameId}
              placeholder="e.g. Field Engineer"
              disabled={mutation.isPending}
              error={Boolean(errors.name)}
              {...register('name')}
            />
          </FormGroup>
        </div>

        <FormGroup label="Description" htmlFor={descId} error={errors.description?.message}>
          <Textarea
            id={descId}
            placeholder="Role summary..."
            disabled={mutation.isPending}
            error={Boolean(errors.description)}
            {...register('description')}
          />
        </FormGroup>

        <FormGroup
          label="Reason for Change"
          htmlFor={reasonId}
          required
          hint="Saved in the HR setup audit trail."
          error={errors.reason?.message}
        >
          <Input
            id={reasonId}
            placeholder="e.g. Add engineering job title"
            disabled={mutation.isPending}
            error={Boolean(errors.reason)}
            {...register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Pay Grade Form Modal ────────────────────────────────────────────────── */

export function PayGradeFormModal({
  open,
  onOpenChange,
  record,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: PayGradeSetupRecord | null
}) {
  const formId = useId()
  const codeId = useId()
  const nameId = useId()
  const currencyId = useId()
  const minId = useId()
  const maxId = useId()
  const descId = useId()
  const reasonId = useId()
  const [submitError, setSubmitError] = useState('')
  const mutation = useSavePayGrade()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<PayGradeFormInput>({
    resolver: zodResolver(payGradeInputSchema),
    defaultValues: {
      id: null,
      code: '',
      name: '',
      currencyCode: 'UGX',
      minimumGross: '',
      maximumGross: '',
      description: '',
      reason: '',
    },
  })

  useEffect(() => {
    setSubmitError('')
    if (open && record) {
      reset({
        id: record.id,
        code: record.code,
        name: record.name,
        currencyCode: record.currencyCode,
        minimumGross: record.minimumGross === null ? '' : String(record.minimumGross),
        maximumGross: record.maximumGross === null ? '' : String(record.maximumGross),
        description: record.description,
        reason: '',
      })
    } else {
      reset({
        id: null,
        code: '',
        name: '',
        currencyCode: 'UGX',
        minimumGross: '',
        maximumGross: '',
        description: '',
        reason: '',
      })
    }
  }, [open, record, reset])

  const onSubmit = async (rawValues: PayGradeFormInput) => {
    if (mutation.isPending) return
    setSubmitError('')
    try {
      const parsed: PayGradeInput = payGradeInputSchema.parse(rawValues)
      await mutation.mutateAsync(parsed)
      reset({
        id: null,
        code: '',
        name: '',
        currencyCode: 'UGX',
        minimumGross: '',
        maximumGross: '',
        description: '',
        reason: '',
      })
      onOpenChange(false)
    } catch (error) {
      setSubmitError(errorText(error))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={isDirty}
      title={record ? 'Edit Pay Grade' : 'Add Pay Grade'}
      description="Configure salary bands and currency codes used in HR assignments."
      footer={
        <SetupModalFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel="Save Pay Grade"
        />
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event)
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormGroup label="Code" htmlFor={codeId} required error={errors.code?.message}>
            <Input
              id={codeId}
              placeholder="e.g. G2"
              disabled={mutation.isPending}
              error={Boolean(errors.code)}
              {...register('code')}
            />
          </FormGroup>
          <FormGroup label="Name" htmlFor={nameId} required error={errors.name?.message}>
            <Input
              id={nameId}
              placeholder="e.g. Grade Two"
              disabled={mutation.isPending}
              error={Boolean(errors.name)}
              {...register('name')}
            />
          </FormGroup>
          <FormGroup label="Currency" htmlFor={currencyId} required error={errors.currencyCode?.message}>
            <Input
              id={currencyId}
              placeholder="UGX"
              disabled={mutation.isPending}
              error={Boolean(errors.currencyCode)}
              {...register('currencyCode')}
            />
          </FormGroup>
          <div className="hidden sm:block" />
          <FormGroup label="Minimum Gross" htmlFor={minId} error={errors.minimumGross?.message}>
            <Input
              id={minId}
              inputMode="decimal"
              placeholder="e.g. 1500000"
              disabled={mutation.isPending}
              error={Boolean(errors.minimumGross)}
              {...register('minimumGross')}
            />
          </FormGroup>
          <FormGroup label="Maximum Gross" htmlFor={maxId} error={errors.maximumGross?.message}>
            <Input
              id={maxId}
              inputMode="decimal"
              placeholder="e.g. 3000000"
              disabled={mutation.isPending}
              error={Boolean(errors.maximumGross)}
              {...register('maximumGross')}
            />
          </FormGroup>
        </div>

        <FormGroup label="Description" htmlFor={descId} error={errors.description?.message}>
          <Textarea
            id={descId}
            placeholder="Band guidance..."
            disabled={mutation.isPending}
            error={Boolean(errors.description)}
            {...register('description')}
          />
        </FormGroup>

        <FormGroup
          label="Reason for Change"
          htmlFor={reasonId}
          required
          hint="Saved in the HR setup audit trail."
          error={errors.reason?.message}
        >
          <Input
            id={reasonId}
            placeholder="e.g. Update grade range"
            disabled={mutation.isPending}
            error={Boolean(errors.reason)}
            {...register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}

/* ─── Setup Archive / Restore Confirm Modal ───────────────────────────────── */

export interface SetupArchiveTarget {
  kind: SetSetupArchivedInput['kind']
  id: string
  name: string
  archived: boolean
}

export function SetupArchiveModal({
  target,
  onClose,
}: {
  target: SetupArchiveTarget | null
  onClose: () => void
}) {
  const formId = useId()
  const reasonId = useId()
  const [submitError, setSubmitError] = useState('')
  const mutation = useSetSetupArchived()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ArchiveFormInput>({
    resolver: zodResolver(setSetupArchivedInputSchema),
    defaultValues: {
      kind: 'department',
      id: '',
      archived: true,
      reason: '',
    },
  })

  useEffect(() => {
    setSubmitError('')
    if (target) {
      reset({
        kind: target.kind,
        id: target.id,
        archived: !target.archived,
        reason: '',
      })
    } else {
      reset({
        kind: 'department',
        id: '',
        archived: true,
        reason: '',
      })
    }
  }, [target, reset])

  const onSubmit = async (rawValues: ArchiveFormInput) => {
    if (mutation.isPending || !target) return
    setSubmitError('')
    try {
      const parsed: SetSetupArchivedInput = setSetupArchivedInputSchema.parse(rawValues)
      await mutation.mutateAsync(parsed)
      reset({ kind: 'department', id: '', archived: true, reason: '' })
      onClose()
    } catch (error) {
      setSubmitError(errorText(error))
    }
  }

  const labelKind = target?.kind.replace('_', ' ') ?? 'record'
  const restoring = Boolean(target?.archived)

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      hasUnsavedChanges={isDirty}
      title={`${restoring ? 'Restore' : 'Archive'} ${labelKind}`}
      description={target?.name}
      className="max-w-md"
      footer={
        <SetupModalFooter
          formId={formId}
          submitError={submitError}
          isPending={mutation.isPending}
          submitLabel={restoring ? 'Restore' : 'Archive'}
          submitVariant={restoring ? 'primary' : 'danger'}
        />
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          void handleSubmit(onSubmit)(event)
        }}
        className="space-y-4"
      >
        <p className="text-xs text-soft">
          “{target?.name}” will{' '}
          {restoring
            ? 'become available again for new employee assignments.'
            : 'stop appearing in new employee assignment dropdowns. Existing employee and payroll history remains unchanged.'}
        </p>

        <FormGroup
          label={`Reason for ${restoring ? 'restore' : 'archive'}`}
          htmlFor={reasonId}
          required
          error={errors.reason?.message}
        >
          <Input
            id={reasonId}
            placeholder={restoring ? 'e.g. Re-activated department' : 'e.g. Replaced by new grade'}
            disabled={mutation.isPending}
            error={Boolean(errors.reason)}
            {...register('reason')}
          />
        </FormGroup>
      </form>
    </Dialog>
  )
}
