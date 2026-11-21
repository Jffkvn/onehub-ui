import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import { AppShell } from '@/components/patterns/AppShell'
import { Skeleton } from '@/components/ui/Skeleton'
import { RequireAuth } from '@/modules/auth/RequireAuth'
import { RequirePermission } from '@/modules/auth/RequirePermission'
import { useAuth } from '@/modules/auth/AuthProvider'
import { CASH_ALLOWED_ROLES, isItemPermitted, isMonitorOnlyAccount, NAV_ITEMS } from '@/config/navigation'
import { MOCK_ROLE_PERMISSIONS } from '@/components/patterns/DevRoleSwitcher'

// Lazy-loaded Auth & System pages
const DashboardPage = lazy(() => import('@/modules/system/DashboardPage'))
const UserAccessPage = lazy(() => import('@/modules/system/UserAccessPage'))
const CompanySettingsPage = lazy(() => import('@/modules/system/CompanySettingsPage'))
const AuditLogPage = lazy(() => import('@/modules/system/AuditLogPage'))
const AnnouncementsPage = lazy(() => import('@/modules/announcements/AnnouncementsPage'))
const LeavePage = lazy(() => import('@/modules/leave/pages/LeavePage'))
const ReportsPage = lazy(() => import('@/modules/reports/ReportsPage'))
const PerformancePage = lazy(() => import('@/modules/performance/PerformancePage'))
const TrainingPage = lazy(() => import('@/modules/training/TrainingPage'))
const StaffAdvancesPage = lazy(() => import('@/modules/staff-advances/StaffAdvancesPage'))
const MyPayslipsPage = lazy(() => import('@/modules/portal/pages/MyPayslipsPage'))
const EmployeeImportPage = lazy(() => import('@/modules/hr/pages/EmployeeImportPage'))
const InsurancePage = lazy(() => import('@/modules/insurance/InsurancePage'))
const ReimbursementsPage = lazy(() => import('@/modules/reimbursements/ReimbursementsPage'))
const ProjectCashListPage = lazy(() =>
  import('@/modules/project-cash/ProjectCashPages').then((m) => ({ default: m.ProjectCashListPage })),
)
const ProjectCashDetailPage = lazy(() =>
  import('@/modules/project-cash/ProjectCashPages').then((m) => ({ default: m.ProjectCashDetailPage })),
)
const ProjectListPage = lazy(() =>
  import('@/modules/projects/ProjectPages').then((m) => ({ default: m.ProjectListPage })),
)
const ProjectCreatePage = lazy(() =>
  import('@/modules/projects/ProjectPages').then((m) => ({ default: m.ProjectCreatePage })),
)
const ProjectMissedUpdatesPage = lazy(() =>
  import('@/modules/projects/ProjectPages').then((m) => ({ default: m.ProjectMissedUpdatesPage })),
)
const ProjectWorkspacePage = lazy(() =>
  import('@/modules/projects/ProjectPages').then((m) => ({ default: m.ProjectWorkspacePage })),
)
const WarehouseRequestsPage = lazy(() =>
  import('@/modules/warehouse/requests/WarehouseRequests').then((m) => ({ default: m.WarehouseRequestsPage })),
)
const WarehouseRequestDetailPage = lazy(() =>
  import('@/modules/warehouse/requests/WarehouseRequests').then((m) => ({ default: m.WarehouseRequestDetailPage })),
)
const InventoryCatalogPage = lazy(() =>
  import('@/modules/warehouse/catalog/InventoryCatalogPage').then((m) => ({ default: m.InventoryCatalogPage })),
)
const EmployeeEquipmentPage = lazy(() => import('@/modules/warehouse/employee-equipment/EmployeeEquipmentPage'))
const WarehouseSettingsPage = lazy(() => import('@/modules/warehouse/settings/WarehouseSettingsPage'))
const ReceivingPage = lazy(() =>
  import('@/modules/warehouse/stock/ReceivingPage').then((m) => ({ default: m.ReceivingPage })),
)
const BulkStockPage = lazy(() =>
  import('@/modules/warehouse/stock/BulkStockPage').then((m) => ({ default: m.BulkStockPage })),
)
const StockAdjustmentPage = lazy(() =>
  import('@/modules/warehouse/stock/StockAdjustmentPage').then((m) => ({ default: m.StockAdjustmentPage })),
)
const CustodyPage = lazy(() =>
  import('@/modules/warehouse/custody/CustodyPage').then((m) => ({ default: m.CustodyPage })),
)

const LoginPage = lazy(() =>
  import('@/modules/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const InvitePage = lazy(() =>
  import('@/modules/auth/InvitePage').then((m) => ({ default: m.InvitePage })),
)
const TotpChallengePage = lazy(() =>
  import('@/modules/auth/TotpChallengePage').then((m) => ({ default: m.TotpChallengePage })),
)
const TotpEnrollmentPage = lazy(() =>
  import('@/modules/auth/TotpEnrollmentPage').then((m) => ({ default: m.TotpEnrollmentPage })),
)
const ForbiddenPage = lazy(() =>
  import('@/modules/auth/ForbiddenPage').then((m) => ({ default: m.ForbiddenPage })),
)
const NotFoundPage = lazy(() =>
  import('@/modules/auth/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)
const ShowcasePage = lazy(() =>
  import('@/pages/Showcase').then((m) => ({ default: m.ShowcasePage })),
)

// Lazy-loaded Payroll Module pages (TASK-04)
const PayrollRunsPage = lazy(() =>
  import('@/modules/payroll/pages/PayrollRunsPage').then((m) => ({
    default: m.PayrollRunsPage,
  })),
)
const PayrollRunDetailPage = lazy(() =>
  import('@/modules/payroll/pages/PayrollRunDetailPage').then((m) => ({
    default: m.PayrollRunDetailPage,
  })),
)
const StatutoryExportsPage = lazy(() =>
  import('@/modules/payroll/pages/StatutoryExportsPage').then((m) => ({
    default: m.StatutoryExportsPage,
  })),
)
const DeductionsAdjustmentsPage = lazy(() =>
  import('@/modules/payroll/pages/DeductionsAdjustmentsPage').then((m) => ({
    default: m.DeductionsAdjustmentsPage,
  })),
)

// Lazy-loaded Core HR & Employee Portal pages (Batch 2 / TASK-05a & TASK-06)
const EmployeesPage = lazy(() =>
  import('@/modules/hr/pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })),
)
const EmployeeDetailPage = lazy(() =>
  import('@/modules/hr/pages/EmployeeDetailPage').then((m) => ({
    default: m.EmployeeDetailPage,
  })),
)
const HrSetupPage = lazy(() =>
  import('@/modules/hr/pages/HrSetupPage').then((m) => ({ default: m.HrSetupPage })),
)
const MyWorkspacePage = lazy(() =>
  import('@/modules/portal/pages/MyWorkspacePage').then((m) => ({
    default: m.MyWorkspacePage,
  })),
)
const MyAttendancePage = lazy(() =>
  import('@/modules/attendance/pages/MyAttendancePage').then((m) => ({
    default: m.MyAttendancePage,
  })),
)
const AttendanceAdminPage = lazy(() =>
  import('@/modules/attendance/pages/AttendanceAdminPage').then((m) => ({
    default: m.AttendanceAdminPage,
  })),
)

// Lazy-loaded Field Services pages (Batch 5 + Batch 6 monitor placeholder)
const ServicesHomePage = lazy(() =>
  import('@/modules/field-services/pages/ServicesHomePage').then((m) => ({
    default: m.ServicesHomePage,
  })),
)
const ServiceIntakePage = lazy(() =>
  import('@/modules/field-services/pages/ServiceIntakePage').then((m) => ({
    default: m.ServiceIntakePage,
  })),
)
const ServiceDispatchPage = lazy(() =>
  import('@/modules/field-services/pages/ServiceDispatchPage').then((m) => ({
    default: m.ServiceDispatchPage,
  })),
)
const MyServiceJobsPage = lazy(() =>
  import('@/modules/field-services/pages/MyServiceJobsPage').then((m) => ({
    default: m.MyServiceJobsPage,
  })),
)
const ServiceRequestDetailPage = lazy(() =>
  import('@/modules/field-services/pages/ServiceRequestDetailPage').then((m) => ({
    default: m.ServiceRequestDetailPage,
  })),
)
const ServiceMonitorPage = lazy(() =>
  import('@/modules/field-services/pages/ServiceMonitorPage').then((m) => ({
    default: m.ServiceMonitorPage,
  })),
)

function RouteLoadingFallback() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton shape="kpi" className="w-64" />
      <Skeleton shape="card" className="h-64" />
      <Skeleton shape="row" />
      <Skeleton shape="row" />
    </div>
  )
}

function LegacyAdvanceLink({ to }: { to: string }) {
  const { search } = useLocation()
  const { advanceId } = useParams()
  const params = new URLSearchParams(search)
  if (advanceId) params.set('advance', advanceId)
  const query = params.toString()
  return <Navigate to={query ? to + '?' + query : to} replace />
}

function ProjectWorkspaceRedirect({ destination }: { destination: 'summary' | 'updates' }) {
  const { projectId = '' } = useParams()
  return <Navigate to={'/projects/' + encodeURIComponent(projectId) + '/' + destination} replace />
}

function LegacyProjectCashLink({ detail = false }: { detail?: boolean }) {
  const { advanceId } = useParams()
  const { search } = useLocation()
  const pathname = detail && advanceId ? '/ops/cash/' + encodeURIComponent(advanceId) : '/ops/cash'
  return <Navigate to={{ pathname, search }} replace />
}

function ProtectedShellLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <AppShell
      activePath={location.pathname.startsWith('/projects/') || location.pathname.startsWith('/tracker/')
        ? '/ops/projects' : location.pathname}
      onNavigate={(path) => {
        void navigate(path)
      }}
    >
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          {/* Overview (monitor-only display accounts are blocked from staff portals) */}
          <Route element={<RequirePermission disallowMonitorOnly />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/my" element={<MyWorkspacePage />} />
            <Route path="/my/profile" element={<MyWorkspacePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['attendance.clock_self', 'attendance.read_self']} disallowMonitorOnly />}>
            <Route path="/my/attendance" element={<MyAttendancePage />} />
          </Route>
          <Route element={<RequirePermission disallowMonitorOnly />}>
            <Route path="/my/leave" element={<LeavePage />} />
            <Route path="/my/payslips" element={<MyPayslipsPage />} />
          </Route>
          <Route element={<RequirePermission permission="staff_advances.read_self" disallowMonitorOnly />}>
            <Route path="/my/advances" element={<StaffAdvancesPage />} />
          </Route>
          <Route element={<RequirePermission permission="performance.read_self" disallowMonitorOnly />}>
            <Route path="/my/performance" element={<PerformancePage />} />
          </Route>
          <Route element={<RequirePermission permission="training.read_self" disallowMonitorOnly />}>
            <Route path="/my/training" element={<TrainingPage />} />
          </Route>
          <Route element={<RequirePermission permission="insurance.read_self" disallowMonitorOnly />}>
            <Route path="/my/insurance" element={<InsurancePage />} />
          </Route>
          <Route element={<RequirePermission permission="equipment_requests.read_self" disallowMonitorOnly />}>
            <Route path="/my/assets" element={<EmployeeEquipmentPage />} />
          </Route>
          <Route element={<RequirePermission permission="reimbursements.read_self" disallowMonitorOnly />}>
            <Route path="/my/reimbursements" element={<ReimbursementsPage />} />
          </Route>
          <Route path="/hr/performance" element={<Navigate to={`/people/performance${location.search}`} replace />} />
          <Route path="/hr/training" element={<Navigate to={`/people/training${location.search}`} replace />} />
          <Route path="/hr/leave" element={<Navigate to={`/people/leave${location.search}`} replace />} />
          <Route path="/workspace/advances" element={<LegacyAdvanceLink to="/my/advances" />} />
          <Route path="/hr/staff-advances/:advanceId?" element={<LegacyAdvanceLink to="/finance/advances" />} />

          <Route element={<RequirePermission permission="announcements.read" disallowMonitorOnly />}>
            <Route path="/my/announcements" element={<AnnouncementsPage />} />
          </Route>

          {/* People */}
          <Route element={<RequirePermission permission="announcements.manage" disallowMonitorOnly />}>
            <Route path="/people/announcements" element={<AnnouncementsPage manage />} />
          </Route>
          <Route element={<RequirePermission permission="employee_imports.manage" disallowMonitorOnly />}>
            <Route path="/people/employees/import" element={<EmployeeImportPage />} />
          </Route>
          <Route element={<RequirePermission permission="employees.read" />}>
            <Route path="/people/employees" element={<EmployeesPage />} />
            <Route path="/people/employees/:id" element={<EmployeeDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['attendance.read_all', 'attendance.manage', 'attendance.team_review']} />}>
            <Route path="/people/attendance" element={<AttendanceAdminPage />} />
          </Route>
          <Route element={<RequirePermission permission="leave.manage" />}>
            <Route path="/people/leave" element={<LeavePage manage />} />
          </Route>
          <Route element={<RequirePermission permission="performance.manage" />}>
            <Route path="/people/performance" element={<PerformancePage manage />} />
          </Route>
          <Route element={<RequirePermission permission="training.manage" />}>
            <Route path="/people/training" element={<TrainingPage manage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['insurance.read', 'insurance.manage']} disallowMonitorOnly />}>
            <Route path="/people/insurance" element={<InsurancePage manage />} />
          </Route>
          <Route element={<RequirePermission permission="employees.manage_setup" />}>
            <Route path="/people/pay-grades" element={<HrSetupPage />} />
          </Route>

          {/* Finance — Payroll Module (TASK-04) */}
          <Route element={<RequirePermission permission="payroll.read" />}>
            <Route path="/finance/payroll" element={<PayrollRunsPage />} />
            <Route path="/finance/payroll/:id" element={<PayrollRunDetailPage />} />
          </Route>
          <Route element={<RequirePermission permission="staff_advances.manage" />}>
            <Route path="/finance/advances" element={<StaffAdvancesPage manage />} />
          </Route>
          <Route
            element={
              <RequirePermission
                anyOf={['reimbursements.read_all', 'reimbursements.review', 'reimbursements.pay']}
                disallowMonitorOnly
              />
            }
          >
            <Route path="/finance/reimbursements" element={<ReimbursementsPage manage />} />
          </Route>
          <Route element={<RequirePermission permission="payroll.prepare" />}>
            <Route path="/finance/deductions" element={<DeductionsAdjustmentsPage />} />
          </Route>
          <Route element={<RequirePermission permission="payroll.export" />}>
            <Route path="/finance/exports" element={<StatutoryExportsPage />} />
          </Route>

          {/* Operations */}
          <Route
            element={
              <RequirePermission
                anyOf={['projects.manage', 'projects.read_all', 'projects.read', 'projects.read_operational', 'projects.create']}
                disallowMonitorOnly
              />
            }
          >
            <Route path="/ops/projects" element={<ProjectListPage />} />
            <Route path="/ops/projects/tracker" element={<ProjectListPage tracker />} />
            <Route path="/projects" element={<Navigate to="/ops/projects" replace />} />
            <Route path="/projects/:projectId" element={<ProjectWorkspaceRedirect destination="summary" />} />
            <Route path="/projects/:projectId/:projectTab" element={<ProjectWorkspacePage />} />
            <Route path="/tracker" element={<Navigate to="/ops/projects/tracker" replace />} />
            <Route path="/tracker/daily-updates" element={<Navigate to="/ops/projects/tracker" replace />} />
            <Route path="/tracker/projects/:projectId" element={<ProjectWorkspaceRedirect destination="updates" />} />
          </Route>
          <Route element={<RequirePermission permission="daily_updates.read_all" disallowMonitorOnly />}>
            <Route path="/tracker/missed-updates" element={<ProjectMissedUpdatesPage />} />
          </Route>
          <Route element={<RequirePermission permission="projects.create" disallowMonitorOnly />}>
            <Route path="/projects/new" element={<ProjectCreatePage />} />
          </Route>
          <Route
            element={
              <RequirePermission
                allowedRoles={CASH_ALLOWED_ROLES}
                anyOf={['cash_advances.manage', 'cash_advances.view_all', 'cash_advances.request']}
                disallowMonitorOnly
              />
            }
          >
            <Route path="/ops/cash" element={<ProjectCashListPage />} />
            <Route path="/ops/cash/:advanceId" element={<ProjectCashDetailPage />} />
            <Route path="/cash" element={<LegacyProjectCashLink />} />
            <Route path="/cash/advances" element={<LegacyProjectCashLink />} />
            <Route path="/cash/advances/:advanceId" element={<LegacyProjectCashLink detail />} />
          </Route>

          {/* Service Ops */}
          <Route element={<RequirePermission anyOf={['service_requests.read', 'service_visits.read_assigned']} disallowMonitorOnly />}>
            <Route path="/services" element={<ServicesHomePage />} />
            <Route path="/services/requests/:id" element={<ServiceRequestDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['service_requests.intake', 'service_requests.report_provider']} disallowMonitorOnly />}>
            <Route path="/services/intake" element={<ServiceIntakePage />} />
            <Route path="/services/intake/new" element={<ServiceIntakePage />} />
          </Route>
          <Route element={<RequirePermission permission="service_requests.read" disallowMonitorOnly />}>
            <Route path="/services/dispatch" element={<ServiceDispatchPage />} />
          </Route>
          <Route element={<RequirePermission permission="service_visits.read_assigned" disallowMonitorOnly />}>
            <Route path="/services/my-jobs" element={<MyServiceJobsPage />} />
          </Route>
          <Route element={<RequirePermission permission="service_requests.monitor" />}>
            <Route path="/services/monitor" element={<ServiceMonitorPage />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.read" />}>
            <Route path="/inventory" element={<InventoryCatalogPage view="overview" />} />
          </Route>

          {/* Inventory */}
          <Route element={<RequirePermission permission="inventory.read" />}>
            <Route path="/inventory/consumables" element={<InventoryCatalogPage view="consumables" />} />
            <Route path="/inventory/equipment" element={<InventoryCatalogPage view="equipment" />} />
            <Route path="/inventory/ledger" element={<InventoryCatalogPage view="ledger" />} />
          </Route>
          <Route element={<RequirePermission anyOf={['inventory.approve', 'inventory.request', 'inventory.issue']} />}>
            <Route path="/inventory/requests" element={<WarehouseRequestsPage />} />
            <Route path="/inventory/requests/:requestId" element={<WarehouseRequestDetailPage />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.receipt" />}>
            <Route path="/inventory/receiving" element={<ReceivingPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['inventory.receipt', 'inventory.adjust']} />}>
            <Route path="/inventory/bulk" element={<BulkStockPage />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.adjust" />}>
            <Route path="/inventory/adjustments" element={<StockAdjustmentPage />} />
          </Route>

          <Route element={<RequirePermission anyOf={['inventory.issue', 'inventory.approve']} />}>
            <Route path="/inventory/employee-requests" element={<EmployeeEquipmentPage manage />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.manage_settings" />}>
            <Route path="/inventory/settings" element={<WarehouseSettingsPage />} />
          </Route>

          {/* Custody */}
          <Route element={<RequirePermission permission="inventory.issue" />}>
            <Route path="/custody/issued" element={<CustodyPage mode="issued" />} />
            <Route path="/custody/returns" element={<CustodyPage mode="returns" />} />
          </Route>

          {/* System */}
          <Route element={<RequirePermission permission="reports.view" />}>
            <Route path="/system/reports" element={<ReportsPage />} />
          </Route>
          <Route element={<RequirePermission permission="company.manage" />}>
            <Route path="/system/settings" element={<CompanySettingsPage />} />
          </Route>
          <Route element={<RequirePermission permission="audit.read" />}>
            <Route path="/system/audit" element={<AuditLogPage />} />
          </Route>
          <Route element={<RequirePermission permission="users.read" />}>
            <Route path="/system/users" element={<UserAccessPage />} />
          </Route>

          {/* Root Redirect */}
          <Route index element={<RootRedirect />} />

          {/* 404 inside Shell */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}

function RootRedirect() {
  const auth = useAuth()
  const previewRole = import.meta.env.DEV ? auth.devPreviewRole : null
  const activeRoles = previewRole ? [previewRole] : auth.access?.roleKeys ?? []
  const activePermissions = previewRole
    ? MOCK_ROLE_PERMISSIONS[previewRole]
    : auth.access?.permissionKeys ?? []

  if (isMonitorOnlyAccount(activeRoles)) {
    return <Navigate to="/services/monitor" replace />
  }

  const dashboardItem = NAV_ITEMS.find((i) => i.path === '/dashboard')
  const canDashboard = dashboardItem
    ? isItemPermitted(dashboardItem, activePermissions, activeRoles)
    : true

  return <Navigate to={canDashboard ? '/dashboard' : '/my'} replace />
}

export function AppRouter() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        {/* Public Auth Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/mfa/enroll" element={<TotpEnrollmentPage />} />
        <Route path="/mfa/challenge" element={<TotpChallengePage />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />

        {/* Dev Showcase */}
        {import.meta.env.DEV && <Route path="/_showcase" element={<ShowcasePage />} />}

        {/* Protected App Routes */}
        <Route element={<RequireAuth />}>
          <Route path="/*" element={<ProtectedShellLayout />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
