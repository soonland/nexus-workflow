/** Whether the XML says where to draw things (BPMN's "diagram interchange" part). */
export function hasLayout(xml: string): boolean {
  return /<(\w+:)?BPMNShape[\s>]/.test(xml)
}

const NOT_AFTER = new Set(['documentation', 'extensionElements', 'incoming', 'outgoing'])

/**
 * The layout tool only draws arrows for flows that the elements list as `incoming` / `outgoing`,
 * which the engine does not need and many definitions leave out. This adds them from the flows'
 * own `sourceRef` / `targetRef`, where missing.
 */
function withFlowRefs(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return xml // let the layout tool report it

  const byId = new Map<string, Element>()
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const id = element.getAttribute('id')
    if (id) byId.set(id, element)
  }

  const listed = (node: Element, kind: 'incoming' | 'outgoing', flowId: string) =>
    Array.from(node.children).some((child) => child.localName === kind && child.textContent?.trim() === flowId)

  const add = (node: Element | undefined, kind: 'incoming' | 'outgoing', flowId: string) => {
    if (!node || listed(node, kind, flowId)) return
    const ref = doc.createElementNS(node.namespaceURI, node.prefix ? `${node.prefix}:${kind}` : kind)
    ref.textContent = flowId
    // The schema wants these right after the documentation / extension elements
    const before = Array.from(node.children).find((child) => !NOT_AFTER.has(child.localName))
    node.insertBefore(ref, before ?? null)
  }

  for (const flow of Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'sequenceFlow')) {
    const id = flow.getAttribute('id')
    if (!id) continue
    add(byId.get(flow.getAttribute('sourceRef') ?? ''), 'outgoing', id)
    add(byId.get(flow.getAttribute('targetRef') ?? ''), 'incoming', id)
  }
  return new XMLSerializer().serializeToString(doc)
}

/**
 * The engine reads only the process itself, so definitions are often deployed without any layout,
 * and a diagram viewer cannot draw those. This adds a generated layout when there is none, and
 * leaves XML that already has one untouched.
 */
export async function ensureLayout(xml: string): Promise<string> {
  if (hasLayout(xml)) return xml
  const { layoutProcess } = await import('bpmn-auto-layout')
  return layoutProcess(withFlowRefs(xml))
}
