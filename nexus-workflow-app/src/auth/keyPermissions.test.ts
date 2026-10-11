import { describe, it, expect } from 'vitest'
import { keyMayCall, keyMayRunCommand } from './keyPermissions.js'

describe('keyMayCall', () => {
  const runtime: Array<[string, string]> = [
    ['GET', '/definitions'],
    ['POST', '/definitions'],
    ['GET', '/definitions/approval'],
    ['GET', '/definitions/approval/xml'],
    ['POST', '/definitions/approval/instances'],
    ['GET', '/instances'],
    ['GET', '/instances/i-1'],
    ['GET', '/instances/i-1/events'],
    ['GET', '/instances/i-1/history'],
    ['POST', '/instances/i-1/commands'],
    ['GET', '/tasks'],
    ['GET', '/tasks/t-1'],
    ['POST', '/tasks/t-1/complete'],
    ['POST', '/tasks/t-1/claim'],
    ['POST', '/tasks/t-1/release'],
    ['POST', '/messages'],
    ['POST', '/signals'],
  ]

  it.each(runtime)('lets a service key %s %s', (method, path) => {
    expect(keyMayCall('service', method, path)).toBe(true)
  })

  const administrative: Array<[string, string]> = [
    ['DELETE', '/definitions/approval'],
    ['DELETE', '/instances/i-1'],
    ['POST', '/instances/i-1/suspend'],
    ['POST', '/instances/i-1/resume'],
    ['POST', '/instances/i-1/restart'],
    ['POST', '/instances/i-1/force'],
    ['GET', '/webhooks'],
    ['POST', '/webhooks'],
    ['DELETE', '/webhooks/w-1'],
    ['GET', '/metrics'],
  ]

  it.each(administrative)('refuses a service key %s %s', (method, path) => {
    expect(keyMayCall('service', method, path)).toBe(false)
  })

  it('refuses a service key anything it does not know about (deny by default)', () => {
    expect(keyMayCall('service', 'GET', '/some/new/route')).toBe(false)
    expect(keyMayCall('service', 'PUT', '/definitions/approval')).toBe(false)
    expect(keyMayCall('service', 'PATCH', '/tasks/t-1/complete')).toBe(false)
  })

  it('matches the whole path, not a prefix or a smuggled suffix', () => {
    expect(keyMayCall('service', 'GET', '/definitions/a/b/c')).toBe(false)
    expect(keyMayCall('service', 'GET', '/instances/i-1/events/extra')).toBe(false)
    expect(keyMayCall('service', 'POST', '/tasks/t-1/complete/../../webhooks')).toBe(false)
  })

  it('is not case-sensitive about the method', () => {
    expect(keyMayCall('service', 'get', '/definitions')).toBe(true)
  })

  it.each([...runtime, ...administrative, ['GET', '/anything']])('lets a tenant_manager key %s %s', (method, path) => {
    expect(keyMayCall('tenant_manager', method, path)).toBe(true)
  })
})

describe('keyMayRunCommand', () => {
  it.each(['SuspendInstance', 'ResumeInstance', 'CancelInstance'])('keeps %s for tenant managers', (type) => {
    expect(keyMayRunCommand('service', type)).toBe(false)
    expect(keyMayRunCommand('tenant_manager', type)).toBe(true)
  })

  it.each(['CompleteServiceTask', 'FailServiceTask', 'CompleteUserTask', 'FireTimer', 'DeliverMessage', 'BroadcastSignal'])(
    'lets a service key send %s',
    (type) => {
      expect(keyMayRunCommand('service', type)).toBe(true)
    },
  )
})
