import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
} from 'lucide-react'

import { PageHeader } from '@/components/patterns/PageHeader'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { EmptyState } from '@/components/patterns/EmptyState'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Toggles'
import { Tabs } from '@/components/ui/Wrappers'
import { useHasPermission } from '@/modules/auth/AuthProvider'
import {
  useHrSetupRecords,
  type DepartmentSetupRecord,
  type JobTitleSetupRecord,
  type PayGradeSetupRecord,
} from '../api/setup'
import {
  DepartmentFormModal,
  JobTitleFormModal,
  PayGradeFormModal,
  SetupArchiveModal,
  type SetupArchiveTarget,
} from '../components/HrSetupFormModals'
import { formatMoney } from '../lib/formatters'

type Section = 'departments' | 'job_titles' | 'pay_grades'

type EditorState =
  | { kind: 'department'; record: DepartmentSetupRecord | null }
  | { kind: 'job_title'; record: JobTitleSetupRecord | null }
  | { kind: 'pay_grade'; record: PayGradeSetupRecord | null }
  | null

interface SetupDisplayRow {
  id: string
  code: string
  name: string
  detail: string
  dependencies: string
  archived: boolean
}

const sectionMeta: Record<Section, { label: string; addLabel: string }> = {
  departments: { label: 'Departments', addLabel: 'Add Department' },
  job_titles: { label: 'Job Titles', addLabel: 'Add Job Title' },
  pay_grades: { label: 'Pay Grades', addLabel: 'Add Pay Grade' },
}

export function HrSetupPage() {
  const navigate = useNavigate()
  const canReadEmployees = useHasPermission('employees.read')

  const { data: setup, isLoading, isError, refetch } = useHrSetupRecords()

  const [section, setSection] = useState<Section>('departments')
  const [showArchived, setShowArchived] = useState(false)
  const [editor, setEditor] = useState<EditorState>(null)
  const [archiveTarget, setArchiveTarget] = useState<SetupArchiveTarget | null>(null)

  const displayedRows = useMemo<SetupDisplayRow[]>(() => {
    if (!setup) return []

    if (section === 'departments') {
      return setup.departments
        .filter((d) => showArchived || !d.archivedAt)
        .map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          detail: d.description || 'No description',
          dependencies: `${d.currentEmployeeCount} active staff · ${d.activeJobTitleCount} active job title${d.activeJobTitleCount === 1 ? '' : 's'}`,
          archived: Boolean(d.archivedAt),
        }))
    }

    if (section === 'job_titles') {
      return setup.jobTitles
        .filter((j) => showArchived || !j.archivedAt)
        .map((j) => ({
          id: j.id,
          code: j.code,
          name: j.name,
          detail: j.departmentName ?? 'Company-wide',
          dependencies: `${j.currentEmployeeCount} current employee${j.currentEmployeeCount === 1 ? '' : 's'}`,
          archived: Boolean(j.archivedAt),
        }))
    }

    return setup.payGrades
      .filter((g) => showArchived || !g.archivedAt)
      .map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        detail: `${formatMoney(g.minimumGross, g.currencyCode, 'No min')} – ${formatMoney(g.maximumGross, g.currencyCode, 'No max')}`,
        dependencies: `${g.currentEmployeeCount} current employee${g.currentEmployeeCount === 1 ? '' : 's'}`,
        archived: Boolean(g.archivedAt),
      }))
  }, [section, setup, showArchived])

  const openCreate = () => {
    if (section === 'departments') setEditor({ kind: 'department', record: null })
    if (section === 'job_titles') setEditor({ kind: 'job_title', record: null })
    if (section === 'pay_grades') setEditor({ kind: 'pay_grade', record: null })
  }

  const openEdit = (id: string) => {
    if (!setup) return
    if (section === 'departments') {
      setEditor({
        kind: 'department',
        record: setup.departments.find((item) => item.id === id) ?? null,
      })
    } else if (section === 'job_titles') {
      setEditor({
        kind: 'job_title',
        record: setup.jobTitles.find((item) => item.id === id) ?? null,
      })
    } else {
      setEditor({
        kind: 'pay_grade',
        record: setup.payGrades.find((item) => item.id === id) ?? null,
      })
    }
  }

  const openArchive = (row: SetupDisplayRow) => {
    setArchiveTarget({
      kind:
        section === 'departments'
          ? 'department'
          : section === 'job_titles'
            ? 'job_title'
            : 'pay_grade',
      id: row.id,
      name: row.name,
      archived: row.archived,
    })
  }

  const columns: ColumnDef<SetupDisplayRow>[] = [
    {
      key: 'code',
      header: 'Code',
      accessor: (row) => <span className="font-mono font-bold text-ink">{row.code}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      accessor: (row) => (
        <span className={row.archived ? 'text-muted line-through' : 'font-semibold text-ink'}>
          {row.name}
        </span>
      ),
    },
    {
      key: 'detail',
      header:
        section === 'departments'
          ? 'Description'
          : section === 'job_titles'
            ? 'Department Scope'
            : 'Gross Range',
      accessor: (row) => <span className="whitespace-nowrap text-soft">{row.detail}</span>,
    },
    {
      key: 'dependencies',
      header: 'Usage',
      accessor: (row) => <span className="text-muted">{row.dependencies}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (row) => (
        <StatusPill tone={row.archived ? 'neutral' : 'success'} size="sm">
          {row.archived ? 'Archived' : 'Active'}
        </StatusPill>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      accessor: (row) => (
        <div className="inline-flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => openEdit(row.id)}
          >
            Edit
          </Button>
          <Button
            variant={row.archived ? 'outline' : 'ghost'}
            size="sm"
            leftIcon={
              row.archived ? (
                <RotateCcw className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5 text-rose" />
              )
            }
            onClick={() => openArchive(row)}
          >
            {row.archived ? 'Restore' : 'Archive'}
          </Button>
        </div>
      ),
    },
  ]

  const renderSectionContent = () => {
    if (isLoading) {
      return (
        <div className="rounded-lg border border-line bg-surface p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton shape="row" />
          <Skeleton shape="row" />
          <Skeleton shape="row" />
        </div>
      )
    }

    if (isError || !setup) {
      return (
        <div className="rounded-lg border border-line bg-surface p-8 shadow-xs">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            tone="rose"
            title="HR setup could not be loaded"
            description="Try again. Existing employee records have not been changed."
            action={
              <Button variant="secondary" onClick={() => void refetch()}>
                Try Again
              </Button>
            }
          />
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-xs">
          <div>
            <h2 className="font-display text-sm font-bold text-ink">
              {sectionMeta[section].label}
            </h2>
            <p className="text-xs text-muted">
              {displayedRows.length} record{displayedRows.length === 1 ? '' : 's'} shown
            </p>
          </div>

          <Switch
            checked={showArchived}
            onCheckedChange={setShowArchived}
            label="Show archived"
          />
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block">
          <DataTable
            columns={columns}
            data={displayedRows}
            keyExtractor={(row) => row.id}
            emptyTitle={`No ${sectionMeta[section].label.toLowerCase()} yet`}
            emptyDescription={`Add a ${section === 'departments' ? 'department' : section === 'job_titles' ? 'job title' : 'pay grade'} to make it selectable on employee profiles.`}
          />
        </div>

        {/* Phone Card List */}
        <div className="space-y-3 md:hidden">
          {displayedRows.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface p-6 shadow-xs">
              <EmptyState
                title={`No ${sectionMeta[section].label.toLowerCase()} yet`}
                description="Add an entry or toggle Show archived above."
              />
            </div>
          ) : (
            displayedRows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-line bg-surface p-4 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-bold text-muted">{row.code}</span>
                    <h3
                      className={
                        row.archived
                          ? 'font-display text-sm font-bold text-muted line-through'
                          : 'font-display text-sm font-bold text-ink'
                      }
                    >
                      {row.name}
                    </h3>
                  </div>
                  <StatusPill tone={row.archived ? 'neutral' : 'success'} size="sm">
                    {row.archived ? 'Archived' : 'Active'}
                  </StatusPill>
                </div>

                <div className="text-xs space-y-1 border-t border-line pt-2.5">
                  <p className="text-ink">{row.detail}</p>
                  <p className="text-muted">{row.dependencies}</p>
                </div>

                <div className="flex items-center gap-2 border-t border-line pt-2.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => openEdit(row.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openArchive(row)}
                  >
                    {row.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {canReadEmployees && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => {
              void navigate('/people/employees')
            }}
          >
            Back to Employees
          </Button>
        </div>
      )}

      <PageHeader
        eyebrow="People Structure"
        title="Pay Grades & HR Setup"
        subtitle="Define departments, job titles, and pay grades referenced on employee records."
        actions={
          <Button
            variant="primary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={openCreate}
          >
            {sectionMeta[section].addLabel}
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-xs shadow-xs">
        <Settings2 className="h-4 w-4 shrink-0 text-violet mt-0.5" />
        <p className="text-soft">
          <strong className="text-ink">Configure these lists before assigning employees.</strong>{' '}
          Archive outdated options instead of deleting so historical employment and payroll runs remain traceable.
        </p>
      </div>

      <Tabs
        value={section}
        onValueChange={(value) => setSection(value as Section)}
        tabs={[
          {
            value: 'departments',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                Departments
              </span>
            ),
            content: renderSectionContent(),
          },
          {
            value: 'job_titles',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <BriefcaseBusiness className="h-4 w-4" />
                Job Titles
              </span>
            ),
            content: renderSectionContent(),
          },
          {
            value: 'pay_grades',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <CircleDollarSign className="h-4 w-4" />
                Pay Grades
              </span>
            ),
            content: renderSectionContent(),
          },
        ]}
      />

      {/* Setup Modals */}
      <DepartmentFormModal
        open={editor?.kind === 'department'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditor(null)
        }}
        record={editor?.kind === 'department' ? editor.record : null}
      />

      <JobTitleFormModal
        open={editor?.kind === 'job_title'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditor(null)
        }}
        departments={setup?.departments ?? []}
        record={editor?.kind === 'job_title' ? editor.record : null}
      />

      <PayGradeFormModal
        open={editor?.kind === 'pay_grade'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditor(null)
        }}
        record={editor?.kind === 'pay_grade' ? editor.record : null}
      />

      <SetupArchiveModal
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
      />
    </div>
  )
}
