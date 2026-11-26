import type { ComponentType } from 'react'
import type { UserRole } from './modules'
import {
  LayoutDashboard,
  UserCheck,
  Users,
  Calendar,
  CalendarCheck,
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
  Headphones,
  FilePlus2,
  Send,
  Briefcase,
  Activity,
  Megaphone,
  ShieldCheck,
  Wallet,
  Router,
} from 'lucide-react'

export type NavSection =
  | 'Home'
  | 'Service Ops'
  | 'Operations'
  | 'Inventory'
  | 'Custody'
  | 'Finance'
  | 'System'
  | 'People'
  | 'My Self-Service'

export interface NavItem {
  key: string
  label: string
  path: string
  icon: ComponentType<{ className?: string }>
  section: NavSection
  permission?: string
  anyOf?: string[]
  allowedRoles?: readonly UserRole[]
  disallowMonitorOnly?: boolean
  countKey?: string
}

export function isMonitorOnlyAccount(roleKeys?: readonly UserRole[]): boolean {
  return Boolean(roleKeys && roleKeys.length > 0 && roleKeys.every((role) => role === 'service_monitor'))
}

// Provisional pending owner decision on super_admin Cash access (matches Launch 0041_cash_advances.sql).
export const CASH_ALLOWED_ROLES: readonly UserRole[] = [
  'coordinator',
  'project_manager',
  'cfo',
  'managing_director',
]

export const NAV_SECTIONS: NavSection[] = [
  'Home',
  'Service Ops',
  'Operations',
  'Inventory',
  'Custody',
  'Finance',
  'System',
  'People',
  'My Self-Service',
]

export const NAV_ITEMS: NavItem[] = [
  // ─── Home ─────────────────────────────────────────────────────────────────
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    section: 'Home',
    disallowMonitorOnly: true,
  },

  // ─── My Self-Service ──────────────────────────────────────────────────────
  {
    key: 'my',
    label: 'My Workspace',
    path: '/my',
    icon: UserCheck,
    section: 'My Self-Service',
    disallowMonitorOnly: true,
    countKey: 'myPending',
  },
  {
    key: 'my-attendance',
    label: 'My Attendance',
    path: '/my/attendance',
    icon: Clock,
    section: 'My Self-Service',
    anyOf: ['attendance.clock_self', 'attendance.read_self'],
  },

  { key: 'my-leave', label: 'My Leave', path: '/my/leave', icon: Calendar, section: 'My Self-Service', disallowMonitorOnly: true },
  { key: 'my-payslips', label: 'My Pay', path: '/my/payslips', icon: Receipt, section: 'My Self-Service', disallowMonitorOnly: true },
  {
    key: 'my-advances',
    label: 'My Advances',
    path: '/my/advances',
    icon: Banknote,
    section: 'My Self-Service',
    permission: 'staff_advances.read_self',
    disallowMonitorOnly: true,
  },

  {
    key: 'my-performance',
    label: 'My Performance',
    path: '/my/performance',
    icon: Award,
    section: 'My Self-Service',
    permission: 'performance.read_self',
    disallowMonitorOnly: true,
  },
  {
    key: 'my-training',
    label: 'My Training',
    path: '/my/training',
    icon: GraduationCap,
    section: 'My Self-Service',
    permission: 'training.read_self',
    disallowMonitorOnly: true,
  },

  {
    key: 'my-announcements',
    label: 'Announcements',
    path: '/my/announcements',
    icon: Megaphone,
    section: 'My Self-Service',
    permission: 'announcements.read',
    disallowMonitorOnly: true,
  },
  {
    key: 'my-insurance',
    label: 'My Insurance',
    path: '/my/insurance',
    icon: ShieldCheck,
    section: 'My Self-Service',
    permission: 'insurance.read_self',
    disallowMonitorOnly: true,
  },
  {
    key: 'my-equipment',
    label: 'My Equipment',
    path: '/my/assets',
    icon: Wrench,
    section: 'My Self-Service',
    permission: 'equipment_requests.read_self',
  },
  {
    key: 'my-reimbursements',
    label: 'My Reimbursements',
    path: '/my/reimbursements',
    icon: Wallet,
    section: 'My Self-Service',
    permission: 'reimbursements.read_self',
    disallowMonitorOnly: true,
  },

  // ─── People ───────────────────────────────────────────────────────────────
  {
    key: 'manage-announcements',
    label: 'Manage Announcements',
    path: '/people/announcements',
    icon: Megaphone,
    section: 'People',
    permission: 'announcements.manage',
    disallowMonitorOnly: true,
  },
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
    key: 'attendance',
    label: 'Attendance',
    path: '/people/attendance',
    icon: CalendarCheck,
    section: 'People',
    anyOf: ['attendance.read_all', 'attendance.manage', 'attendance.team_review'],
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
  {
    key: 'insurance',
    label: 'Health Insurance',
    path: '/people/insurance',
    icon: ShieldCheck,
    section: 'People',
    anyOf: ['insurance.read', 'insurance.manage'],
    disallowMonitorOnly: true,
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
    key: 'reimbursements',
    label: 'Reimbursements',
    path: '/finance/reimbursements',
    icon: Wallet,
    section: 'Finance',
    anyOf: ['reimbursements.read_all', 'reimbursements.review', 'reimbursements.pay'],
    disallowMonitorOnly: true,
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
    anyOf: ['projects.manage', 'projects.read_all', 'projects.read', 'projects.read_operational', 'projects.create'],
    countKey: 'projectsActive',
  },
  {
    key: 'cash',
    label: 'Project Cash',
    path: '/ops/cash',
    icon: Coins,
    section: 'Operations',
    anyOf: ['cash_advances.manage', 'cash_advances.view_all', 'cash_advances.request'],
    allowedRoles: CASH_ALLOWED_ROLES,
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

  // ─── Service Ops (Batch 5 + Batch 6 Monitor boundary) ──────────────────────
  {
    key: 'services',
    label: 'Service Overview',
    path: '/services',
    icon: Headphones,
    section: 'Service Ops',
    anyOf: ['service_requests.read', 'service_visits.read_assigned'],
    disallowMonitorOnly: true,
  },
  {
    key: 'service-intake',
    label: 'Service Intake',
    path: '/services/intake',
    icon: FilePlus2,
    section: 'Service Ops',
    anyOf: ['service_requests.intake', 'service_requests.report_provider'],
    disallowMonitorOnly: true,
  },
  {
    key: 'service-dispatch',
    label: 'Dispatch & Queues',
    path: '/services/dispatch',
    icon: Send,
    section: 'Service Ops',
    permission: 'service_requests.read',
    disallowMonitorOnly: true,
  },
  {
    key: 'service-my-jobs',
    label: 'My Service Jobs',
    path: '/services/my-jobs',
    icon: Briefcase,
    section: 'Service Ops',
    permission: 'service_visits.read_assigned',
    disallowMonitorOnly: true,
  },
  {
    key: 'my-router-float',
    label: 'My Router Float',
    path: '/services/my-float',
    icon: Router,
    section: 'Service Ops',
    permission: 'service_visits.work_assigned',
    disallowMonitorOnly: true,
  },
  {
    key: 'service-monitor',
    label: 'Operations Monitor',
    path: '/services/monitor',
    icon: Activity,
    section: 'Service Ops',
    permission: 'service_requests.monitor',
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
    anyOf: ['inventory.approve', 'inventory.request', 'inventory.issue'],
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
    key: 'router-float',
    label: 'Router Float',
    path: '/inventory/router-float',
    icon: Router,
    section: 'Inventory',
    anyOf: ['router_float.read', 'inventory.issue', 'inventory.receipt'],
    disallowMonitorOnly: true,
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
    anyOf: ['inventory.receipt', 'inventory.adjust'],
  },

  {
    key: 'employee-equipment',
    label: 'Employee Equipment Requests',
    path: '/inventory/employee-requests',
    icon: ClipboardList,
    section: 'Inventory',
    anyOf: ['inventory.issue', 'inventory.approve'],
  },
  {
    key: 'warehouse-settings',
    label: 'Warehouse Approval Settings',
    path: '/inventory/settings',
    icon: Settings,
    section: 'Inventory',
    permission: 'inventory.manage_settings',
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
    permission: 'users.read',
  },
]

export function isItemPermitted(
  item: NavItem,
  permissionKeys: readonly string[],
  roleKeys?: readonly UserRole[],
): boolean {
  if (item.disallowMonitorOnly && isMonitorOnlyAccount(roleKeys)) {
    return false
  }
  if (item.allowedRoles?.length && roleKeys !== undefined) {
    if (!item.allowedRoles.some((role) => roleKeys.includes(role))) {
      return false
    }
  }
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
  hideHeader?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
}

const DEFAULT_SECTION_ORDER: NavSection[] = NAV_SECTIONS

const ROLE_SECTION_ORDER: Partial<Record<UserRole, NavSection[]>> = {
  super_admin: ['Home', 'System', 'Service Ops', 'Operations', 'Inventory', 'Custody', 'Finance', 'People', 'My Self-Service'],
  warehouse_manager: ['Home', 'Inventory', 'Custody', 'Operations', 'Service Ops', 'Finance', 'System', 'People', 'My Self-Service'],
  service_desk: ['Home', 'Service Ops', 'Inventory', 'Custody', 'Operations', 'Finance', 'System', 'People', 'My Self-Service'],
  service_coordinator: ['Home', 'Service Ops', 'Inventory', 'Custody', 'Operations', 'Finance', 'System', 'People', 'My Self-Service'],
  service_dispatch_backup: ['Home', 'Service Ops', 'Inventory', 'Custody', 'Operations', 'Finance', 'System', 'People', 'My Self-Service'],
  service_technician: ['Home', 'Service Ops', 'Inventory', 'Custody', 'Operations', 'Finance', 'System', 'People', 'My Self-Service'],
  coordinator: ['Home', 'Operations', 'Service Ops', 'Inventory', 'Custody', 'Finance', 'System', 'People', 'My Self-Service'],
  project_manager: ['Home', 'Operations', 'Service Ops', 'Inventory', 'Custody', 'Finance', 'System', 'People', 'My Self-Service'],
  cfo: ['Home', 'Finance', 'Operations', 'Inventory', 'Custody', 'Service Ops', 'System', 'People', 'My Self-Service'],
  hr_admin: ['Home', 'Finance', 'System', 'Operations', 'Service Ops', 'Inventory', 'Custody', 'People', 'My Self-Service'],
  managing_director: ['Home', 'Service Ops', 'Operations', 'Inventory', 'Custody', 'Finance', 'System', 'People', 'My Self-Service'],
  employee: ['Home', 'My Self-Service', 'Service Ops', 'Operations', 'Inventory', 'Custody', 'Finance', 'System', 'People'],
}

function orderItemsByKeys(items: NavItem[], preferredKeys: readonly string[]): NavItem[] {
  const index = new Map(preferredKeys.map((key, idx) => [key, idx]))
  return [...items].sort((a, b) => {
    const aIdx = index.get(a.key)
    const bIdx = index.get(b.key)
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx
    if (aIdx !== undefined) return -1
    if (bIdx !== undefined) return 1
    return 0
  })
}

function orderSectionItems(section: NavSection, items: NavItem[], primaryRole?: UserRole): NavItem[] {
  if (section === 'Service Ops') {
    if (primaryRole === 'service_desk') {
      return orderItemsByKeys(items, ['service-intake', 'service-dispatch', 'services', 'service-monitor'])
    }
    if (primaryRole === 'service_coordinator' || primaryRole === 'service_dispatch_backup') {
      return orderItemsByKeys(items, [
        'service-dispatch',
        'service-monitor',
        'service-intake',
        'services',
        'service-my-jobs',
        'my-router-float',
      ])
    }
    if (primaryRole === 'service_technician') {
      return orderItemsByKeys(items, ['service-my-jobs', 'my-router-float', 'services'])
    }
  }
  if (section === 'Inventory' && primaryRole === 'warehouse_manager') {
    return orderItemsByKeys(items, [
      'router-float',
      'requests',
      'employee-equipment',
      'receiving',
      'consumables',
      'equipment',
      'ledger',
      'bulk',
      'warehouse-settings',
    ])
  }
  if (section === 'Custody') {
    return orderItemsByKeys(items, ['returns', 'issued'])
  }
  if (section === 'System' && primaryRole === 'super_admin') {
    return orderItemsByKeys(items, ['users', 'settings', 'audit', 'reports'])
  }
  return items
}

export function getPermittedNav(
  permissionKeys: readonly string[],
  roleKeys?: readonly UserRole[],
): GroupedNavSection[] {
  const permitted = NAV_ITEMS.filter((item) => isItemPermitted(item, permissionKeys, roleKeys))
  const primaryRole = roleKeys?.find((role) => role !== 'employee') ?? roleKeys?.[0]
  const sectionOrder = (primaryRole ? ROLE_SECTION_ORDER[primaryRole] : undefined) ?? DEFAULT_SECTION_ORDER

  const hasWorkSections = permitted.some(
    (item) => item.section !== 'Home' && item.section !== 'My Self-Service',
  )

  const grouped: GroupedNavSection[] = []
  for (const section of sectionOrder) {
    const rawItems = permitted.filter((item) => item.section === section)
    if (rawItems.length === 0) continue

    const items = orderSectionItems(section, rawItems, primaryRole)
    if (section === 'Home') {
      grouped.push({ section, items, hideHeader: true })
    } else if (section === 'My Self-Service') {
      grouped.push({
        section,
        items,
        collapsible: true,
        defaultCollapsed: hasWorkSections,
      })
    } else {
      grouped.push({ section, items })
    }
  }

  return grouped
}
