import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/patterns/AppShell'
import { PagePlaceholder } from '@/components/patterns/PagePlaceholder'
import { Skeleton } from '@/components/ui/Skeleton'
import { RequireAuth } from '@/modules/auth/RequireAuth'
import { RequirePermission } from '@/modules/auth/RequirePermission'
import { useAuth } from '@/modules/auth/AuthProvider'
import { isItemPermitted, NAV_ITEMS } from '@/config/navigation'
import { MOCK_ROLE_PERMISSIONS } from '@/components/patterns/DevRoleSwitcher'

// Lazy-loaded pages
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

function ProtectedShellLayout() {
  return (
    <AppShell>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          {/* Overview */}
          <Route path="/dashboard" element={<PagePlaceholder title="Dashboard" task="TASK-09" />} />
          <Route path="/my" element={<PagePlaceholder title="My Workspace" task="TASK-06" />} />

          {/* People */}
          <Route element={<RequirePermission permission="employees.read" />}>
            <Route path="/people/employees" element={<PagePlaceholder title="Employees" task="TASK-05" />} />
          </Route>
          <Route element={<RequirePermission permission="leave.manage" />}>
            <Route path="/people/leave" element={<PagePlaceholder title="Leave Management" task="TASK-05" />} />
          </Route>
          <Route element={<RequirePermission permission="performance.manage" />}>
            <Route path="/people/performance" element={<PagePlaceholder title="Performance Reviews" task="TASK-05" />} />
          </Route>
          <Route element={<RequirePermission permission="training.manage" />}>
            <Route path="/people/training" element={<PagePlaceholder title="Training Programs" task="TASK-05" />} />
          </Route>
          <Route element={<RequirePermission permission="employees.manage_setup" />}>
            <Route path="/people/pay-grades" element={<PagePlaceholder title="Pay Grades & Setup" task="TASK-05" />} />
          </Route>

          {/* Finance */}
          <Route element={<RequirePermission permission="payroll.read" />}>
            <Route path="/finance/payroll" element={<PagePlaceholder title="Payroll Runs" task="TASK-04" />} />
          </Route>
          <Route element={<RequirePermission permission="staff_advances.manage" />}>
            <Route path="/finance/advances" element={<PagePlaceholder title="Staff Advances" task="TASK-04" />} />
          </Route>
          <Route element={<RequirePermission permission="payroll.prepare" />}>
            <Route path="/finance/deductions" element={<PagePlaceholder title="Deductions & Adjustments" task="TASK-04" />} />
          </Route>
          <Route element={<RequirePermission permission="payroll.export" />}>
            <Route path="/finance/exports" element={<PagePlaceholder title="Statutory Exports" task="TASK-04" />} />
          </Route>

          {/* Operations */}
          <Route element={<RequirePermission anyOf={['projects.read_all', 'projects.read_operational']} />}>
            <Route path="/ops/projects" element={<PagePlaceholder title="Projects" task="TASK-07" />} />
          </Route>
          <Route element={<RequirePermission anyOf={['cash_advances.manage', 'cash_advances.view_all']} />}>
            <Route path="/ops/cash" element={<PagePlaceholder title="Project Cash" task="TASK-07" />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.read" />}>
            <Route path="/inventory" element={<PagePlaceholder title="Inventory Overview" task="TASK-07" />} />
          </Route>

          {/* Inventory */}
          <Route element={<RequirePermission permission="inventory.read" />}>
            <Route path="/inventory/consumables" element={<PagePlaceholder title="Consumables" task="TASK-07" />} />
            <Route path="/inventory/equipment" element={<PagePlaceholder title="Equipment Assets" task="TASK-07" />} />
            <Route path="/inventory/ledger" element={<PagePlaceholder title="Stock Ledger" task="TASK-07" />} />
          </Route>
          <Route element={<RequirePermission anyOf={['inventory.approve', 'inventory.request']} />}>
            <Route path="/inventory/requests" element={<PagePlaceholder title="Stock Requests" task="TASK-07" />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.receipt" />}>
            <Route path="/inventory/receiving" element={<PagePlaceholder title="Stock Receiving" task="TASK-07" />} />
          </Route>
          <Route element={<RequirePermission permission="inventory.adjust" />}>
            <Route path="/inventory/bulk" element={<PagePlaceholder title="Bulk Tools" task="TASK-07" />} />
          </Route>

          {/* Custody */}
          <Route element={<RequirePermission permission="inventory.issue" />}>
            <Route path="/custody/issued" element={<PagePlaceholder title="Issued Assets" task="TASK-07" />} />
            <Route path="/custody/returns" element={<PagePlaceholder title="Returns Due" task="TASK-07" />} />
          </Route>

          {/* System */}
          <Route element={<RequirePermission permission="reports.view" />}>
            <Route path="/system/reports" element={<PagePlaceholder title="System Reports" task="TASK-08" />} />
          </Route>
          <Route element={<RequirePermission permission="company.manage" />}>
            <Route path="/system/settings" element={<PagePlaceholder title="Company Settings" task="TASK-08" />} />
          </Route>
          <Route element={<RequirePermission permission="audit.read" />}>
            <Route path="/system/audit" element={<PagePlaceholder title="Audit Log" task="TASK-08" />} />
          </Route>
          <Route element={<RequirePermission permission="roles.read" />}>
            <Route path="/system/users" element={<PagePlaceholder title="User Access & Roles" task="TASK-08" />} />
          </Route>

          {/* Root Redirect */}
          <Route path="/" element={<RootRedirect />} />

          {/* 404 inside Shell */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}

function RootRedirect() {
  const auth = useAuth()
  const activePermissions =
    import.meta.env.DEV && auth.devPreviewRole
      ? MOCK_ROLE_PERMISSIONS[auth.devPreviewRole]
      : auth.access?.permissionKeys ?? []

  const dashboardItem = NAV_ITEMS.find((i) => i.path === '/dashboard')
  const canDashboard = dashboardItem ? isItemPermitted(dashboardItem, activePermissions) : true

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
