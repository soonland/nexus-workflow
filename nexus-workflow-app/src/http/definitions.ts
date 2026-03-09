import { Hono } from 'hono'
import { parseBpmn, DefinitionError } from 'nexus-workflow-core'
import type { StateStore } from 'nexus-workflow-core'

export function createDefinitionsRouter(store: StateStore): Hono {
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

  // GET /definitions/:id — get latest (or specific version) of a definition
  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const versionParam = c.req.query('version')
    const version = versionParam !== undefined ? parseInt(versionParam, 10) : undefined

    const definition = await store.getDefinition(id, version)
    if (definition === null) {
      return c.json({ error: 'NOT_FOUND', message: `Definition '${id}' not found` }, 404)
    }

    return c.json(definition)
  })

  return app
}
