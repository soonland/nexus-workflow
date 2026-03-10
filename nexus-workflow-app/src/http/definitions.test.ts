import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { InMemoryStateStore } from 'nexus-workflow-core'
import type { ProcessDefinition } from 'nexus-workflow-core'
import { createDefinitionsRouter } from './definitions.js'

// ─── BPMN Fixtures ────────────────────────────────────────────────────────────

const VALID_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             targetNamespace="http://example.com">
  <process id="simple-process" name="Simple Process" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>flow-1</outgoing>
    </startEvent>
    <endEvent id="end-1">
      <incoming>flow-1</incoming>
    </endEvent>
    <sequenceFlow id="flow-1" sourceRef="start-1" targetRef="end-1"/>
  </process>
</definitions>`

const NOT_XML = `this is not xml at all {{}}`

const INVALID_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
</definitions>`

// ─── Fixture Builder ──────────────────────────────────────────────────────────

function makeDefinition(overrides: Partial<ProcessDefinition> = {}): ProcessDefinition {
  return {
    id: 'proc-1',
    version: 1,
    name: 'Test Process',
    elements: [],
    sequenceFlows: [],
    startEventId: 'start-1',
    deployedAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeployable: true,
    ...overrides,
  }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

const inMemoryXmlStore = {
  xmlMap: new Map<string, string>(),
  async saveDefinitionXml(id: string, version: number, xml: string) { this.xmlMap.set(`${id}@${version}`, xml) },
  async getDefinitionXml(id: string, version?: number) { return this.xmlMap.get(`${id}@${version ?? 1}`) ?? null },
  async deleteDefinition(id: string) { for (const key of this.xmlMap.keys()) { if (key.startsWith(`${id}@`)) this.xmlMap.delete(key) } },
}

describe('definitions HTTP API', () => {
  let store: InMemoryStateStore
  let app: Hono

  beforeEach(() => {
    store = new InMemoryStateStore()
    inMemoryXmlStore.xmlMap.clear()
    app = new Hono()
    app.route('/definitions', createDefinitionsRouter(store, inMemoryXmlStore))
  })

  // ─── POST /definitions ──────────────────────────────────────────────────────

  describe('POST /definitions', () => {
    it('201: parses and stores a valid BPMN file', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: VALID_BPMN,
        }),
      )
      expect(res.status).toBe(201)
    })

    it('201: response includes id, version, name, deployedAt, isDeployable, validationWarnings', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: VALID_BPMN,
        }),
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toHaveProperty('id')
      expect(body).toHaveProperty('version')
      expect(body).toHaveProperty('name')
      expect(body).toHaveProperty('deployedAt')
      expect(body).toHaveProperty('isDeployable')
      expect(body).toHaveProperty('validationWarnings')
      expect(Array.isArray(body.validationWarnings)).toBe(true)
    })

    it('201: response id and name match the parsed process', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: VALID_BPMN,
        }),
      )
      const body = await res.json()
      expect(body.id).toBe('simple-process')
      expect(body.name).toBe('Simple Process')
    })

    it('201: valid BPMN is marked deployable with no warnings', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: VALID_BPMN,
        }),
      )
      const body = await res.json()
      expect(body.isDeployable).toBe(true)
      expect(body.validationWarnings).toHaveLength(0)
    })

    it('201: definition is persisted in the store', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: VALID_BPMN,
        }),
      )
      expect(res.status).toBe(201)
      const stored = await store.getDefinition('simple-process')
      expect(stored).not.toBeNull()
      expect(stored!.id).toBe('simple-process')
      expect(stored!.name).toBe('Simple Process')
    })

    it('201: deployedAt in the response is a valid ISO timestamp', async () => {
      const before = Date.now()
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: VALID_BPMN,
        }),
      )
      const after = Date.now()
      const body = await res.json()
      const deployedAt = new Date(body.deployedAt).getTime()
      expect(deployedAt).toBeGreaterThanOrEqual(before)
      expect(deployedAt).toBeLessThanOrEqual(after)
    })

    it('400: returns error for malformed XML', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: NOT_XML,
        }),
      )
      expect(res.status).toBe(400)
    })

    it('400: malformed XML response includes an error message', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: NOT_XML,
        }),
      )
      const body = await res.json()
      expect(body).toHaveProperty('error')
      expect(typeof body.error).toBe('string')
      expect(body.error.length).toBeGreaterThan(0)
    })

    it('400: missing <process> element returns 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: INVALID_BPMN,
        }),
      )
      expect(res.status).toBe(400)
    })

    it('400: missing <process> element response includes error message', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: INVALID_BPMN,
        }),
      )
      const body = await res.json()
      expect(body).toHaveProperty('error')
      expect(typeof body.message).toBe('string')
      expect(body.message.length).toBeGreaterThan(0)
    })

    it('400: nothing is persisted when BPMN is structurally invalid', async () => {
      await app.fetch(
        new Request('http://localhost/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: INVALID_BPMN,
        }),
      )
      const all = await store.listDefinitions()
      expect(all).toHaveLength(0)
    })
  })

  // ─── GET /definitions ───────────────────────────────────────────────────────

  describe('GET /definitions', () => {
    it('200: returns empty array when no definitions stored', async () => {
      const res = await app.fetch(new Request('http://localhost/definitions'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(0)
    })

    it('200: returns stored definition summaries', async () => {
      await store.saveDefinition(makeDefinition())
      const res = await app.fetch(new Request('http://localhost/definitions'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(1)
    })

    it('200: each summary has id, version, name, deployedAt, isDeployable', async () => {
      await store.saveDefinition(makeDefinition())
      const res = await app.fetch(new Request('http://localhost/definitions'))
      const body = await res.json()
      const summary = body[0]
      expect(summary).toHaveProperty('id', 'proc-1')
      expect(summary).toHaveProperty('version', 1)
      expect(summary).toHaveProperty('name', 'Test Process')
      expect(summary).toHaveProperty('deployedAt')
      expect(summary).toHaveProperty('isDeployable', true)
    })

    it('200: returns multiple summaries when multiple definitions are stored', async () => {
      await store.saveDefinition(makeDefinition({ id: 'proc-1' }))
      await store.saveDefinition(makeDefinition({ id: 'proc-2' }))
      const res = await app.fetch(new Request('http://localhost/definitions'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
    })

    it('200: ?isDeployable=true filters to deployable definitions', async () => {
      await store.saveDefinition(makeDefinition({ id: 'proc-deployable', isDeployable: true }))
      await store.saveDefinition(makeDefinition({ id: 'proc-broken', isDeployable: false }))

      const res = await app.fetch(new Request('http://localhost/definitions?isDeployable=true'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(1)
      expect(body[0].id).toBe('proc-deployable')
      expect(body[0].isDeployable).toBe(true)
    })

    it('200: ?isDeployable=false filters to non-deployable definitions', async () => {
      await store.saveDefinition(makeDefinition({ id: 'proc-deployable', isDeployable: true }))
      await store.saveDefinition(makeDefinition({ id: 'proc-broken', isDeployable: false }))

      const res = await app.fetch(new Request('http://localhost/definitions?isDeployable=false'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(1)
      expect(body[0].id).toBe('proc-broken')
      expect(body[0].isDeployable).toBe(false)
    })

    it('200: ?isDeployable=true returns empty array when none are deployable', async () => {
      await store.saveDefinition(makeDefinition({ id: 'proc-broken', isDeployable: false }))

      const res = await app.fetch(new Request('http://localhost/definitions?isDeployable=true'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(0)
    })

    it('200: no filter returns both deployable and non-deployable definitions', async () => {
      await store.saveDefinition(makeDefinition({ id: 'proc-deployable', isDeployable: true }))
      await store.saveDefinition(makeDefinition({ id: 'proc-broken', isDeployable: false }))

      const res = await app.fetch(new Request('http://localhost/definitions'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
    })
  })

  // ─── GET /definitions/:id ───────────────────────────────────────────────────

  describe('GET /definitions/:id', () => {
    it('200: returns full definition by id (latest version)', async () => {
      await store.saveDefinition(makeDefinition())
      const res = await app.fetch(new Request('http://localhost/definitions/proc-1'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe('proc-1')
    })

    it('200: full definition includes elements and sequenceFlows', async () => {
      await store.saveDefinition(makeDefinition())
      const res = await app.fetch(new Request('http://localhost/definitions/proc-1'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('elements')
      expect(body).toHaveProperty('sequenceFlows')
      expect(Array.isArray(body.elements)).toBe(true)
      expect(Array.isArray(body.sequenceFlows)).toBe(true)
    })

    it('200: returns latest version when multiple versions exist', async () => {
      await store.saveDefinition(makeDefinition({ version: 1, name: 'Version 1' }))
      await store.saveDefinition(makeDefinition({ version: 2, name: 'Version 2' }))
      const res = await app.fetch(new Request('http://localhost/definitions/proc-1'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.version).toBe(2)
      expect(body.name).toBe('Version 2')
    })

    it('200: ?version=N returns exact version', async () => {
      await store.saveDefinition(makeDefinition({ version: 1, name: 'Version 1' }))
      await store.saveDefinition(makeDefinition({ version: 2, name: 'Version 2' }))

      const res = await app.fetch(new Request('http://localhost/definitions/proc-1?version=1'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.version).toBe(1)
      expect(body.name).toBe('Version 1')
    })

    it('200: ?version=N returns the specified version, not the latest', async () => {
      await store.saveDefinition(makeDefinition({ version: 1, name: 'Old Version' }))
      await store.saveDefinition(makeDefinition({ version: 2, name: 'New Version' }))

      const res = await app.fetch(new Request('http://localhost/definitions/proc-1?version=2'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.version).toBe(2)
      expect(body.name).toBe('New Version')
    })

    it('200: full definition includes startEventId', async () => {
      await store.saveDefinition(makeDefinition({ startEventId: 'start-1' }))
      const res = await app.fetch(new Request('http://localhost/definitions/proc-1'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.startEventId).toBe('start-1')
    })

    it('404: unknown id returns 404', async () => {
      const res = await app.fetch(new Request('http://localhost/definitions/does-not-exist'))
      expect(res.status).toBe(404)
    })

    it('404: unknown id response body has an error message', async () => {
      const res = await app.fetch(new Request('http://localhost/definitions/does-not-exist'))
      const body = await res.json()
      expect(body).toHaveProperty('error')
      expect(typeof body.error).toBe('string')
    })

    it('404: known id but unknown version returns 404', async () => {
      await store.saveDefinition(makeDefinition({ version: 1 }))
      const res = await app.fetch(new Request('http://localhost/definitions/proc-1?version=999'))
      expect(res.status).toBe(404)
    })

    it('404: known id but unknown version response body has an error message', async () => {
      await store.saveDefinition(makeDefinition({ version: 1 }))
      const res = await app.fetch(new Request('http://localhost/definitions/proc-1?version=999'))
      const body = await res.json()
      expect(body).toHaveProperty('error')
      expect(typeof body.error).toBe('string')
    })
  })
})
