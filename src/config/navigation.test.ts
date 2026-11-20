import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPermittedNav, NAV_ITEMS } from './navigation'

// Read authoritative PERMISSIONS.txt list plus Launch migration permissions added after snapshot
// (0039 grants projects.read; 0041 grants cash_advances.view_own; 0101 adds attendance.*; _contract/PERMISSIONS.txt stays read-only).
const permissionsPath = resolve(__dirname, '../_contract/PERMISSIONS.txt')
const contractPermissions = readFileSync(permissionsPath, 'utf-8')
  .split('\n')
  .map((p) => p.trim())
  .filter(Boolean)
const validPermissions = [
  ...new Set([
    ...contractPermissions,
    'announcements.read',
    'announcements.manage',
    'projects.read',
    'cash_advances.view_own',
    'attendance.clock_self',
    'attendance.read_self',
    'attendance.team_review',
    'attendance.read_all',
    'attendance.manage',
    'service_requests.intake',
    'service_requests.read',
    'service_requests.dispatch',
    'service_requests.review',
    'service_requests.report_provider',
    'service_requests.monitor',
    'insurance.read_self',
    'insurance.read',
    'insurance.manage',
    'reimbursements.read_self',
    'reimbursements.read_all',
    'reimbursements.review',
    'reimbursements.pay',
    'service_visits.read_assigned',
    'service_visits.work_assigned',
    'service_evidence.read',
    'service_alerts.read',
    'service_alerts.ack',
    'service_alerts.resolve',
  ]),
]

describe('Navigation Config & Permissions Gating', () => {
  it('uses navigation permissions declared in the contract or a later migration', () => {
    for (const item of NAV_ITEMS) {
      if (item.permission) {
        expect(
          validPermissions.includes(item.permission),
          `Permission "${item.permission}" on route "${item.path}" is NOT in PERMISSIONS.txt!`,
        ).toBe(true)
      }
      if (item.anyOf) {
        for (const perm of item.anyOf) {
          expect(
            validPermissions.includes(perm),
            `anyOf permission "${perm}" on route "${item.path}" is NOT in PERMISSIONS.txt!`,
          ).toBe(true)
        }
      }
    }
  })

  it('correctly gates navigation items for an Employee with minimal permissions', () => {
    const employeePermissions = ['performance.read_self', 'training.read_self']
    const nav = getPermittedNav(employeePermissions)

    const sectionNames = nav.map((n) => n.section)
    expect(sectionNames).toEqual(['Overview'])

    const overviewItems = nav.find((n) => n.section === 'Overview')?.items.map((i) => i.path)
    expect(overviewItems).toEqual(['/dashboard', '/my', '/my/leave', '/my/payslips', '/my/performance', '/my/training'])
  })

  it('gates announcement reading and management independently', () => {
    const userPaths = (permissions: string[], roles: Parameters<typeof getPermittedNav>[1]) =>
      getPermittedNav(permissions, roles).flatMap((section) => section.items.map((item) => item.path))
    const staff = userPaths(['announcements.read'], ['employee'])
    expect(staff).toContain('/my/announcements')
    expect(staff).not.toContain('/people/announcements')
    expect(userPaths(['announcements.read', 'announcements.manage'], ['hr_admin'])).toContain('/people/announcements')
    expect(userPaths(['announcements.read', 'announcements.manage'], ['service_monitor'])).not.toContain('/my/announcements')
  })

  it('correctly gates navigation for an HR Admin', () => {
    const hrPermissions = [
      'employees.read',
      'leave.manage',
      'performance.manage',
      'training.manage',
      'employees.manage_setup',
      'payroll.read',
      'staff_advances.manage',
      'payroll.prepare',
      'payroll.export',
      'reports.view',
    ]
    const nav = getPermittedNav(hrPermissions)
    const sectionNames = nav.map((n) => n.section)

    expect(sectionNames).toContain('Overview')
    expect(sectionNames).toContain('People')
    expect(sectionNames).toContain('Finance')
    expect(sectionNames).toContain('System')
    expect(sectionNames).not.toContain('Inventory')
    expect(sectionNames).not.toContain('Custody')
  })

  it('correctly gates navigation for a Warehouse Manager', () => {
    const warehousePermissions = [
      'inventory.read',
      'inventory.approve',
      'inventory.request',
      'inventory.receipt',
      'inventory.adjust',
      'inventory.issue',
      'reports.view',
    ]
    const nav = getPermittedNav(warehousePermissions)
    const sectionNames = nav.map((n) => n.section)

    expect(sectionNames).toContain('Overview')
    expect(sectionNames).toContain('Inventory')
    expect(sectionNames).toContain('Custody')
    expect(sectionNames).not.toContain('People')
    expect(sectionNames).not.toContain('Finance')
  })

  it('shows stock requests for warehouse staff with only issue permission', () => {
    const sections = getPermittedNav(['inventory.issue'], ['warehouse_manager'])
    expect(sections.flatMap((section) => section.items.map((item) => item.path))).toContain('/inventory/requests')
  })

  it('omits empty sections when no items are permitted in that section', () => {
    const nav = getPermittedNav([])
    const sectionNames = nav.map((n) => n.section)
    expect(sectionNames).toEqual(['Overview'])
  })

  it('aligns Project Cash and Projects nav with DEF-01 and Launch projects.read grants', () => {
    const coordNav = getPermittedNav(['cash_advances.request', 'projects.read'], ['coordinator'])
    const coordPaths = coordNav.flatMap((s) => s.items).map((i) => i.path)
    expect(coordPaths).toContain('/ops/projects')
    expect(coordPaths).toContain('/ops/cash')

    const cfoNav = getPermittedNav(['cash_advances.view_all', 'cash_advances.manage'], ['cfo'])
    expect(cfoNav.flatMap((s) => s.items).map((i) => i.path)).toContain('/ops/cash')

    const superAdminNav = getPermittedNav(['cash_advances.manage', 'projects.read_all'], ['super_admin'])
    expect(superAdminNav.flatMap((s) => s.items).map((i) => i.path)).not.toContain('/ops/cash')
  })

  it('gates Batch 4 Attendance self-service and team/HR register routes accurately', () => {
    const employeePaths = getPermittedNav(['attendance.clock_self', 'attendance.read_self'], ['employee'])
      .flatMap((s) => s.items)
      .map((i) => i.path)
    expect(employeePaths).toContain('/my/attendance')
    expect(employeePaths).not.toContain('/people/attendance')

    const pmPaths = getPermittedNav(
      ['attendance.clock_self', 'attendance.read_self', 'attendance.team_review'],
      ['project_manager'],
    )
      .flatMap((s) => s.items)
      .map((i) => i.path)
    expect(pmPaths).toContain('/my/attendance')
    expect(pmPaths).toContain('/people/attendance')

    const mdPaths = getPermittedNav(
      ['attendance.clock_self', 'attendance.read_self', 'attendance.read_all'],
      ['managing_director'],
    )
      .flatMap((s) => s.items)
      .map((i) => i.path)
    expect(mdPaths).toContain('/people/attendance')
  })

  it('gates Batch 5 Field Services nav and strictly isolates service_monitor accounts', () => {
    const deskNav = getPermittedNav(
      ['service_requests.intake', 'service_requests.read', 'service_requests.report_provider', 'service_visits.read_assigned', 'attendance.clock_self'],
      ['service_desk'],
    )
    const deskPaths = deskNav.flatMap((s) => s.items).map((i) => i.path)
    expect(deskPaths).toContain('/services')
    expect(deskPaths).toContain('/services/intake')
    expect(deskPaths).toContain('/services/dispatch')
    expect(deskPaths).toContain('/services/my-jobs')
    expect(deskPaths).toContain('/my/attendance')
    expect(deskPaths).not.toContain('/services/monitor')

    const monitorNav = getPermittedNav(['service_requests.monitor', 'service_alerts.read'], ['service_monitor'])
    const monitorPaths = monitorNav.flatMap((s) => s.items).map((i) => i.path)
    expect(monitorPaths).toEqual(['/services/monitor'])
  })

  it('gates Batch 7D health insurance and personal reimbursements nav and excludes service_monitor', () => {
    const empNav = getPermittedNav(['insurance.read_self', 'reimbursements.read_self'], ['employee'])
    const empPaths = empNav.flatMap((s) => s.items).map((i) => i.path)
    expect(empPaths).toContain('/my/insurance')
    expect(empPaths).toContain('/my/reimbursements')
    expect(empPaths).not.toContain('/people/insurance')
    expect(empPaths).not.toContain('/finance/reimbursements')

    const cfoNav = getPermittedNav(
      ['insurance.read', 'insurance.read_self', 'reimbursements.read_all', 'reimbursements.review', 'reimbursements.pay', 'reimbursements.read_self'],
      ['cfo'],
    )
    const cfoPaths = cfoNav.flatMap((s) => s.items).map((i) => i.path)
    expect(cfoPaths).toContain('/people/insurance')
    expect(cfoPaths).toContain('/finance/reimbursements')

    const monitorNav = getPermittedNav(
      ['service_requests.monitor', 'insurance.read', 'reimbursements.read_all'],
      ['service_monitor'],
    )
    const monitorPaths = monitorNav.flatMap((s) => s.items).map((i) => i.path)
    expect(monitorPaths).toEqual(['/services/monitor'])
  })
})
