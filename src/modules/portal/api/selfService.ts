import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase/client'
import { createPrivateDownloadUrl } from '@/lib/security/privateFiles'
import { useAuth } from '@/modules/auth/AuthProvider'
import { mapPayrollRun } from '@/modules/payroll/api/payroll'
import type { PayrollRun } from '@/_contract/types/payroll.types'

export type SelfServiceEmploymentType =
  | 'full_time'
  | 'part_time'
  | 'casual'
  | 'intern'
  | 'contractor'

export type SelfServiceContractType =
  | 'permanent'
  | 'fixed_term'
  | 'casual'
  | 'internship'
  | 'consultancy'

export type SelfServiceProbationStatus =
  | 'not_applicable'
  | 'on_probation'
  | 'passed'
  | 'extended'
  | 'failed'

export interface SelfServiceProfile {
  id: string
  employeeNumber: string
  legalName: string
  companyEmail: string | null
  personalEmail: string | null
  workPhone: string | null
  active: boolean
  departmentName: string | null
  jobTitleName: string | null
  payGradeName: string | null
  startDate: string | null
  endDate: string | null
  employmentType: SelfServiceEmploymentType | null
  contractType: SelfServiceContractType | null
  probationEndDate: string | null
  probationStatus: SelfServiceProbationStatus | null
}

export interface SelfServiceDocument {
  id: string
  displayName: string
  documentType: string
  mimeType: string
  sizeBytes: number
  uploadedAt: string
  storagePath: string
}

export interface SelfServiceApi {
  getProfile(): Promise<SelfServiceProfile | null>
  listDocuments(): Promise<SelfServiceDocument[]>
  createDocumentDownload(document: SelfServiceDocument): Promise<string>
  listPayslips(): Promise<PayrollRun[]>
  downloadPayslip(run: PayrollRun, assertCurrent?: () => void): Promise<void>
}

type PeriodRow = {
  start_date: string
  end_date: string | null
  employment_type: SelfServiceEmploymentType
  contract_type: SelfServiceContractType
  probation_end_date: string | null
  probation_status: SelfServiceProbationStatus
  departments: { name: string } | null
  job_titles: { name: string } | null
}

type EmployeeRow = {
  id: string
  employee_number: string
  legal_name: string
  company_email: string | null
  personal_email: string | null
  work_phone: string | null
  archived_at: string | null
  employment_periods?: PeriodRow[]
}

type DocumentRow = {
  id: string
  display_name: string
  document_type: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
  storage_path: string
}

const profileSelection =
  'id, employee_number, legal_name, company_email, personal_email, work_phone, archived_at, employment_periods(start_date, end_date, employment_type, contract_type, probation_end_date, probation_status, departments(name), job_titles(name))'

const documentSelection =
  'id, display_name, document_type, mime_type, size_bytes, uploaded_at, storage_path'

function currentPeriod(periods: PeriodRow[] = []) {
  const today = new Date().toISOString().slice(0, 10)
  const sorted = [...periods].sort((a, b) => b.start_date.localeCompare(a.start_date))
  return sorted.find((period) => !period.end_date || period.end_date >= today) ?? sorted[0]
}

function mapProfile(row: EmployeeRow, payGradeName: string | null): SelfServiceProfile {
  const period = currentPeriod(row.employment_periods)
  const today = new Date().toISOString().slice(0, 10)

  return {
    id: row.id,
    employeeNumber: row.employee_number,
    legalName: row.legal_name,
    companyEmail: row.company_email,
    personalEmail: row.personal_email,
    workPhone: row.work_phone,
    active: !row.archived_at && Boolean(period && (!period.end_date || period.end_date >= today)),
    departmentName: period?.departments?.name ?? null,
    jobTitleName: period?.job_titles?.name ?? null,
    payGradeName,
    startDate: period?.start_date ?? null,
    endDate: period?.end_date ?? null,
    employmentType: period?.employment_type ?? null,
    contractType: period?.contract_type ?? null,
    probationEndDate: period?.probation_end_date ?? null,
    probationStatus: period?.probation_status ?? null,
  }
}

function mapDocument(row: DocumentRow): SelfServiceDocument {
  return {
    id: row.id,
    displayName: row.display_name,
    documentType: row.document_type,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
    storagePath: row.storage_path,
  }
}

async function currentUserId(): Promise<string | null> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) throw error
  return data.session?.user.id ?? null
}

async function getProfile(): Promise<SelfServiceProfile | null> {
  const userId = await currentUserId()
  if (!userId) return null

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('employees')
    .select(profileSelection)
    .eq('profile_id', userId)
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw error

  const afterEmployeeReadUserId = await currentUserId()
  if (afterEmployeeReadUserId !== userId) {
    throw new DOMException('Session changed while loading profile.', 'AbortError')
  }

  if (!data) return null

  const res = await client.rpc('get_my_pay_grade_name')
  if (res.error) throw res.error
  const payGradeName: unknown = res.data

  const afterRpcUserId = await currentUserId()
  if (afterRpcUserId !== userId) {
    throw new DOMException('Session changed while loading profile.', 'AbortError')
  }

  return mapProfile(
    data as unknown as EmployeeRow,
    typeof payGradeName === 'string' ? payGradeName : null,
  )
}

async function listDocuments(): Promise<SelfServiceDocument[]> {
  const profile = await getProfile()
  if (!profile) return []

  const { data, error } = await getSupabaseClient()
    .from('employee_documents')
    .select(documentSelection)
    .eq('employee_id', profile.id)
    .eq('employee_visible', true)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as unknown as DocumentRow[]).map(mapDocument)
}

async function createDocumentDownload(document: SelfServiceDocument): Promise<string> {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!envUrl) throw new Error('Supabase URL is not configured.')
  const supabaseUrl = new URL(envUrl)
  return createPrivateDownloadUrl(document.storagePath, {
    allowedOrigin: supabaseUrl.origin,
    createSignedUrl: (path, expiresIn) =>
      getSupabaseClient().storage.from('private-files').createSignedUrl(path, expiresIn),
  })
}

async function listPayslips(): Promise<PayrollRun[]> {
  const res = await getSupabaseClient().rpc('get_my_payslips')
  if (res.error) throw res.error
  const rows = (res.data ?? []) as Array<{ payload: Record<string, unknown> }>
  return rows.map((row) => mapPayrollRun(row.payload))
    .filter((run) => run.status === 'approved' && run.items.length === 1)
}

async function downloadPayslip(run: PayrollRun, assertCurrent?: () => void): Promise<void> {
  assertCurrent?.()
  const [item] = run.items
  if (!item || run.status !== 'approved' || run.items.length !== 1) {
    throw new Error('Payslip data is unavailable')
  }
  const { error } = await getSupabaseClient().rpc('record_payroll_export', {
    target_run_id: run.id,
    target_item_id: item.id,
    export_kind: 'payslip',
  })
  assertCurrent?.()
  if (error) throw error
  const { downloadPayslip: downloadPayslipPdf } = await import(
    '@/modules/payroll/exports/payslip'
  )
  assertCurrent?.()
  await downloadPayslipPdf(run, item, assertCurrent)
}

export const selfServiceApi: SelfServiceApi = {
  getProfile,
  listDocuments,
  createDocumentDownload,
  listPayslips,
  downloadPayslip,
}

export function useMyProfile() {
  const auth = useAuth()
  const identityKey = auth.session?.userId ?? auth.access?.profile?.id ?? null
  const authEpoch = auth.authEpoch ?? 0
  const isAuthReady = auth.status ? auth.status === 'authenticated' : Boolean(identityKey)
  const latestAuthRef = useRef({ identityKey, authEpoch, isAuthReady })
  latestAuthRef.current = { identityKey, authEpoch, isAuthReady }

  return useQuery({
    queryKey: ['portal', 'self-service-profile', identityKey ?? 'anonymous', authEpoch],
    enabled: isAuthReady && Boolean(identityKey),
    queryFn: async ({ signal }) => {
      if (!identityKey || !isAuthReady || signal.aborted) {
        throw new DOMException('Authenticated session is unavailable.', 'AbortError')
      }

      const profile = await selfServiceApi.getProfile()
      const latest = latestAuthRef.current
      if (
        signal.aborted ||
        !latest.isAuthReady ||
        latest.identityKey !== identityKey ||
        latest.authEpoch !== authEpoch
      ) {
        throw new DOMException('Account session changed before profile loaded.', 'AbortError')
      }

      return profile
    },
  })
}
