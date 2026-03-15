import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { canViewAllExpenses } from '@/lib/expenseAccess'
import { getEffectivePermissions } from '@/lib/permissions'

vi.mock('@/lib/permissions', () => ({
  getEffectivePermissions: vi.fn(),
}))

const mockGetEffectivePermissions = vi.mocked(getEffectivePermissions)

// Stub PrismaClient — canViewAllExpenses only forwards it to getEffectivePermissions (which is mocked)
const db = {} as PrismaClient

function makeSession(id: string) {
  return { user: { id } }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('canViewAllExpenses', () => {
  it('should return true when user has expenses:accounting-approve permission', async () => {
    const session = makeSession('user-1')
    mockGetEffectivePermissions.mockResolvedValue(['expenses:accounting-approve'])

    const result = await canViewAllExpenses(session, db)

    expect(result).toBe(true)
  })

  it('should return false when user has other permissions but not expenses:accounting-approve', async () => {
    const session = makeSession('user-1')
    mockGetEffectivePermissions.mockResolvedValue(['employees:read', 'timesheets:write'])

    const result = await canViewAllExpenses(session, db)

    expect(result).toBe(false)
  })

  it('should return false when user has no permissions', async () => {
    const session = makeSession('user-1')
    mockGetEffectivePermissions.mockResolvedValue([])

    const result = await canViewAllExpenses(session, db)

    expect(result).toBe(false)
  })

  it('should call getEffectivePermissions with the correct userId and db', async () => {
    const session = makeSession('user-42')
    mockGetEffectivePermissions.mockResolvedValue(['expenses:accounting-approve'])

    await canViewAllExpenses(session, db)

    expect(mockGetEffectivePermissions).toHaveBeenCalledWith('user-42', db)
    expect(mockGetEffectivePermissions).toHaveBeenCalledTimes(1)
  })

  it('should return false when user has a similar-but-not-exact permission like expenses:read', async () => {
    const session = makeSession('user-1')
    mockGetEffectivePermissions.mockResolvedValue(['expenses:read'])

    const result = await canViewAllExpenses(session, db)

    expect(result).toBe(false)
  })
})
