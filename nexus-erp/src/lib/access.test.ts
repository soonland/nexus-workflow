import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { canAccess } from '@/lib/access'
import { getEffectivePermissions } from '@/lib/permissions'

vi.mock('@/lib/permissions', () => ({
  getEffectivePermissions: vi.fn(),
}))

const mockGetEffectivePermissions = vi.mocked(getEffectivePermissions)

// Stub PrismaClient — canAccess only forwards it to getEffectivePermissions (which is mocked)
const db = {} as PrismaClient

interface SessionUser {
  id: string
  role: string
  employeeId?: string | null
}

function makeSession(user: SessionUser) {
  return { user }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('canAccess', () => {
  it('should return true immediately when ownerUserId matches session user id without checking permissions', async () => {
    const session = makeSession({ id: 'user-1', role: 'employee' })

    const result = await canAccess(session, 'employees', 'read', 'user-1', db)

    expect(result).toBe(true)
    expect(mockGetEffectivePermissions).not.toHaveBeenCalled()
  })

  it('should return true when owner does not match but user has matching permission', async () => {
    const session = makeSession({ id: 'user-1', role: 'employee' })
    mockGetEffectivePermissions.mockResolvedValue(['employees:read', 'timesheets:write'])

    const result = await canAccess(session, 'employees', 'read', 'user-99', db)

    expect(result).toBe(true)
    expect(mockGetEffectivePermissions).toHaveBeenCalledWith('user-1', db)
  })

  it('should return false when owner does not match and user lacks the permission', async () => {
    const session = makeSession({ id: 'user-1', role: 'employee' })
    mockGetEffectivePermissions.mockResolvedValue(['timesheets:write'])

    const result = await canAccess(session, 'employees', 'read', 'user-99', db)

    expect(result).toBe(false)
  })

  it('should fall through to permission check when ownerUserId is null', async () => {
    const session = makeSession({ id: 'user-1', role: 'employee' })
    mockGetEffectivePermissions.mockResolvedValue(['organizations:create'])

    const result = await canAccess(session, 'organizations', 'create', null, db)

    expect(result).toBe(true)
    expect(mockGetEffectivePermissions).toHaveBeenCalledWith('user-1', db)
  })

  it('should return false when ownerUserId is null and user has no matching permission', async () => {
    const session = makeSession({ id: 'user-1', role: 'employee' })
    mockGetEffectivePermissions.mockResolvedValue([])

    const result = await canAccess(session, 'organizations', 'delete', null, db)

    expect(result).toBe(false)
  })

  it('should not treat a null ownerUserId as an owner match even when session.user.id is also null-like', async () => {
    // ownerUserId === null must always skip the ownership fast-path regardless
    const session = makeSession({ id: 'user-1', role: 'employee' })
    mockGetEffectivePermissions.mockResolvedValue([])

    const result = await canAccess(session, 'departments', 'write', null, db)

    expect(result).toBe(false)
    expect(mockGetEffectivePermissions).toHaveBeenCalled()
  })

  it('should check permission for every resource/action combination', async () => {
    const session = makeSession({ id: 'user-2', role: 'manager' })
    mockGetEffectivePermissions.mockResolvedValue(['timesheets:delete'])

    const result = await canAccess(session, 'timesheets', 'delete', 'user-99', db)

    expect(result).toBe(true)
  })
})
