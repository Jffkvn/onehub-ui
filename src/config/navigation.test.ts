import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPermittedNav, NAV_ITEMS } from './navigation'

// Read authoritative PERMISSIONS.txt list
const permissionsPath = resolve(__dirname, '../_contract/PERMISSIONS.txt')
const validPermissions = readFileSync(permissionsPath, 'utf-8')
  .split('\n')
  .map((p) => p.trim())
  .filter(Boolean)

describe('Navigation Config & Permissions Gating', () => {
  it('CRITICAL: every single permission string referenced in NAV_ITEMS must exist in PERMISSIONS.txt', () => {
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
    expect(overviewItems).toEqual(['/dashboard', '/my'])
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

  it('omits empty sections when no items are permitted in that section', () => {
    const nav = getPermittedNav([])
    const sectionNames = nav.map((n) => n.section)
    expect(sectionNames).toEqual(['Overview'])
  })
})
