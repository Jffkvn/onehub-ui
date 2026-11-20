import { useEffect, useState } from 'react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus, UserCheck, AlertCircle } from 'lucide-react'

import { Dialog, DialogClose } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Input, FormGroup } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FormSection } from '@/components/patterns/FormSection'
import {
  employeeFormSchema,
  type EmployeeFormValues,
} from '../schemas/employee'
import {
  useEmployeeSetup,
  useCreateEmployee,
  useUpdateEmployee,
  type EmployeeSummary,
} from '../api/employees'

export interface EmployeeFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee?: EmployeeSummary | null
  onSaved?: (employee: EmployeeSummary) => void
}

function parseGender(value: unknown): EmployeeFormValues['gender'] {
  if (
    value === 'female' ||
    value === 'male' ||
    value === 'other' ||
    value === 'prefer_not_to_say'
  ) {
    return value
  }
  return ''
}

const defaultValues: EmployeeFormValues = {
  fullName: '',
  employeeNumber: '',
  nationalId: '',
  companyEmail: '',
  personalEmail: '',
  phone: '',
  gender: '',
  dateOfBirth: '',
  departmentId: '',
  jobTitleId: '',
  payGradeId: '',
  employmentType: 'full_time',
  startDate: new Date().toISOString().slice(0, 10),
  contractType: 'permanent',
  contractEndDate: '',
  probationEndDate: '',
  probationStatus: 'on_probation',
  grossSalary: '',
  currency: 'UGX',
  customOvertimeRate: '',
  paymentMethod: 'bank',
  mobileMoneyNumber: '',
  bankName: '',
  accountNumber: '',
  sortCode: '',
  tinNumber: '',
  nssfNumber: '',
  employeeTaxType: 'local',
  pctMonthWorked: '100',
  whtRate: '6',
}

export function EmployeeFormModal({
  open,
  onOpenChange,
  employee,
  onSaved,
}: EmployeeFormModalProps) {
  const isEditing = Boolean(employee?.id)
  const { data: setup } = useEmployeeSetup()

  const createMutation = useCreateEmployee()
  const updateMutation = useUpdateEmployee()

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues,
  })

  const selectedDepartmentId = useWatch({ control, name: 'departmentId' })
  const selectedJobTitleId = useWatch({ control, name: 'jobTitleId' })
  const selectedPaymentMethod = useWatch({ control, name: 'paymentMethod' })
  const selectedContractType = useWatch({ control, name: 'contractType' })
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (open) {
      setSubmitError('')
    }
  }, [open, employee?.id])

  // Clear jobTitleId when switching to a department where the previous department-scoped job title is invalid
  useEffect(() => {
    const titles = setup?.jobTitles ?? []
    if (!selectedJobTitleId || titles.length === 0) return
    const current = titles.find((j) => j.id === selectedJobTitleId)
    if (current && current.departmentId && selectedDepartmentId && current.departmentId !== selectedDepartmentId) {
      setValue('jobTitleId', '', { shouldDirty: true, shouldValidate: true })
    } else if (current && current.departmentId && !selectedDepartmentId) {
      // Allow department-specific titles or keep selected cleanly when department cleared
    }
  }, [selectedDepartmentId, selectedJobTitleId, setup?.jobTitles, setValue])

  // Populate form values when editing
  useEffect(() => {
    if (employee && open) {
      reset({
        fullName: employee.legalName,
        employeeNumber: employee.employeeNumber,
        nationalId: employee.nationalId ?? '',
        companyEmail: employee.companyEmail ?? '',
        personalEmail: employee.personalEmail ?? '',
        phone: employee.workPhone ?? '',
        gender: parseGender(employee.gender),
        dateOfBirth: employee.dateOfBirth ?? '',
        departmentId: employee.departmentId ?? '',
        jobTitleId: employee.jobTitleId ?? '',
        payGradeId: employee.payGradeId ?? '',
        employmentType: employee.employmentType ?? 'full_time',
        startDate: employee.startDate ?? new Date().toISOString().slice(0, 10),
        contractType: employee.contractType ?? 'permanent',
        contractEndDate: employee.contractEndDate ?? '',
        probationEndDate: employee.probationEndDate ?? '',
        probationStatus: employee.probationStatus ?? 'on_probation',
        grossSalary: employee.grossSalary != null ? String(employee.grossSalary) : '',
        currency: 'UGX',
        customOvertimeRate:
          employee.customOvertimeRate != null ? String(employee.customOvertimeRate) : '',
        paymentMethod: employee.paymentMethod ?? 'bank',
        mobileMoneyNumber: employee.mobileMoneyNumber ?? '',
        bankName: employee.bankName ?? '',
        accountNumber: employee.accountNumber ?? '',
        sortCode: employee.sortCode ?? '',
        tinNumber: employee.tinNumber ?? '',
        nssfNumber: employee.nssfNumber ?? '',
        employeeTaxType: employee.employeeTaxType ?? 'local',
        pctMonthWorked:
          employee.pctMonthWorked != null ? String(employee.pctMonthWorked) : '100',
        whtRate: employee.whtRate != null ? String(employee.whtRate) : '6',
      })
    } else if (!open || !employee) {
      reset(defaultValues)
    }
  }, [employee, open, reset])

  // Filter job titles by selected department (keeping company-wide titles with departmentId === null)
  const filteredJobTitles =
    setup?.jobTitles.filter(
      (j) => !selectedDepartmentId || !j.departmentId || j.departmentId === selectedDepartmentId,
    ) ?? []

  const isPending = createMutation.isPending || updateMutation.isPending

  const onSubmit = async (values: EmployeeFormValues) => {
    if (isPending) return
    setSubmitError('')
    try {
      let result: EmployeeSummary
      if (isEditing && employee) {
        result = await updateMutation.mutateAsync({ id: employee.id, values })
      } else {
        result = await createMutation.mutateAsync(values)
      }
      reset(values)
      onOpenChange(false)
      onSaved?.(result)
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Unable to save employee record. Please try again.',
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      hasUnsavedChanges={isDirty}
      title={isEditing ? `Edit Profile — ${employee?.legalName}` : 'Add New Employee'}
      description={
        isEditing
          ? 'Update employment period and profile confidential information.'
          : 'Initialize new employee record with employment period details.'
      }
      className="max-w-3xl"
      footer={
        <div className="w-full space-y-3">
          {submitError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md bg-rose-tint p-3 text-xs text-rose"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="md">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              form="employee-form"
              variant="primary"
              size="md"
              loading={isPending}
              leftIcon={isEditing ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            >
              {isEditing ? 'Save Employee Changes' : 'Create Employee Record'}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="employee-form"
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e)
        }}
        className="space-y-6"
      >
          {/* 1. Identity & Basic Info */}
          <FormSection
            title="Identity &amp; Basic Information"
            description="Personal details, legal names, and employee numbers."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup
                label="Full Legal Name"
                required
                error={errors.fullName?.message}
              >
                <Input placeholder="e.g. Kato Mukasa John" {...register('fullName')} />
              </FormGroup>

              <FormGroup
                label="Employee Number"
                required
                error={errors.employeeNumber?.message}
              >
                <Input placeholder="e.g. EMP-0142" {...register('employeeNumber')} />
              </FormGroup>

              <FormGroup label="National ID Number (NIN)" error={errors.nationalId?.message}>
                <Input placeholder="e.g. CM90012345678" {...register('nationalId')} />
              </FormGroup>

              <Controller
                name="gender"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Gender" error={errors.gender?.message}>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: '', label: 'Select Gender...' },
                        { value: 'female', label: 'Female' },
                        { value: 'male', label: 'Male' },
                        { value: 'other', label: 'Other' },
                        { value: 'prefer_not_to_say', label: 'Prefer not to say' },
                      ]}
                    />
                  </FormGroup>
                )}
              />

              <FormGroup label="Date of Birth" error={errors.dateOfBirth?.message}>
                <Input type="date" {...register('dateOfBirth')} />
              </FormGroup>
            </div>
          </FormSection>

          {/* 2. Employment & Role */}
          <FormSection
            title="Employment &amp; Organization"
            description="Department, job title, pay grade, and contract details."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Controller
                name="departmentId"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Department" error={errors.departmentId?.message}>
                    <Combobox
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select Department..."
                      searchPlaceholder="Search departments..."
                      options={[
                        { value: '', label: 'None / Unassigned' },
                        ...(setup?.departments.map((d) => ({
                          value: d.id,
                          label: d.name,
                        })) ?? []),
                      ]}
                    />
                  </FormGroup>
                )}
              />

              <Controller
                name="jobTitleId"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Job Title" error={errors.jobTitleId?.message}>
                    <Combobox
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select Job Title..."
                      searchPlaceholder="Search job titles..."
                      options={[
                        { value: '', label: 'None / Unassigned' },
                        ...filteredJobTitles.map((j) => ({
                          value: j.id,
                          label: j.name,
                        })),
                      ]}
                    />
                  </FormGroup>
                )}
              />

              <Controller
                name="payGradeId"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Pay Grade" error={errors.payGradeId?.message}>
                    <Combobox
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder="Select Pay Grade..."
                      searchPlaceholder="Search pay grades..."
                      options={[
                        { value: '', label: 'None / Unassigned' },
                        ...(setup?.payGrades.map((g) => ({
                          value: g.id,
                          label: `${g.code} — ${g.name}`,
                        })) ?? []),
                      ]}
                    />
                  </FormGroup>
                )}
              />

              <Controller
                name="employmentType"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Employment Type" error={errors.employmentType?.message}>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: 'full_time', label: 'Full Time' },
                        { value: 'part_time', label: 'Part Time' },
                        { value: 'casual', label: 'Casual' },
                        { value: 'intern', label: 'Intern' },
                        { value: 'contractor', label: 'Contractor' },
                      ]}
                    />
                  </FormGroup>
                )}
              />

              <FormGroup label="Start Date" required error={errors.startDate?.message}>
                <Input type="date" {...register('startDate')} />
              </FormGroup>

              <Controller
                name="contractType"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Contract Type" error={errors.contractType?.message}>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: 'permanent', label: 'Permanent' },
                        { value: 'fixed_term', label: 'Fixed Term' },
                        { value: 'casual', label: 'Casual' },
                        { value: 'internship', label: 'Internship' },
                        { value: 'consultancy', label: 'Consultancy' },
                      ]}
                    />
                  </FormGroup>
                )}
              />

              {selectedContractType === 'fixed_term' && (
                <FormGroup
                  label="Contract End Date"
                  required
                  error={errors.contractEndDate?.message}
                >
                  <Input type="date" {...register('contractEndDate')} />
                </FormGroup>
              )}

              <Controller
                name="probationStatus"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Probation Status" error={errors.probationStatus?.message}>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: 'on_probation', label: 'On Probation' },
                        { value: 'passed', label: 'Passed Probation' },
                        { value: 'extended', label: 'Probation Extended' },
                        { value: 'failed', label: 'Failed Probation' },
                        { value: 'not_applicable', label: 'Not Applicable' },
                      ]}
                    />
                  </FormGroup>
                )}
              />
            </div>
          </FormSection>

          {/* 3. Compensation & Taxes */}
          <FormSection
            title="Compensation &amp; Statutory Setup"
            description="Gross salary, tax treatment, and month work percentages."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup label="Gross Salary (UGX)" error={errors.grossSalary?.message}>
                <Input placeholder="e.g. 4500000" {...register('grossSalary')} />
              </FormGroup>

              <Controller
                name="employeeTaxType"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Tax Treatment" error={errors.employeeTaxType?.message}>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: 'local', label: 'Local Resident (PAYE Standard)' },
                        { value: 'global', label: 'Non-Resident (Flat PAYE)' },
                        { value: 'contractor', label: 'Contractor (WHT Withholding)' },
                        { value: 'exempt', label: 'Tax Exempt' },
                      ]}
                    />
                  </FormGroup>
                )}
              />

              <FormGroup label="% Month Worked Default" error={errors.pctMonthWorked?.message}>
                <Input placeholder="100" {...register('pctMonthWorked')} />
              </FormGroup>

              <FormGroup label="WHT Rate (%)" error={errors.whtRate?.message}>
                <Input placeholder="6" {...register('whtRate')} />
              </FormGroup>
            </div>
          </FormSection>

          {/* 4. Payment & Banking */}
          <FormSection
            title="Disbursement Method"
            description="Bank account or Mobile Money details for salary payments."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Controller
                name="paymentMethod"
                control={control}
                render={({ field }) => (
                  <FormGroup label="Payment Method" error={errors.paymentMethod?.message}>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      options={[
                        { value: 'bank', label: 'Bank Transfer' },
                        { value: 'mobile_money', label: 'MTN Mobile Money' },
                        { value: 'cash', label: 'Cash Settlement' },
                      ]}
                    />
                  </FormGroup>
                )}
              />

              {selectedPaymentMethod === 'bank' && (
                <>
                  <FormGroup label="Bank Name" required error={errors.bankName?.message}>
                    <Input placeholder="e.g. Stanbic Bank" {...register('bankName')} />
                  </FormGroup>
                  <FormGroup label="Account Number" required error={errors.accountNumber?.message}>
                    <Input placeholder="e.g. 9030001234567" {...register('accountNumber')} />
                  </FormGroup>
                  <FormGroup label="Sort / Branch Code" error={errors.sortCode?.message}>
                    <Input placeholder="e.g. 0401" {...register('sortCode')} />
                  </FormGroup>
                </>
              )}

              {selectedPaymentMethod === 'mobile_money' && (
                <FormGroup
                  label="MTN Phone Number"
                  required
                  error={errors.mobileMoneyNumber?.message}
                >
                  <Input placeholder="e.g. 256770001122" {...register('mobileMoneyNumber')} />
                </FormGroup>
              )}

              <FormGroup label="URA TIN Number" error={errors.tinNumber?.message}>
                <Input placeholder="e.g. 1001234567" {...register('tinNumber')} />
              </FormGroup>

              <FormGroup label="NSSF Number" error={errors.nssfNumber?.message}>
                <Input placeholder="e.g. NS10002000" {...register('nssfNumber')} />
              </FormGroup>
            </div>
          </FormSection>

          {/* 5. Contact Information */}
          <FormSection title="Contact Info" description="Work email, phone number, and personal email.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup label="Company Email" error={errors.companyEmail?.message}>
                <Input placeholder="name@egypro.com" {...register('companyEmail')} />
              </FormGroup>

              <FormGroup label="Work Phone" error={errors.phone?.message}>
                <Input placeholder="+256770001122" {...register('phone')} />
              </FormGroup>

              <FormGroup label="Personal Email" error={errors.personalEmail?.message}>
                <Input placeholder="personal@gmail.com" {...register('personalEmail')} />
              </FormGroup>
            </div>
          </FormSection>
        </form>
    </Dialog>
  )
}
