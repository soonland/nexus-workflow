import { Hono } from 'hono'
import { parseBpmn, DefinitionError } from 'nexus-workflow-core'
import type { StateStore } from 'nexus-workflow-core'

interface XmlStore {
  saveDefinitionXml(id: string, version: number, xml: string): Promise<void>
  getDefinitionXml(id: string, version?: number): Promise<string | null>
  deleteDefinition(id: string): Promise<void>
}

export function createDefinitionsRouter(store: StateStore, xmlStore: XmlStore): Hono {
  const app = new Hono()

  // POST /definitions — upload BPMN XML, parse, store, return summary
  app.post('/', async (c) => {
    const xml = await c.req.text()

    let result
    try {
      result = parseBpmn(xml)
    } catch (e) {
      if (e instanceof DefinitionError) {
        return c.json({ error: 'DEFINITION_ERROR', message: e.message }, 400)
      }
      throw e
    }

    if (result.definition === null) {
      return c.json(
        {
          error: 'VALIDATION_FAILED',
          message: 'Process definition has validation errors',
          details: result.errors,
        },
        422,
      )
    }

    await store.saveDefinition(result.definition)
    await xmlStore.saveDefinitionXml(result.definition.id, result.definition.version, xml)

    const { id, version, name, deployedAt, isDeployable } = result.definition
    return c.json(
      {
        id,
        version,
        name,
        deployedAt,
        isDeployable,
        validationWarnings: result.errors,
      },
      201,
    )
  })

  // GET /definitions — list all definitions (summaries)
  app.get('/', async (c) => {
    const isDeployableParam = c.req.query('isDeployable')
    const filter: { isDeployable?: boolean } = {}
    if (isDeployableParam !== undefined) {
      filter.isDeployable = isDeployableParam === 'true'
    }

    const definitions = await store.listDefinitions(filter)
    return c.json(definitions)
  })

  // GET /definitions/:id/xml — return raw BPMN XML for a definition
  app.get('/:id/xml', async (c) => {
    const id = c.req.param('id')
    const versionParam = c.req.query('version')
    const version = versionParam !== undefined ? Number.parseInt(versionParam, 10) : undefined

    const xml = await xmlStore.getDefinitionXml(id, version)
    if (xml === null) {
      return c.json({ error: 'NOT_FOUND', message: `Definition '${id}' not found or has no stored XML` }, 404)
    }

    return c.text(xml, 200, { 'Content-Type': 'application/xml' })
  })

  // GET /definitions/:id — get latest (or specific version) of a definition
  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const versionParam = c.req.query('version')
    const version = versionParam !== undefined ? Number.parseInt(versionParam, 10) : undefined

    const definition = await store.getDefinition(id, version)
    if (definition === null) {
      return c.json({ error: 'NOT_FOUND', message: `Definition '${id}' not found` }, 404)
    }

    return c.json(definition)
  })

  // DELETE /definitions/:id — delete all versions of a definition
  app.delete('/:id', async (c) => {
    const id = c.req.param('id')

    const definition = await store.getDefinition(id)
    if (!definition) {
      return c.json({ error: 'NOT_FOUND', message: `Definition '${id}' not found` }, 404)
    }

    const [pending, active, suspended] = await Promise.all([
      store.findInstances({ definitionId: id, status: 'pending', page: 0, pageSize: 1 }),
      store.findInstances({ definitionId: id, status: 'active', page: 0, pageSize: 1 }),
      store.findInstances({ definitionId: id, status: 'suspended', page: 0, pageSize: 1 }),
    ])

    const blockedCount = pending.total + active.total + suspended.total
    if (blockedCount > 0) {
      return c.json(
        { error: 'HAS_ACTIVE_INSTANCES', message: `Definition '${id}' has ${blockedCount} pending, active, or suspended instance(s)` },
        409,
      )
    }

    await xmlStore.deleteDefinition(id)
    return c.json({ deleted: id })
  })

  return app
}
