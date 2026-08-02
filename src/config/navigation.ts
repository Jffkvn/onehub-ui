import type { ComponentType } from 'react'
import {
  LayoutDashboard,
  UserCheck,
  Users,
  Calendar,
  Award,
  GraduationCap,
  Sliders,
  Banknote,
  Receipt,
  Calculator,
  Download,
  FolderKanban,
  Coins,
  Package,
  Box,
  Wrench,
  ClipboardList,
  ArrowDownToLine,
  FileText,
  Layers,
  ArrowUpRight,
  Clock,
  BarChart3,
  Settings,
  ShieldAlert,
  Key,
} from 'lucide-react'

export type NavSection =
  | 'Overview'
  | 'People'
  | 'Finance'
  | 'Operations'
  | 'Inventory'
  | 'Custody'
  | 'System'

export interface NavItem {
  key: string
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  section: NavSection
  permission?: string
  anyOf?: string[]
  countKey?: string
}

export const NAV_SECTIONS: NavSection[] = [
  'Overview',
  'People',
  'Finance',
  'Operations',
  'Inventory',
  'Custody',
  'System',
]

export const NAV_ITEMS: NavItem[] = [
  // ─── Overview ─────────────────────────────────────────────────────────────
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    section: 'Overview',
  },
  {
    key: 'my',
    label: 'My Workspace',
    path: '/my',
    icon: UserCheck,
    section: 'Overview',
    countKey: 'myPending',
  },

  // ─── People ───────────────────────────────────────────────────────────────
  {
    key: 'employees',
    label: 'Employees',
    path: '/people/employees',
    icon: Users,
    section: 'People',
    permission: 'employees.read',
    countKey: 'employees',
  },
  {
    key: 'leave',
    label: 'Leave',
    path: '/people/leave',
    icon: Calendar,
    section: 'People',
    permission: 'leave.manage',
    countKey: 'leavePending',
  },
  {
    key: 'performance',
    label: 'Performance',
    path: '/people/performance',
    icon: Award,
    section: 'People',
    permission: 'performance.manage',
    countKey: 'reviewsPending',
  },
  {
    key: 'training',
    label: 'Training',
    path: '/people/training',
    icon: GraduationCap,
    section: 'People',
    permission: 'training.manage',
  },
  {
    key: 'pay-grades',
    label: 'Pay Grades',
    path: '/people/pay-grades',
    icon: Sliders,
    section: 'People',
    permission: 'employees.manage_setup',
  },

  // ─── Finance ──────────────────────────────────────────────────────────────
  {
    key: 'payroll',
    label: 'Payroll Runs',
    path: '/finance/payroll',
    icon: Banknote,
    section: 'Finance',
    permission: 'payroll.read',
    countKey: 'payrollDraft',
  },
  {
    key: 'advances',
    label: 'Staff Advances',
    path: '/finance/advances',
    icon: Receipt,
    section: 'Finance',
    permission: 'staff_advances.manage',
    countKey: 'advancesActive',
  },
  {
    key: 'deductions',
    label: 'Deductions & Adj',
    path: '/finance/deductions',
    icon: Calculator,
    section: 'Finance',
    permission: 'payroll.prepare',
  },
  {
    key: 'exports',
    label: 'Statutory Exports',
    path: '/finance/exports',
    icon: Download,
    section: 'Finance',
    permission: 'payroll.export',
  },

  // ─── Operations ───────────────────────────────────────────────────────────
  {
    key: 'projects',
    label: 'Projects',
    path: '/ops/projects',
    icon: FolderKanban,
    section: 'Operations',
    anyOf: ['projects.read_all', 'projects.read_operational'],
    countKey: 'projectsActive',
  },
  {
    key: 'cash',
    label: 'Project Cash',
    path: '/ops/cash',
    icon: Coins,
    section: 'Operations',
    anyOf: ['cash_advances.manage', 'cash_advances.view_all'],
    countKey: 'cashPending',
  },

  // ─── Inventory ────────────────────────────────────────────────────────────
  {
    key: 'inventory',
    label: 'Inventory',
    path: '/inventory',
    icon: Package,
    section: 'Operations',
    permission: 'inventory.read',
  },
  {
    key: 'consumables',
    label: 'Consumables',
    path: '/inventory/consumables',
    icon: Box,
    section: 'Inventory',
    permission: 'inventory.read',
    countKey: 'consumables',
  },
  {
    key: 'equipment',
    label: 'Equipment',
    path: '/inventory/equipment',
    icon: Wrench,
    section: 'Inventory',
    permission: 'inventory.read',
    countKey: 'equipment',
  },
  {
    key: 'requests',
    label: 'Stock Requests',
    path: '/inventory/requests',
    icon: ClipboardList,
    section: 'Inventory',
    anyOf: ['inventory.approve', 'inventory.request'],
    countKey: 'stockRequests',
  },
  {
    key: 'receiving',
    label: 'Receiving',
    path: '/inventory/receiving',
    icon: ArrowDownToLine,
    section: 'Inventory',
    permission: 'inventory.receipt',
  },
  {
    key: 'ledger',
    label: 'Stock Ledger',
    path: '/inventory/ledger',
    icon: FileText,
    section: 'Inventory',
    permission: 'inventory.read',
  },
  {
    key: 'bulk',
    label: 'Bulk Tools',
    path: '/inventory/bulk',
    icon: Layers,
    section: 'Inventory',
    permission: 'inventory.adjust',
  },

  // ─── Custody ──────────────────────────────────────────────────────────────
  {
    key: 'issued',
    label: 'Issued Assets',
    path: '/custody/issued',
    icon: ArrowUpRight,
    section: 'Custody',
    permission: 'inventory.issue',
    countKey: 'issuedAssets',
  },
  {
    key: 'returns',
    label: 'Returns Due',
    path: '/custody/returns',
    icon: Clock,
    section: 'Custody',
    permission: 'inventory.issue',
    countKey: 'returnsDue',
  },

  // ─── System ───────────────────────────────────────────────────────────────
  {
    key: 'reports',
    label: 'Reports',
    path: '/system/reports',
    icon: BarChart3,
    section: 'System',
    permission: 'reports.view',
  },
  {
    key: 'settings',
    label: 'Settings',
    path: '/system/settings',
    icon: Settings,
    section: 'System',
    permission: 'company.manage',
  },
  {
    key: 'audit',
    label: 'Audit Log',
    path: '/system/audit',
    icon: ShieldAlert,
    section: 'System',
    permission: 'audit.read',
  },
  {
    key: 'users',
    label: 'User Access',
    path: '/system/users',
    icon: Key,
    section: 'System',
    permission: 'roles.read',
  },
]

export function isItemPermitted(item: NavItem, permissionKeys: string[]): boolean {
  if (!item.permission && (!item.anyOf || item.anyOf.length === 0)) {
    return true
  }
  if (item.permission && permissionKeys.includes(item.permission)) {
    return true
  }
  if (item.anyOf && item.anyOf.some((key) => permissionKeys.includes(key))) {
    return true
  }
  return false
}

export interface GroupedNavSection {
  section: NavSection
  items: NavItem[]
}

export function getPermittedNav(permissionKeys: string[]): GroupedNavSection[] {
  const permitted = NAV_ITEMS.filter((item) => isItemPermitted(item, permissionKeys))

  const grouped: GroupedNavSection[] = []
  for (const section of NAV_SECTIONS) {
    const items = permitted.filter((item) => item.section === section)
    if (items.length > 0) {
      grouped.push({ section, items })
    }
  }

  return grouped
}
