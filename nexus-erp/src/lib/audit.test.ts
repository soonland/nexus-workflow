import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAuditLog } from './audit'
import type { PrismaClient } from '@prisma/client'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDb() {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

const BASE_PARAMS = {
  entityType: 'Employee',
  entityId: 'emp-1',
  actorId: 'user-1',
  actorName: 'Alice',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createAuditLog', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
  })

  // ── CREATE action ────────────────────────────────────────────────────────────

  it('should call db.auditLog.create with action CREATE and the provided fields', async () => {
    await createAuditLog({ db, ...BASE_PARAMS, action: 'CREATE' })

    expect(db.auditLog.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        entityType: 'Employee',
        entityId: 'emp-1',
        action: 'CREATE',
        actorId: 'user-1',
        actorName: 'Alice',
      }),
    })
  })

  it('should include after data when action is CREATE and after is provided', async () => {
    const after = { fullName: 'Alice', email: 'alice@example.com' }
    await createAuditLog({ db, ...BASE_PARAMS, action: 'CREATE', after })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.after).toEqual(after)
    expect(call.data.before).toBeUndefined()
  })

  // ── UPDATE action ────────────────────────────────────────────────────────────

  it('should include both before and after when action is UPDATE', async () => {
    const before = { fullName: 'Old Name' }
    const after = { fullName: 'New Name' }
    await createAuditLog({ db, ...BASE_PARAMS, action: 'UPDATE', before, after })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.before).toEqual(before)
    expect(call.data.after).toEqual(after)
  })

  it('should call db.auditLog.create with action UPDATE', async () => {
    await createAuditLog({
      db,
      ...BASE_PARAMS,
      action: 'UPDATE',
      before: { status: 'active' },
      after: { status: 'inactive' },
    })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.action).toBe('UPDATE')
  })

  // ── DELETE action ────────────────────────────────────────────────────────────

  it('should include before data when action is DELETE and before is provided', async () => {
    const before = { fullName: 'Alice', email: 'alice@example.com' }
    await createAuditLog({ db, ...BASE_PARAMS, action: 'DELETE', before })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.before).toEqual(before)
    expect(call.data.after).toBeUndefined()
  })

  it('should call db.auditLog.create with action DELETE', async () => {
    await createAuditLog({ db, ...BASE_PARAMS, action: 'DELETE', before: { id: 'emp-1' } })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.action).toBe('DELETE')
  })

  // ── null before / after become undefined ─────────────────────────────────────

  it('should set before to undefined when before is explicitly null', async () => {
    await createAuditLog({ db, ...BASE_PARAMS, action: 'UPDATE', before: null, after: { x: 1 } })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.before).toBeUndefined()
  })

  it('should set after to undefined when after is explicitly null', async () => {
    await createAuditLog({ db, ...BASE_PARAMS, action: 'UPDATE', before: { x: 1 }, after: null })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.after).toBeUndefined()
  })

  it('should set both before and after to undefined when both are omitted (defaults to null)', async () => {
    await createAuditLog({ db, ...BASE_PARAMS, action: 'CREATE' })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.before).toBeUndefined()
    expect(call.data.after).toBeUndefined()
  })

  // ── JSON serialisation ───────────────────────────────────────────────────────

  it('should deep-clone before and after via JSON serialisation', async () => {
    const before = { date: new Date('2024-01-01') }
    const after = { nested: { value: 42 } }
    await createAuditLog({ db, ...BASE_PARAMS, action: 'UPDATE', before, after })

    const call = (db.auditLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // JSON.parse(JSON.stringify(new Date(...))) yields a string — not the original Date
    expect(typeof call.data.before.date).toBe('string')
    expect(call.data.after).toEqual({ nested: { value: 42 } })
  })

  // ── Return value ─────────────────────────────────────────────────────────────

  it('should return undefined (Promise<void>)', async () => {
    const result = await createAuditLog({ db, ...BASE_PARAMS, action: 'CREATE' })
    expect(result).toBeUndefined()
  })
})
