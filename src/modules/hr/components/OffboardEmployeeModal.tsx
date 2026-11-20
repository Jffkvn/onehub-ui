import { useEffect, useId, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, CalendarClock } from 'lucide-react'

import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { FormGroup, Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { offboardingSchema, type OffboardingValues } from '../schemas/employee'
import { useOffboardEmployee, type EmployeeSummary } from '../api/employees'

export interface OffboardEmployeeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee: EmployeeSummary
  onOffboarded?: () => void
}

const defaultValues: OffboardingValues = {
  endDate: '',
  exitReason: '',
  exitNotes: '',
  finalPayStatus: 'pending',
}

export function OffboardEmployeeModal({
  open,
  onOpenChange,
  employee,
  onOffboarded,
}: OffboardEmployeeModalProps) {
  const formId = useId()
  const endDateId = useId()
  const reasonId = useId()
  const notesId = useId()
  const [submitError, setSubmitError] = useState('')
  const offboardMutation = useOffboardEmployee()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<OffboardingValues>({
    resolver: zodResolver(offboardingSchema),
    defaultValues,
  })

  useEffect(() => {
    if (open) {
      reset(defaultValues)
      setSubmitError('')
    } else {
      reset(defaultValues)
      setSubmitError('')
    }
  }, [open, employee.id, reset])

  const onSubmit = async (values: OffboardingValues) => {
    if (offboardMutation.isPending) return
    setSubmitError('')
    try {
      await offboardMutation.mutateAsync({ id: employee.id, values })
      reset(defaultValues)
      onOpenChange(false)
      onOffboarded?.()
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Unable to record employee exit. Please review the entries and try again.',
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={isDirty}
      title="Record Employee Exit"
      description={`End the active employment period for ${employee.legalName} (${employee.employeeNumber}).`}
      className="max-w-lg"
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
              <Button type="button" variant="outline" disabled={offboardMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              form={formId}
              variant="danger"
              loading={offboardMutation.isPending}
              leftIcon={<CalendarClock className="h-4 w-4" />}
            >
              Confirm Exit
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-amber/30 bg-amber-tint/50 p-3 text-xs text-ink">
          <p className="font-semibold text-amber">Employment will end on the last working day</p>
          <p className="mt-0.5 text-soft">
            Offboarding closes the current employment period and marks the staff member inactive after their final day while preserving payroll and audit history.
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
            label="Last Working Day"
            htmlFor={endDateId}
            required
            error={errors.endDate?.message}
          >
            <Input
              id={endDateId}
              type="date"
              disabled={offboardMutation.isPending}
              error={Boolean(errors.endDate)}
              {...register('endDate')}
            />
          </FormGroup>

          <FormGroup
            label="Exit Reason"
            htmlFor={reasonId}
            required
            error={errors.exitReason?.message}
          >
            <Input
              id={reasonId}
              placeholder="e.g. Resignation, End of contract"
              disabled={offboardMutation.isPending}
              error={Boolean(errors.exitReason)}
              {...register('exitReason')}
            />
          </FormGroup>

          <FormGroup label="Final Pay Status" required error={errors.finalPayStatus?.message}>
            <Controller
              name="finalPayStatus"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={offboardMutation.isPending}
                  options={[
                    { value: 'not_applicable', label: 'Not Applicable' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'prepared', label: 'Prepared' },
                    { value: 'paid', label: 'Paid' },
                  ]}
                />
              )}
            />
          </FormGroup>

          <FormGroup
            label="Clearance Notes"
            htmlFor={notesId}
            hint="Optional asset return or handover confirmation."
            error={errors.exitNotes?.message}
          >
            <Textarea
              id={notesId}
              placeholder="e.g. Tools and laptop returned to warehouse."
              disabled={offboardMutation.isPending}
              error={Boolean(errors.exitNotes)}
              {...register('exitNotes')}
            />
          </FormGroup>
        </form>
      </div>
    </Dialog>
  )
}
