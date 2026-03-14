import { describe, it, expect } from 'vitest'
import type { Session } from 'next-auth'
import { canEditIdentity, canEditContact } from '@/lib/orgAccess'

// Minimal Session factory — only the fields the functions under test read.
function makeSession(role: string, employeeId?: string | null): Session {
  return {
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com', role, employeeId },
    expires: '2099-01-01',
  } as Session
}

describe('canEditIdentity', () => {
  it('should return true when the user role is manager', () => {
    expect(canEditIdentity(makeSession('manager'))).toBe(true)
  })

  it('should return false when the user role is employee', () => {
    expect(canEditIdentity(makeSession('employee'))).toBe(false)
  })

  it('should return false when the user role is admin', () => {
    expect(canEditIdentity(makeSession('admin'))).toBe(false)
  })

  it('should return false when the user role is an empty string', () => {
    expect(canEditIdentity(makeSession(''))).toBe(false)
  })
})

describe('canEditContact', () => {
  it('should return true when the user role is manager regardless of ownerId', () => {
    expect(canEditContact(makeSession('manager', 'emp-999'), 'emp-other')).toBe(true)
  })

  it('should return true when the user role is manager and ownerId is null', () => {
    expect(canEditContact(makeSession('manager'), null)).toBe(true)
  })

  it('should return true when the user is not manager but employeeId matches ownerId', () => {
    expect(canEditContact(makeSession('employee', 'emp-42'), 'emp-42')).toBe(true)
  })

  it('should return false when the user is not manager and employeeId does not match ownerId', () => {
    expect(canEditContact(makeSession('employee', 'emp-42'), 'emp-99')).toBe(false)
  })

  it('should return false when ownerId is null and the user is not manager', () => {
    expect(canEditContact(makeSession('employee', 'emp-42'), null)).toBe(false)
  })

  it('should return false when the user has no employeeId and is not manager', () => {
    expect(canEditContact(makeSession('employee', null), 'emp-42')).toBe(false)
  })

  it('should return true when both employeeId and ownerId are null because null === null satisfies the owner check', () => {
    // employeeId (null) === ownerId (null) → ownership condition is truthy
    expect(canEditContact(makeSession('employee', null), null)).toBe(true)
  })
})
