import { useState } from 'react'
import {
  LayoutDashboard,
  Users,
  Calendar,
  Award,
  BookOpen,
  DollarSign,
  Receipt,
  FolderKanban,
  Package,
  Wallet,
  FileText,
  Settings,
  ShieldCheck,
  Plus,
  Filter,
  Send,
  Eye,
  MoreHorizontal,
  Briefcase,
  UserCheck,
  RotateCcw,
} from 'lucide-react'

// Primitives
import { Button } from '@/components/ui/Button'
import { StatusPill, Badge } from '@/components/ui/StatusPill'
import { Input, Textarea, FormGroup } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Combobox } from '@/components/ui/Combobox'
import { MultiCombobox } from '@/components/ui/MultiCombobox'
import { Checkbox, Switch, RadioGroup } from '@/components/ui/Toggles'
import { Dialog } from '@/components/ui/Dialog'
import { DropdownMenu } from '@/components/ui/DropdownMenu'
import { Tabs, Tooltip, Avatar } from '@/components/ui/Wrappers'
import { useToast } from '@/components/ui/Toast'

// Archetypes
import { AppShell } from '@/components/patterns/AppShell'
import { PageHeader } from '@/components/patterns/PageHeader'
import { KpiCard } from '@/components/patterns/KpiCard'
import { DataTable, type ColumnDef } from '@/components/patterns/DataTable'
import { DetailSlideOver } from '@/components/patterns/DetailSlideOver'
import { AlertsCard } from '@/components/patterns/AlertsCard'
import { QuickActionsCard } from '@/components/patterns/QuickActionsCard'
import { FormSection } from '@/components/patterns/FormSection'

// Sample Navigation Config for OneHub (HR Admin)
const SAMPLE_NAV_GROUPS = [
  {
    title: 'OVERVIEW',
    items: [
      { id: 'dash', label: 'Dashboard', path: '/_showcase', icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: 'work', label: 'My Workspace', path: '/workspace', icon: <Briefcase className="h-4 w-4" />, badgeCount: 2, badgeTone: 'cyan' as const },
    ],
  },
  {
    title: 'PEOPLE',
    items: [
      { id: 'emp', label: 'Employees', path: '/employees', icon: <Users className="h-4 w-4" />, badgeCount: 18, badgeTone: 'violet' as const },
      { id: 'leave', label: 'Leave Requests', path: '/leave', icon: <Calendar className="h-4 w-4" />, badgeCount: 3, badgeTone: 'amber' as const },
      { id: 'perf', label: 'Performance', path: '/performance', icon: <Award className="h-4 w-4" /> },
      { id: 'train', label: 'Training', path: '/training', icon: <BookOpen className="h-4 w-4" /> },
    ],
  },
  {
    title: 'FINANCE',
    items: [
      { id: 'pay', label: 'Payroll Runs', path: '/payroll', icon: <DollarSign className="h-4 w-4" />, badgeCount: 1, badgeTone: 'emerald' as const },
      { id: 'adv', label: 'Staff Advances', path: '/advances', icon: <Receipt className="h-4 w-4" />, badgeCount: 2, badgeTone: 'amber' as const },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { id: 'proj', label: 'Projects', path: '/projects', icon: <FolderKanban className="h-4 w-4" />, badgeCount: 6, badgeTone: 'blue' as const },
      { id: 'inv', label: 'Inventory', path: '/inventory', icon: <Package className="h-4 w-4" /> },
      { id: 'cash', label: 'Project Cash', path: '/cash', icon: <Wallet className="h-4 w-4" /> },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      { id: 'rep', label: 'Reports', path: '/reports', icon: <FileText className="h-4 w-4" /> },
      { id: 'set', label: 'Settings', path: '/settings', icon: <Settings className="h-4 w-4" /> },
      { id: 'audit', label: 'Audit Log', path: '/audit', icon: <ShieldCheck className="h-4 w-4" /> },
    ],
  },
]

interface EmployeeRow {
  id: string
  name: string
  role: string
  department: string
  status: 'Active' | 'On Leave' | 'Probation'
  grossSalaryUgx: number
}

const SAMPLE_EMPLOYEES: EmployeeRow[] = [
  { id: 'EMP-001', name: 'Kato Mukasa', role: 'Senior Field Engineer', department: 'Operations', status: 'Active', grossSalaryUgx: 4850000 },
  { id: 'EMP-002', name: 'Amina Namubiru', role: 'HR Specialist', department: 'People & Culture', status: 'Active', grossSalaryUgx: 3600000 },
  { id: 'EMP-003', name: 'Denis Okello', role: 'Warehouse Manager', department: 'Logistics', status: 'On Leave', grossSalaryUgx: 3200000 },
  { id: 'EMP-004', name: 'Grace Akello', role: 'Accountant', department: 'Finance', status: 'Active', grossSalaryUgx: 4100000 },
  { id: 'EMP-005', name: 'Ivan Ssemwanga', role: 'Project Coordinator', department: 'Projects', status: 'Probation', grossSalaryUgx: 2800000 },
]

export function ShowcasePage() {
  const { toast } = useToast()
  const [dark, setDark] = useState(false)
  const [motionKey, setMotionKey] = useState(0)

  // Interactive UI states
  const [dialogOpen, setDialogOpen] = useState(false)
  const [slideOverOpen, setSlideOverOpen] = useState(false)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableEmpty, setTableEmpty] = useState(false)

  // Form states
  const [selectedDept, setSelectedDept] = useState('operations')
  const [selectedEmp, setSelectedEmp] = useState('EMP-001')
  const [selectedSkills, setSelectedSkills] = useState(['hse', 'first-aid'])
  const [checkboxVal, setCheckboxVal] = useState(true)
  const [switchVal, setSwitchVal] = useState(true)
  const [radioVal, setRadioVal] = useState('bank')

  function toggleDark() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  function replayMotion() {
    setMotionKey((prev) => prev + 1)
    toast('Motion replayed!', { description: 'Entrance animations reset.', tone: 'info' })
  }

  const columns: ColumnDef<EmployeeRow>[] = [
    {
      key: 'name',
      header: 'Employee Name',
      accessor: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} size="sm" />
          <div>
            <p className="font-semibold text-ink">{r.name}</p>
            <p className="text-[11px] text-muted">{r.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Job Title' },
    { key: 'department', header: 'Department' },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => (
        <StatusPill
          tone={
            r.status === 'Active'
              ? 'success'
              : r.status === 'On Leave'
              ? 'warning'
              : 'violet'
          }
        >
          {r.status}
        </StatusPill>
      ),
    },
    {
      key: 'grossSalaryUgx',
      header: 'Gross Salary (UGX)',
      align: 'right',
      accessor: (r) => r.grossSalaryUgx.toLocaleString('en-US'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      accessor: (r) => (
        <DropdownMenu
          trigger={
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          }
          items={[
            { key: 'view', label: 'View Details', icon: <Eye className="h-3.5 w-3.5" />, onClick: () => setSlideOverOpen(true) },
            { key: 'edit', label: 'Edit Profile', onClick: () => toast(`Editing ${r.name}`) },
            { key: 'deact', label: 'Offboard', danger: true, onClick: () => toast(`Offboarding ${r.name}`, { tone: 'danger' }) },
          ]}
        />
      ),
    },
  ]

  return (
    <AppShell
      key={motionKey}
      groups={SAMPLE_NAV_GROUPS}
      activePath="/_showcase"
      unreadNotifications={3}
      topbarActionSlot={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={replayMotion} leftIcon={<RotateCcw className="h-3.5 w-3.5" />}>
            Replay Motion
          </Button>
          <Button variant="secondary" size="sm" onClick={toggleDark}>
            {dark ? '☀ Light' : '🌙 Dark'}
          </Button>
        </div>
      }
    >
      {/* Page Header Archetype */}
      <PageHeader
        eyebrow="Egypro OneHub 2.0 Design System"
        title="Component Archetype & Primitive Showcase"
        subtitle="Live reference suite implementing modern dark navy & canvas design system for Egypro Uganda."
        actions={
          <>
            <Button variant="outline" leftIcon={<Filter className="h-4 w-4" />}>
              Filter View
            </Button>
            <Button
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => toast('New Employee modal triggered', { description: 'Demonstrating Toast primitive.', tone: 'success' })}
            >
              Add Employee
            </Button>
          </>
        }
      />

      {/* KPI Card Archetypes */}
      <section className="space-y-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
          1. KPI Grid Archetype
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="July Payroll Total"
            value={142800000}
            prefix="UGX "
            tone="emerald"
            icon={<DollarSign className="h-5 w-5" />}
            delta={{ value: '+4.2%', direction: 'up', isPositive: true }}
            subline="Approved for 18 staff"
          />
          <KpiCard
            title="Active Employees"
            value={18}
            suffix=" Headcount"
            tone="violet"
            icon={<Users className="h-5 w-5" />}
            delta={{ value: '0', direction: 'flat' }}
            subline="2 in probation review"
          />
          <KpiCard
            title="Pending Advances"
            value={4850000}
            prefix="UGX "
            tone="amber"
            icon={<Receipt className="h-5 w-5" />}
            delta={{ value: '2 Requests', direction: 'up', isPositive: false }}
            subline="Requires CFO approval"
          />
          <KpiCard
            title="Project Cash Imprest"
            value={12400000}
            prefix="UGX "
            tone="blue"
            icon={<Wallet className="h-5 w-5" />}
            delta={{ value: '-12%', direction: 'down', isPositive: false }}
            subline="6 active sites"
          />
        </div>
      </section>

      {/* Main Content Grid: Data Table + Side Cards */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left 2 Cols: Data Table Archetype */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
              2. Data Table Archetype
            </h2>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setTableLoading(!tableLoading)}>
                Toggle Loading
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setTableEmpty(!tableEmpty)}>
                Toggle Empty
              </Button>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={tableEmpty ? [] : SAMPLE_EMPLOYEES}
            keyExtractor={(r) => r.id}
            loading={tableLoading}
            emptyTitle="No Employees Found"
            emptyDescription="Try adjusting filters or adding a new employee to the roster."
            totalsRow={{
              name: 'Total Payroll Gross',
              grossSalaryUgx: (18550000).toLocaleString('en-US'),
            }}
            onRowClick={() => setSlideOverOpen(true)}
          />

          {/* FormSection Archetype */}
          <section className="space-y-4 pt-4">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
              3. Form Section Archetype &amp; Input Primitives
            </h2>
            <FormSection title="Employee Profile Information" description="Standardized form group composition with inline validation states.">
              <FormGroup label="Full Name" required hint="Legal name as on National ID">
                <Input defaultValue="Kato Mukasa" placeholder="Enter full name" />
              </FormGroup>

              <FormGroup label="Department Select" required>
                <Select
                  value={selectedDept}
                  onValueChange={setSelectedDept}
                  options={[
                    { value: 'operations', label: 'Operations & Engineering' },
                    { value: 'people', label: 'People & Culture (HR)' },
                    { value: 'finance', label: 'Finance & Accounting' },
                    { value: 'logistics', label: 'Logistics & Warehouse' },
                  ]}
                />
              </FormGroup>

              <FormGroup label="Searchable Manager (Combobox)" hint="Radix Popover with live search">
                <Combobox
                  value={selectedEmp}
                  onValueChange={setSelectedEmp}
                  options={SAMPLE_EMPLOYEES.map((e) => ({
                    value: e.id,
                    label: e.name,
                    subtitle: `${e.role} (${e.department})`,
                  }))}
                />
              </FormGroup>

              <FormGroup label="Certifications (MultiCombobox)">
                <MultiCombobox
                  values={selectedSkills}
                  onValuesChange={setSelectedSkills}
                  options={[
                    { value: 'hse', label: 'HSE Level 3' },
                    { value: 'first-aid', label: 'First Aid Certified' },
                    { value: 'rigging', label: 'Scaffolding & Rigging' },
                    { value: 'forklift', label: 'Forklift Operator' },
                  ]}
                />
              </FormGroup>

              <div className="sm:col-span-2 pt-2">
                <FormGroup label="Address Details & Comments">
                  <Textarea defaultValue="Plot 42, Jinja Road Industrial Area, Kampala, Uganda" rows={2} />
                </FormGroup>
              </div>
            </FormSection>
          </section>
        </div>

        {/* Right 1 Col: Side Cards & Interactive Triggers */}
        <div className="space-y-6">
          {/* Alerts Card Archetype */}
          <section className="space-y-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
              4. Alerts Card Archetype
            </h2>
            <AlertsCard
              title="HR Alerts &amp; Events"
              subtitle="Next 30 days"
              alerts={[
                {
                  id: 'a1',
                  title: 'Contract Ending Soon',
                  subtitle: 'Kato Mukasa · Site Engineer',
                  timestamp: 'In 5 days',
                  urgent: true,
                },
                {
                  id: 'a2',
                  title: 'Probation Review Due',
                  subtitle: 'Ivan Ssemwanga · Coordinator',
                  timestamp: 'In 12 days',
                  tone: 'violet',
                },
                {
                  id: 'a3',
                  title: 'HSE Certification Expiry',
                  subtitle: 'Denis Okello · Logistics',
                  timestamp: 'In 24 days',
                  tone: 'amber',
                },
              ]}
              onAlertClick={(a) => toast(`Clicked alert: ${a.title}`, { tone: 'info' })}
            />
          </section>

          {/* Quick Actions Card Archetype */}
          <section className="space-y-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
              5. Quick Actions Archetype
            </h2>
            <QuickActionsCard
              title="HR Quick Actions"
              actions={[
                {
                  id: 'q1',
                  label: 'Approve Staff Advance',
                  subtitle: '2 requests waiting',
                  icon: <UserCheck className="h-4 w-4" />,
                  tone: 'emerald',
                  onClick: () => setDialogOpen(true),
                },
                {
                  id: 'q2',
                  label: 'Generate Payroll Payslips',
                  subtitle: 'July 2026 run',
                  icon: <Send className="h-4 w-4" />,
                  tone: 'blue',
                  onClick: () => toast('Generating PDF Payslips...', { tone: 'info' }),
                },
                {
                  id: 'q3',
                  label: 'Open Detail SlideOver',
                  subtitle: '420ms --sheet easing',
                  icon: <Eye className="h-4 w-4" />,
                  tone: 'violet',
                  onClick: () => setSlideOverOpen(true),
                },
              ]}
            />
          </section>

          {/* Toggles & Checkboxes Primitive Demo */}
          <section className="space-y-3 rounded-lg border border-line bg-surface p-5">
            <h3 className="font-display text-xs font-bold text-ink uppercase tracking-wider border-b border-line pb-2">
              Toggle Primitives
            </h3>
            <div className="space-y-3">
              <Checkbox label="Enable SMS Payslip Notifications" checked={checkboxVal} onCheckedChange={(c) => setCheckboxVal(Boolean(c))} />
              <Switch label="Dark Mode Sync" checked={switchVal} onCheckedChange={setSwitchVal} />
              <div className="pt-2">
                <p className="text-xs font-semibold text-soft mb-1">Disbursement Method</p>
                <RadioGroup
                  value={radioVal}
                  onValueChange={setRadioVal}
                  options={[
                    { value: 'bank', label: 'Bank Transfer (Stanbic / Centenary)' },
                    { value: 'momo', label: 'MTN Mobile Money' },
                  ]}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Button Variants & Status Pills Palette */}
      <section className="space-y-4 rounded-lg border border-line bg-surface p-6">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
          6. Button Primitive Matrix &amp; Status Pills
        </h2>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary Emerald</Button>
          <Button variant="secondary">Secondary Surface</Button>
          <Button variant="outline">Outline Line</Button>
          <Button variant="ghost">Ghost Soft</Button>
          <Button variant="danger">Danger Rose</Button>
          <Button variant="primary" loading>Loading</Button>
          <Button variant="secondary" disabled>Disabled</Button>
        </div>

        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <StatusPill tone="success">Active / Approved</StatusPill>
          <StatusPill tone="warning">Pending Review</StatusPill>
          <StatusPill tone="danger">Rejected / Expired</StatusPill>
          <StatusPill tone="info">Draft State</StatusPill>
          <StatusPill tone="violet">HR Module</StatusPill>
          <StatusPill tone="neutral">Archived</StatusPill>
          <Badge tone="success">18 Active</Badge>
          <Badge tone="danger">3 Urgent</Badge>
        </div>
      </section>

      {/* Tabs & Tooltip Primitive Demo */}
      <section className="space-y-4 rounded-lg border border-line bg-surface p-6">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted">
          7. Tabs Sub-section &amp; Tooltip Primitives
        </h2>
        <div className="flex items-center gap-4 mb-2">
          <Tooltip content="Tooltip primitive with arrow anchor">
            <span className="cursor-help font-body text-xs font-semibold text-emerald-600 underline underline-offset-4">
              Hover for Tooltip
            </span>
          </Tooltip>
        </div>

        <Tabs
          tabs={[
            {
              value: 'overview',
              label: 'Overview Summary',
              content: (
                <p className="text-xs text-soft">
                  Summary section content rendered inside in-content Tabs primitive.
                </p>
              ),
            },
            {
              value: 'documents',
              label: 'Uploaded Documents',
              badge: <Badge tone="neutral">4</Badge>,
              content: (
                <p className="text-xs text-soft">
                  Contains National ID PDF, NSSF Registration, Contract Agreement.
                </p>
              ),
            },
          ]}
        />
      </section>

      {/* Interactive Modal Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Approve Staff Advance"
        description="Review and authorize emergency salary advance for Kato Mukasa."
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDialogOpen(false)
                toast('Advance Approved', { description: 'UGX 500,000 disbursed to Kato Mukasa.', tone: 'success' })
              }}
            >
              Confirm Approval
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-2">
          <div className="rounded bg-canvas p-3 text-xs text-soft space-y-1">
            <p><span className="font-bold text-ink">Employee:</span> Kato Mukasa (EMP-001)</p>
            <p><span className="font-bold text-ink">Requested Amount:</span> UGX 500,000</p>
            <p><span className="font-bold text-ink">Deduction Schedule:</span> 2 installments (Aug &amp; Sep 2026)</p>
          </div>
        </div>
      </Dialog>

      {/* Interactive Detail SlideOver Archetype */}
      <DetailSlideOver
        open={slideOverOpen}
        onOpenChange={setSlideOverOpen}
        idText="EMP-001"
        title="Kato Mukasa"
        statusPill={<StatusPill tone="success">Active Staff</StatusPill>}
        stats={[
          { label: 'DEPARTMENT', value: 'Operations & Site' },
          { label: 'GROSS SALARY', value: 'UGX 4,850,000' },
          { label: 'NSSF NUMBER', value: 'NS-8849201' },
          { label: 'TIN NUMBER', value: '100482910' },
        ]}
        sections={[
          {
            title: 'Employment Details',
            content: (
              <div className="space-y-1 text-xs">
                <p><span className="font-bold text-ink">Job Title:</span> Senior Field Engineer</p>
                <p><span className="font-bold text-ink">Hire Date:</span> 12 January 2024</p>
                <p><span className="font-bold text-ink">Bank Name:</span> Stanbic Bank Uganda (A/C: 90300184920)</p>
              </div>
            ),
          },
        ]}
        timeline={[
          { id: 't1', title: 'Salary Advance Approved (UGX 500k)', timestamp: 'Today at 09:30 AM', actor: 'Dora Agai' },
          { id: 't2', title: 'HSE Certification Renewed', timestamp: '14 July 2026', actor: 'HR Dept' },
          { id: 't3', title: 'Promoted to Senior Field Engineer', timestamp: '01 January 2026', actor: 'MD Office' },
        ]}
        footer={
          <>
            <Button variant="outline" onClick={() => setSlideOverOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setSlideOverOpen(false)
                toast('Profile updated successfully')
              }}
            >
              Save Changes
            </Button>
          </>
        }
      />
    </AppShell>
  )
}
