import type { ServiceTaskHandler, TaskContext, TaskResult } from 'nexus-workflow-core'

/**
 * Built-in handler for `taskType: "http-call"`.
 *
 * Expected input variables:
 * - `url`     (string, required) — the URL to fetch
 * - `method`  (string, optional) — HTTP method, default "GET"
 * - `body`    (string, optional) — request body (sent as-is)
 * - `headers` (object, optional) — additional request headers
 *
 * Output variables on success:
 * - `statusCode` (number) — HTTP response status code
 * - `responseBody` (string) — response body as text
 */
export class HttpCallHandler implements ServiceTaskHandler {
  readonly taskType = 'http-call'

  async execute(ctx: TaskContext): Promise<TaskResult> {
    const url = ctx.variables['url']?.value
    if (typeof url !== 'string' || !url) {
      return {
        status: 'error',
        error: { code: 'INVALID_INPUT', message: "Missing required variable 'url'" },
      }
    }

    const method = (ctx.variables['method']?.value as string | undefined) ?? 'GET'
    const body = ctx.variables['body']?.value as string | undefined

    const headersVar = ctx.variables['headers']?.value
    const extraHeaders: Record<string, string> =
      headersVar && typeof headersVar === 'object' && !Array.isArray(headersVar)
        ? (headersVar as Record<string, string>)
        : {}

    let response: Response
    try {
      response = await fetch(url, {
        method,
        ...(body !== undefined ? { body } : {}),
        headers: extraHeaders,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { status: 'retry', error: { code: 'NETWORK_ERROR', message } }
    }

    const responseBody = await response.text()
    return {
      status: 'completed',
      outputVariables: {
        statusCode: { type: 'number', value: response.status },
        responseBody: { type: 'string', value: responseBody },
      },
    }
  }
}
