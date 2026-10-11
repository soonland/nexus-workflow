import { describe, expect, it } from 'vitest'
import { describeAllowListProblem, isBlockedAddress, parseAllowedHostsEnv } from './urlPolicy.js'

describe('describeAllowListProblem', () => {
  it('accepts hosts, addresses and CIDR ranges', () => {
    expect(describeAllowListProblem(['erp.internal', '10.0.0.5', '10.1.0.0/16', 'fd00::/8'])).toBeUndefined()
  })

  it.each(['10.0.0.0/abc', '10.0.0.0/33', '::1/129', '10.0.0.0/8/8', 'erp.internal/16', 'bad host'])(
    'names the bad entry %s',
    (entry) => {
      expect(describeAllowListProblem(['erp.internal', entry])).toContain(entry)
    },
  )
})

describe('isBlockedAddress', () => {
  const strict = { allowHttp: false, allowedHosts: [] }

  it('blocks internal and non-routable address classes', () => {
    for (const a of ['127.0.0.1', '10.1.1.1', '172.31.0.1', '192.168.0.1', '100.64.0.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(a, strict)).toBe(true)
    }
  })

  it('allows public addresses', () => {
    expect(isBlockedAddress('93.184.216.34', strict)).toBe(false)
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946', strict)).toBe(false)
  })
})

describe('parseAllowedHostsEnv', () => {
  it('splits, trims and drops empties', () => {
    expect(parseAllowedHostsEnv(' a.internal, 10.0.0.0/8 ,,')).toEqual(['a.internal', '10.0.0.0/8'])
    expect(parseAllowedHostsEnv(undefined)).toEqual([])
  })
})
