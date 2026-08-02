import { useAuth } from '@/modules/auth/AuthProvider'
import { Select } from '@/components/ui/Select'
import type { UserRole } from '@/config/modules'

export const MOCK_ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: [
    'audit.create',
    'audit.read',
    'cash_advances.manage',
    'cash_advances.request',
    'cash_advances.view_all',
    'company.manage',
    'daily_updates.create',
    'daily_updates.endorse',
    'daily_updates.read_all',
    'employee_documents.manage',
    'employee_documents.read',
    'employee_imports.manage',
    'employees.archive',
    'employees.create',
    'employees.manage_setup',
    'employees.read',
    'employees.update',
    'features.manage',
    'features.read',
    'files.manage',
    'files.read',
    'inventory.adjust',
    'inventory.approve',
    'inventory.issue',
    'inventory.manage_settings',
    'inventory.read',
    'inventory.receipt',
    'inventory.request',
    'leave.manage',
    'payroll.approve',
    'payroll.export',
    'payroll.manage_settings',
    'payroll.migrate_history',
    'payroll.prepare',
    'payroll.read',
    'payroll.record_payment',
    'payroll.self_read',
    'performance.manage',
    'performance.read_self',
    'performance.review',
    'permissions.manage',
    'permissions.read',
    'profiles.manage',
    'profiles.read',
    'projects.assign_all',
    'projects.create',
    'projects.manage',
    'projects.read_all',
    'projects.read_operational',
    'projects.update_all',
    'reports.export',
    'reports.view',
    'roles.manage',
    'roles.read',
    'staff_advances.manage',
    'staff_advances.read_self',
    'training.manage',
    'training.read_self',
  ],

  hr_admin: [
    'employees.read',
    'employees.create',
    'employees.update',
    'employees.manage_setup',
    'employee_documents.manage',
    'employee_documents.read',
    'leave.manage',
    'performance.manage',
    'training.manage',
    'payroll.read',
    'payroll.prepare',
    'payroll.export',
    'staff_advances.manage',
    'reports.view',
    'company.manage',
    'audit.read',
    'roles.read',
  ],

  warehouse_manager: [
    'inventory.read',
    'inventory.approve',
    'inventory.request',
    'inventory.receipt',
    'inventory.adjust',
    'inventory.issue',
    'inventory.manage_settings',
    'cash_advances.manage',
    'reports.view',
  ],

  cfo: [
    'payroll.read',
    'payroll.prepare',
    'payroll.approve',
    'payroll.export',
    'payroll.record_payment',
    'staff_advances.manage',
    'cash_advances.view_all',
    'cash_advances.manage',
    'reports.view',
    'reports.export',
    'company.manage',
  ],

  managing_director: [
    'projects.read_all',
    'payroll.read',
    'inventory.read',
    'cash_advances.view_all',
    'reports.view',
    'reports.export',
    'audit.read',
    'company.manage',
  ],

  project_manager: [
    'projects.read_operational',
    'projects.manage',
    'projects.create',
    'cash_advances.manage',
    'inventory.request',
    'reports.view',
  ],

  coordinator: [
    'projects.read_operational',
    'cash_advances.request',
    'inventory.request',
  ],

  employee: [
    'performance.read_self',
    'training.read_self',
    'staff_advances.read_self',
  ],
}

export function DevRoleSwitcher() {
  const auth = useAuth()

  if (!import.meta.env.DEV) return null

  return (
    <div className="flex items-center gap-2 rounded-md bg-amber-tint px-2.5 py-1 text-xs text-amber ring-1 ring-amber/30">
      <span className="font-bold uppercase tracking-wider text-[10px]">Dev Role:</span>
      <Select
        value={auth.devPreviewRole || 'live'}
        onValueChange={(val) => auth.setDevPreviewRole(val === 'live' ? null : (val as UserRole))}
        options={[
          { value: 'live', label: 'Live Session Rules' },
          { value: 'super_admin', label: 'Super Admin (All)' },
          { value: 'hr_admin', label: 'HR Administrator' },
          { value: 'warehouse_manager', label: 'Warehouse Manager' },
          { value: 'cfo', label: 'CFO / Financial Controller' },
          { value: 'managing_director', label: 'Managing Director' },
          { value: 'project_manager', label: 'Project Manager' },
          { value: 'coordinator', label: 'Operations Coordinator' },
          { value: 'employee', label: 'Standard Employee' },
        ]}
        className="h-7 border-amber/40 bg-surface/80 text-xs py-0 w-44"
      />
    </div>
  )
}
