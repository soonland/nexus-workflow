import { describe, it, expect } from 'vitest'
import { parseStreamEntry } from '@/lib/redisConsumer'

const event = { type: 'ProcessInstanceTerminated', instanceId: 'inst-1' }

describe('parseStreamEntry', () => {
  it('returns the event of an entry that belongs to this tenant', () => {
    const fields = ['type', event.type, 'data', JSON.stringify(event), 'tenantId', 'nexus-erp']
    expect(parseStreamEntry(fields, 'nexus-erp')).toEqual(event)
  })

  it("ignores another tenant's entries", () => {
    const fields = ['type', event.type, 'data', JSON.stringify(event), 'tenantId', 'someone-else']
    expect(parseStreamEntry(fields, 'nexus-erp')).toBeNull()
  })

  it('accepts entries without a tenantId (written before events were tagged)', () => {
    const fields = ['type', event.type, 'data', JSON.stringify(event)]
    expect(parseStreamEntry(fields, 'nexus-erp')).toEqual(event)
  })

  it('returns null for an entry without data', () => {
    expect(parseStreamEntry(['type', event.type, 'tenantId', 'nexus-erp'], 'nexus-erp')).toBeNull()
  })

  it('throws on malformed JSON so the caller can log it', () => {
    expect(() => parseStreamEntry(['data', '{oops', 'tenantId', 'nexus-erp'], 'nexus-erp')).toThrow()
  })
})
