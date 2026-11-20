import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase/client'
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

export interface DepartmentSetupRecord {
  id: string
  code: string
  name: string
  description: string
  archivedAt: string | null
  currentEmployeeCount: number
  activeJobTitleCount: number
}

export interface JobTitleSetupRecord {
  id: string
  departmentId: string | null
  departmentName: string | null
  code: string
  name: string
  description: string
  archivedAt: string | null
  currentEmployeeCount: number
}

export interface PayGradeSetupRecord {
  id: string
  code: string
  name: string
  currencyCode: string
  minimumGross: number | null
  maximumGross: number | null
  description: string
  archivedAt: string | null
  currentEmployeeCount: number
}

export interface HrSetupRecords {
  departments: DepartmentSetupRecord[]
  jobTitles: JobTitleSetupRecord[]
  payGrades: PayGradeSetupRecord[]
}

type Row = Record<string, unknown>

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

function parseRecord(row: Row): HrSetupRecords {
  return {
    departments: ((row.departments as Row[] | undefined) ?? []).map((d) => ({
      id: str(d.id),
      code: str(d.code),
      name: str(d.name),
      description: str(d.description),
      archivedAt: (d.archived_at as string | null) ?? null,
      currentEmployeeCount: Number(d.current_employee_count ?? 0),
      activeJobTitleCount: Number(d.active_job_title_count ?? 0),
    })),
    jobTitles: ((row.job_titles as Row[] | undefined) ?? []).map((j) => ({
      id: str(j.id),
      departmentId: (j.department_id as string | null) ?? null,
      departmentName: (j.department_name as string | null) ?? null,
      code: str(j.code),
      name: str(j.name),
      description: str(j.description),
      archivedAt: (j.archived_at as string | null) ?? null,
      currentEmployeeCount: Number(j.current_employee_count ?? 0),
    })),
    payGrades: ((row.pay_grades as Row[] | undefined) ?? []).map((g) => ({
      id: str(g.id),
      code: str(g.code),
      name: str(g.name),
      currencyCode: str(g.currency_code, 'UGX'),
      minimumGross: g.minimum_gross === null || g.minimum_gross === undefined ? null : Number(g.minimum_gross),
      maximumGross: g.maximum_gross === null || g.maximum_gross === undefined ? null : Number(g.maximum_gross),
      description: str(g.description),
      archivedAt: (g.archived_at as string | null) ?? null,
      currentEmployeeCount: Number(g.current_employee_count ?? 0),
    })),
  }
}

const exposedDatabaseMessages = new Set([
  'employees.manage_setup permission is required',
  'an active profile is required',
  'change reason must contain between 3 and 500 characters',
  'department code or name already exists',
  'job title code or name already exists',
  'pay grade code or name already exists',
  'active department not found',
  'department not found',
  'job title not found',
  'pay grade not found',
  'minimum gross cannot be negative',
  'maximum gross cannot be negative',
  'maximum gross cannot be less than minimum gross',
  'department has active job titles or current employee assignments',
  'job title is assigned to a current employee',
  'pay grade is assigned to a current employee',
  'restore the department before restoring its job title',
  'invalid HR setup record type',
])

function safeRequestError(error: unknown): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    exposedDatabaseMessages.has(error.message)
  ) {
    return new Error(error.message)
  }
  return new Error('HR setup request could not be completed.')
}

async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const res = await getSupabaseClient().rpc(name, args)
  if (res.error) throw safeRequestError(res.error)
  return res.data as unknown
}

export interface HrSetupApi {
  list(): Promise<HrSetupRecords>
  saveDepartment(input: DepartmentInput): Promise<void>
  saveJobTitle(input: JobTitleInput): Promise<void>
  savePayGrade(input: PayGradeInput): Promise<void>
  setArchived(input: SetSetupArchivedInput): Promise<void>
}

export const hrSetupApi: HrSetupApi = {
  async list() {
    const data = await rpc('hr_list_setup_records')
    return parseRecord(data as Row)
  },
  async saveDepartment(input) {
    const parsed = departmentInputSchema.parse(input)
    await rpc('hr_save_department', {
      target_id: parsed.id,
      setup_code: parsed.code,
      setup_name: parsed.name,
      setup_description: parsed.description,
      change_reason: parsed.reason,
    })
  },
  async saveJobTitle(input) {
    const parsed = jobTitleInputSchema.parse(input)
    await rpc('hr_save_job_title', {
      target_id: parsed.id,
      target_department_id: parsed.departmentId,
      setup_code: parsed.code,
      setup_name: parsed.name,
      setup_description: parsed.description,
      change_reason: parsed.reason,
    })
  },
  async savePayGrade(input) {
    const parsed = payGradeInputSchema.parse(input)
    await rpc('hr_save_pay_grade', {
      target_id: parsed.id,
      setup_code: parsed.code,
      setup_name: parsed.name,
      setup_currency_code: parsed.currencyCode,
      minimum_gross: parsed.minimumGross,
      maximum_gross: parsed.maximumGross,
      setup_description: parsed.description,
      change_reason: parsed.reason,
    })
  },
  async setArchived(input) {
    const parsed = setSetupArchivedInputSchema.parse(input)
    await rpc('hr_set_setup_archived', {
      setup_kind: parsed.kind,
      target_id: parsed.id,
      archived: parsed.archived,
      change_reason: parsed.reason,
    })
  },
}

// ─── TanStack Query Hooks ───────────────────────────────────────────────────

export function useHrSetupRecords() {
  return useQuery({
    queryKey: ['hr', 'setup'],
    queryFn: () => hrSetupApi.list(),
  })
}

export function useSaveDepartment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: DepartmentInput) => hrSetupApi.saveDepartment(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hr', 'setup'] }),
        queryClient.invalidateQueries({ queryKey: ['hr', 'employee-setup'] }),
      ])
    },
  })
}

export function useSaveJobTitle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: JobTitleInput) => hrSetupApi.saveJobTitle(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hr', 'setup'] }),
        queryClient.invalidateQueries({ queryKey: ['hr', 'employee-setup'] }),
      ])
    },
  })
}

export function useSavePayGrade() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PayGradeInput) => hrSetupApi.savePayGrade(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hr', 'setup'] }),
        queryClient.invalidateQueries({ queryKey: ['hr', 'employee-setup'] }),
      ])
    },
  })
}

export function useSetSetupArchived() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetSetupArchivedInput) => hrSetupApi.setArchived(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hr', 'setup'] }),
        queryClient.invalidateQueries({ queryKey: ['hr', 'employee-setup'] }),
      ])
    },
  })
}
