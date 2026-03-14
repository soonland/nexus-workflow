import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  RESOURCES,
  CRUD_ACTIONS,
  RESOURCE_LABELS,
  ACTION_LABELS,
  WORKFLOW_PERMISSIONS,
  getEffectivePermissions,
} from '@/lib/permissions'

// ---------------------------------------------------------------------------
// Mock PrismaClient
// ---------------------------------------------------------------------------

function makeDb(overrides: {
  userPermissionFindMany?: unknown
  groupMembershipFindMany?: unknown
  groupFindMany?: unknown
  employeeFindFirst?: unknown
} = {}): PrismaClient {
  return {
    userPermission: {
      findMany: vi.fn().mockResolvedValue(overrides.userPermissionFindMany ?? []),
    },
    groupMembership: {
      findMany: vi.fn().mockResolvedValue(overrides.groupMembershipFindMany ?? []),
    },
    group: {
      findMany: vi.fn().mockResolvedValue(overrides.groupFindMany ?? []),
    },
    employee: {
      findFirst: vi.fn().mockResolvedValue(overrides.employeeFindFirst ?? null),
    },
  } as unknown as PrismaClient
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('RESOURCES', () => {
  it('should contain exactly the expected resource identifiers', () => {
    expect(RESOURCES).toEqual(['employees', 'timesheets', 'organizations', 'groups', 'departments'])
  })
})

describe('CRUD_ACTIONS', () => {
  it('should contain exactly the expected CRUD action identifiers', () => {
    expect(CRUD_ACTIONS).toEqual(['read', 'write', 'create', 'delete'])
  })
})

describe('RESOURCE_LABELS', () => {
  it('should have a human-readable label for every resource', () => {
    for (const resource of RESOURCES) {
      expect(typeof RESOURCE_LABELS[resource]).toBe('string')
      expect(RESOURCE_LABELS[resource].length).toBeGreaterThan(0)
    }
  })

  it('should map each resource to its expected label', () => {
    expect(RESOURCE_LABELS).toEqual({
      employees: 'Employees',
      timesheets: 'Timesheets',
      organizations: 'Organizations',
      groups: 'Groups',
      departments: 'Departments',
    })
  })
})

describe('ACTION_LABELS', () => {
  it('should have a human-readable label for every CRUD action', () => {
    for (const action of CRUD_ACTIONS) {
      expect(typeof ACTION_LABELS[action]).toBe('string')
      expect(ACTION_LABELS[action].length).toBeGreaterThan(0)
    }
  })

  it('should map each action to its expected label', () => {
    expect(ACTION_LABELS).toEqual({
      read: 'Read',
      write: 'Write',
      create: 'Create',
      delete: 'Delete',
    })
  })
})

describe('WORKFLOW_PERMISSIONS', () => {
  it('should be a non-empty record with string keys and string values', () => {
    expect(typeof WORKFLOW_PERMISSIONS).toBe('object')
    expect(Object.keys(WORKFLOW_PERMISSIONS).length).toBeGreaterThan(0)
    for (const [key, value] of Object.entries(WORKFLOW_PERMISSIONS)) {
      expect(typeof key).toBe('string')
      expect(typeof value).toBe('string')
    }
  })

  it('should contain the expected workflow permission keys', () => {
    expect(WORKFLOW_PERMISSIONS).toMatchObject({
      'timesheets:hr-approve': expect.any(String),
      'employees:approve-profile-update': expect.any(String),
      'organizations:approve-status-change': expect.any(String),
    })
  })
})

// ---------------------------------------------------------------------------
// getEffectivePermissions
// ---------------------------------------------------------------------------

describe('getEffectivePermissions', () => {
  it('should return direct user permissions', async () => {
    const db = makeDb({
      userPermissionFindMany: [{ permissionKey: 'employees:read' }, { permissionKey: 'timesheets:write' }],
    })

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual(expect.arrayContaining(['employees:read', 'timesheets:write']))
    expect(perms).toHaveLength(2)
  })

  it('should merge permissions from security group memberships', async () => {
    const db = makeDb({
      groupMembershipFindMany: [
        {
          group: {
            permissions: [{ permissionKey: 'organizations:read' }, { permissionKey: 'groups:read' }],
          },
        },
      ],
    })

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual(expect.arrayContaining(['organizations:read', 'groups:read']))
  })

  it('should merge permissions from default groups', async () => {
    const db = makeDb({
      groupFindMany: [
        { permissions: [{ permissionKey: 'employees:read' }] },
        { permissions: [{ permissionKey: 'timesheets:read' }] },
      ],
    })

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual(expect.arrayContaining(['employees:read', 'timesheets:read']))
  })

  it('should merge permissions from the employee department', async () => {
    const db = makeDb({
      employeeFindFirst: {
        department: {
          permissions: [{ permissionKey: 'departments:read' }],
        },
      },
    })

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual(expect.arrayContaining(['departments:read']))
  })

  it('should deduplicate permission keys that appear in multiple sources', async () => {
    const db = makeDb({
      userPermissionFindMany: [{ permissionKey: 'employees:read' }],
      groupMembershipFindMany: [
        { group: { permissions: [{ permissionKey: 'employees:read' }] } },
      ],
      groupFindMany: [
        { permissions: [{ permissionKey: 'employees:read' }] },
      ],
      employeeFindFirst: {
        department: { permissions: [{ permissionKey: 'employees:read' }] },
      },
    })

    const perms = await getEffectivePermissions('user-1', db)

    // Despite four sources of the same key, it should appear exactly once
    expect(perms.filter(p => p === 'employees:read')).toHaveLength(1)
  })

  it('should return an empty array when the user has no permissions from any source', async () => {
    const db = makeDb()

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual([])
  })

  it('should handle an employee record with no department (null department)', async () => {
    const db = makeDb({
      employeeFindFirst: { department: null },
    })

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual([])
  })

  it('should handle a user with no employee record at all', async () => {
    const db = makeDb({
      employeeFindFirst: null,
    })

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual([])
  })

  it('should collect permissions from all four sources simultaneously', async () => {
    const db = makeDb({
      userPermissionFindMany: [{ permissionKey: 'employees:write' }],
      groupMembershipFindMany: [
        { group: { permissions: [{ permissionKey: 'timesheets:read' }] } },
      ],
      groupFindMany: [
        { permissions: [{ permissionKey: 'organizations:read' }] },
      ],
      employeeFindFirst: {
        department: { permissions: [{ permissionKey: 'departments:read' }] },
      },
    })

    const perms = await getEffectivePermissions('user-1', db)

    expect(perms).toEqual(
      expect.arrayContaining([
        'employees:write',
        'timesheets:read',
        'organizations:read',
        'departments:read',
      ]),
    )
    expect(perms).toHaveLength(4)
  })

  it('should pass the userId to each Prisma query', async () => {
    const db = makeDb()

    await getEffectivePermissions('user-42', db)

    expect((db.userPermission.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-42' } }),
    )
    expect((db.groupMembership.findMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-42' } }),
    )
    expect((db.employee.findFirst as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-42' } }),
    )
  })
})
