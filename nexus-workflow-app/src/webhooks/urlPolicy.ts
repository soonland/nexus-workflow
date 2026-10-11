import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

// ─── Policy ───────────────────────────────────────────────────────────────────

export interface WebhookUrlPolicy {
  /** Accept plain http:// targets. Off by default; meant for local development. */
  allowHttp: boolean
  /**
   * Targets an operator trusts although they are on an internal network: hostnames, single
   * addresses or CIDR ranges (`hooks.internal`, `10.0.0.5`, `10.1.0.0/16`). Link-local addresses
   * (cloud metadata services) can never be allowed.
   */
  allowedHosts: string[]
}

export const STRICT_WEBHOOK_URL_POLICY: WebhookUrlPolicy = { allowHttp: false, allowedHosts: [] }

/** Resolves a hostname to every address it currently points at. */
export type HostResolver = (hostname: string) => Promise<string[]>

export const dnsResolver: HostResolver = async (hostname) => {
  const found = await lookup(hostname, { all: true })
  return found.map((f) => f.address)
}

/** Why a webhook URL was refused. The message is safe to show to the caller. */
export class WebhookUrlError extends Error {}

// ─── Address classes ──────────────────────────────────────────────────────────

function blockList(v4: [string, number][], v6: [string, number][]): BlockList {
  const list = new BlockList()
  for (const [net, bits] of v4) list.addSubnet(net, bits, 'ipv4')
  for (const [net, bits] of v6) list.addSubnet(net, bits, 'ipv6')
  return list
}

/** Never reachable, even when an operator allow-lists a host (includes cloud metadata). */
const HARD_BLOCKED = blockList(
  [
    ['0.0.0.0', 8],
    ['169.254.0.0', 16],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ],
  [
    ['::', 128],
    ['fe80::', 10],
    ['ff00::', 8],
  ],
)

/** Internal or non-routable ranges that an operator may explicitly allow. */
const INTERNAL = blockList(
  [
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
  ],
  [
    ['::1', 128],
    ['fc00::', 7],
    ['fec0::', 10],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['64:ff9b::', 96],
  ],
)

function family(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 4 ? 'ipv4' : 'ipv6'
}

function parseAllowed(entries: string[]): { addresses: BlockList; hosts: Set<string> } {
  const addresses = new BlockList()
  const hosts = new Set<string>()
  for (const raw of entries) {
    const entry = raw.trim().toLowerCase()
    if (!entry) continue
    const [base, bits] = entry.split('/')
    if (base && isIP(base)) {
      if (bits === undefined) addresses.addAddress(base, family(base))
      else addresses.addSubnet(base, Number(bits), family(base))
    } else {
      hosts.add(entry)
    }
  }
  return { addresses, hosts }
}

/** True when a connection to `address` is refused by the policy. */
export function isBlockedAddress(address: string, policy: WebhookUrlPolicy, hostname?: string): boolean {
  const kind = isIP(address)
  if (kind === 0) return true
  if (HARD_BLOCKED.check(address, family(address))) return true
  if (!INTERNAL.check(address, family(address))) return false
  const allowed = parseAllowed(policy.allowedHosts)
  if (allowed.addresses.check(address, family(address))) return false
  return !(hostname !== undefined && allowed.hosts.has(hostname.toLowerCase()))
}

// ─── URL checks ───────────────────────────────────────────────────────────────

function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

/** Checks everything that can be decided without the network. */
export function parseWebhookUrl(raw: string, policy: WebhookUrlPolicy): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WebhookUrlError('URL is not valid')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && policy.allowHttp)) {
    throw new WebhookUrlError(policy.allowHttp ? 'URL must use http or https' : 'URL must use https')
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('URL must not contain credentials')
  }
  const host = bareHostname(url)
  if (isIP(host)) {
    if (isBlockedAddress(host, policy)) throw new WebhookUrlError('URL points at an address that is not allowed')
  } else if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!parseAllowed(policy.allowedHosts).hosts.has(host)) {
      throw new WebhookUrlError('URL points at an address that is not allowed')
    }
  }
  return url
}

/**
 * Resolves the URL's host and returns the addresses a connection may use. Every address the name
 * resolves to must be allowed, so a name cannot mix a public and an internal answer.
 */
export async function resolveWebhookTarget(
  raw: string,
  policy: WebhookUrlPolicy,
  resolver: HostResolver = dnsResolver,
): Promise<{ url: URL; addresses: string[] }> {
  const url = parseWebhookUrl(raw, policy)
  const host = bareHostname(url)
  if (isIP(host)) return { url, addresses: [host] }

  let addresses: string[]
  try {
    addresses = await resolver(host)
  } catch {
    throw new WebhookUrlError('Host name could not be resolved')
  }
  if (addresses.length === 0) throw new WebhookUrlError('Host name could not be resolved')
  if (addresses.some((a) => isBlockedAddress(a, policy, host))) {
    throw new WebhookUrlError('URL points at an address that is not allowed')
  }
  return { url, addresses }
}

export function parseAllowedHostsEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
