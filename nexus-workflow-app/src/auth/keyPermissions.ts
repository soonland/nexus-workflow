import type { KeyRole } from './principal.js'

/**
 * What a tenant API key may do, by role. The runtime API (`service`) is listed; **everything else is
 * the `tenant_manager` level, so a route added later is closed to service keys until someone decides
 * otherwise** (deny by default).
 *
 *   service         definitions (read, deploy), starting and reading instances, their events and
 *                   history, tasks (list, read, claim, release, complete), messages and signals.
 *   tenant_manager  also: deleting a definition, cancelling / suspending / resuming / restarting an
 *                   instance, webhooks, metrics.
 *
 * (Forcing a step is for signed-in people only and is refused to every key elsewhere.)
 */
type Rule = { method: string; path: RegExp }

const SERVICE: Rule[] = [
  { method: 'GET', path: /^\/definitions$/ },
  { method: 'POST', path: /^\/definitions$/ },
  { method: 'GET', path: /^\/definitions\/[^/]+$/ },
  { method: 'GET', path: /^\/definitions\/[^/]+\/xml$/ },
  { method: 'POST', path: /^\/definitions\/[^/]+\/instances$/ },
  { method: 'GET', path: /^\/instances$/ },
  { method: 'GET', path: /^\/instances\/[^/]+$/ },
  { method: 'GET', path: /^\/instances\/[^/]+\/(events|history)$/ },
  // the generic command route: the commands that end or pause an instance are checked by command type
  { method: 'POST', path: /^\/instances\/[^/]+\/commands$/ },
  { method: 'GET', path: /^\/tasks$/ },
  { method: 'GET', path: /^\/tasks\/[^/]+$/ },
  { method: 'POST', path: /^\/tasks\/[^/]+\/(complete|claim|release)$/ },
  { method: 'POST', path: /^\/(messages|signals)$/ },
]

/** Whether a key with this role may make this request (the command type is checked separately). */
export function keyMayCall(role: KeyRole, method: string, path: string): boolean {
  if (role === 'tenant_manager') return true
  return SERVICE.some((rule) => rule.method === method.toUpperCase() && rule.path.test(path))
}

/** Engine commands that end, pause or resume an instance: for managers, whatever route they arrive by. */
const ADMINISTRATIVE_COMMANDS = new Set(['SuspendInstance', 'ResumeInstance', 'CancelInstance'])

export function keyMayRunCommand(role: KeyRole, commandType: string): boolean {
  return role === 'tenant_manager' || !ADMINISTRATIVE_COMMANDS.has(commandType)
}
