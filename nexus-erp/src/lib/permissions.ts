import type { PrismaClient } from '@prisma/client'

export const RESOURCES = ['employees', 'timesheets', 'organizations', 'groups', 'departments', 'expenses'] as const
export type Resource = typeof RESOURCES[number]

export const CRUD_ACTIONS = ['read', 'write', 'create', 'delete'] as const
export type CrudAction = typeof CRUD_ACTIONS[number]

export const RESOURCE_LABELS: Record<Resource, string> = {
  employees: 'Employees',
  timesheets: 'Timesheets',
  organizations: 'Organizations',
  groups: 'Groups',
  departments: 'Departments',
  expenses: 'Expenses',
}

export const ACTION_LABELS: Record<CrudAction, string> = {
  read: 'Read',
  write: 'Write',
  create: 'Create',
  delete: 'Delete',
}

export const WORKFLOW_PERMISSIONS: Record<string, string> = {
  'timesheets:hr-approve': 'Approve timesheets (HR)',
  'employees:approve-profile-update': 'Review profile update requests',
  'organizations:approve-status-change': 'Approve organization status changes',
  'expenses:accounting-approve': 'Approve expenses (Accounting)',
}

export async function getEffectivePermissions(userId: string, db: PrismaClient): Promise<string[]> {
  const [direct, memberships, defaultGroups, employee] = await Promise.all([
    db.userPermission.findMany({ where: { userId }, select: { permissionKey: true } }),
    db.groupMembership.findMany({
      where: { userId },
      include: { group: { include: { permissions: { select: { permissionKey: true } } } } },
    }),
    db.group.findMany({
      where: { type: 'default' },
      include: { permissions: { select: { permissionKey: true } } },
    }),
    db.employee.findFirst({
      where: { userId },
      include: { department: { include: { permissions: { select: { permissionKey: true } } } } },
    }),
  ])
  const keys = new Set<string>()
  for (const p of direct) keys.add(p.permissionKey)
  for (const m of memberships) {
    for (const p of m.group.permissions) keys.add(p.permissionKey)
  }
  for (const g of defaultGroups) {
    for (const p of g.permissions) keys.add(p.permissionKey)
  }
  if (employee?.department) {
    for (const p of employee.department.permissions) keys.add(p.permissionKey)
  }
  return [...keys]
}
