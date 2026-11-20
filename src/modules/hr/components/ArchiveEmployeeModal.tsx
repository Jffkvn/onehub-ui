import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Archive } from 'lucide-react'

import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { FormGroup, Input } from '@/components/ui/Input'
import { archiveEmployeeSchema, type ArchiveEmployeeValues } from '../schemas/employee'
import { useArchiveEmployee, type EmployeeSummary } from '../api/employees'

export interface ArchiveEmployeeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee: EmployeeSummary
  onArchived?: () => void
}

const defaultValues: ArchiveEmployeeValues = {
  reason: '',
}

export function ArchiveEmployeeModal({
  open,
  onOpenChange,
  employee,
  onArchived,
}: ArchiveEmployeeModalProps) {
  const formId = useId()
  const reasonId = useId()
  const [submitError, setSubmitError] = useState('')
  const archiveMutation = useArchiveEmployee()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ArchiveEmployeeValues>({
    resolver: zodResolver(archiveEmployeeSchema),
    defaultValues,
  })

  useEffect(() => {
    reset(defaultValues)
    setSubmitError('')
  }, [open, employee.id, reset])

  const onSubmit = async (values: ArchiveEmployeeValues) => {
    if (archiveMutation.isPending) return
    setSubmitError('')
    try {
      await archiveMutation.mutateAsync({ id: employee.id, reason: values.reason })
      reset(defaultValues)
      onOpenChange(false)
      onArchived?.()
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Employee could not be archived. Please try again.',
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={isDirty}
      title="Archive Employee Record"
      description={`${employee.legalName} (${employee.employeeNumber})`}
      className="max-w-md"
      footer={
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
              <Button type="button" variant="outline" disabled={archiveMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              form={formId}
              variant="danger"
              loading={archiveMutation.isPending}
              leftIcon={<Archive className="h-4 w-4" />}
            >
              Archive Employee
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-rose/30 bg-rose-tint/50 p-3 text-xs text-ink">
          <p className="font-semibold text-rose">Archive vs. Offboarding</p>
          <p className="mt-0.5 text-soft">
            Archive a record only for duplicate or invalid entries. For staff departures, use{' '}
            <strong>Record Exit</strong> instead. Historical audit and payroll links are retained, and the employee will be hidden from the active directory.
          </p>
        </div>

        <form
          id={formId}
          onSubmit={(event) => {
            void handleSubmit(onSubmit)(event)
          }}
          className="space-y-4"
        >
          <FormGroup
            label="Archive Reason"
            htmlFor={reasonId}
            required
            hint="Minimum 3 characters — recorded in the audit trail."
            error={errors.reason?.message}
          >
            <Input
              id={reasonId}
              placeholder="e.g. Duplicate employee record"
              disabled={archiveMutation.isPending}
              error={Boolean(errors.reason)}
              {...register('reason')}
            />
          </FormGroup>
        </form>
      </div>
    </Dialog>
  )
}
