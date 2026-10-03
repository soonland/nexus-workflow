import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// bpmn-js needs a real browser to lay things out, so it is replaced by a recorder here
const calls = vi.hoisted(() => ({
  created: 0,
  destroyed: 0,
  imported: [] as string[],
  zoomed: 0,
  added: [] as string[],
  removed: [] as string[],
  importError: null as Error | null,
  unknownIds: new Set<string>(),
}))

vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class {
    constructor() {
      calls.created++
    }
    async importXML(xml: string) {
      if (calls.importError) throw calls.importError
      calls.imported.push(xml)
    }
    get() {
      return {
        zoom: () => calls.zoomed++,
        addMarker: (id: string, marker: string) => {
          if (calls.unknownIds.has(id)) throw new Error('unknown element')
          calls.added.push(`${id}:${marker}`)
        },
        removeMarker: (id: string, marker: string) => calls.removed.push(`${id}:${marker}`),
      }
    }
    destroy() {
      calls.destroyed++
    }
  },
}))
vi.mock('bpmn-js/dist/assets/diagram-js.css', () => ({}))
vi.mock('../bpmnLayout', () => ({ ensureLayout: async (xml: string) => `laid-out:${xml}` }))

import BpmnDiagram from './BpmnDiagram'

const props = { xml: '<a/>', activeIds: ['review'], doneIds: ['start'], errorIds: [] as string[], onError: () => undefined }

beforeEach(() => {
  Object.assign(calls, { created: 0, destroyed: 0, imported: [], zoomed: 0, added: [], removed: [], importError: null })
  calls.unknownIds.clear()
})

describe('BpmnDiagram', () => {
  it('lays out and draws the XML, fits it to the box, and marks progress with "now" last', async () => {
    render(<BpmnDiagram {...props} />)

    await waitFor(() => expect(calls.added).toEqual(['start:nexus-done', 'review:nexus-active']))
    expect(calls.imported).toEqual(['laid-out:<a/>'])
    expect(calls.zoomed).toBe(1)
  })

  it('does not redraw, or reset the zoom, when only the marks change', async () => {
    const { rerender } = render(<BpmnDiagram {...props} />)
    await waitFor(() => expect(calls.added).toHaveLength(2))

    rerender(<BpmnDiagram {...props} activeIds={['approve']} doneIds={['start', 'review']} />)

    await waitFor(() => expect(calls.added).toContain('approve:nexus-active'))
    expect(calls.created).toBe(1)
    expect(calls.imported).toHaveLength(1)
    expect(calls.zoomed).toBe(1)
    expect(calls.removed).toEqual(['start:nexus-done', 'review:nexus-active']) // the old marks are cleared first
  })

  it('does nothing when handed new arrays with the same content', async () => {
    const { rerender } = render(<BpmnDiagram {...props} />)
    await waitFor(() => expect(calls.added).toHaveLength(2))

    rerender(<BpmnDiagram {...props} activeIds={['review']} doneIds={['start']} errorIds={[]} />)

    expect(calls.added).toHaveLength(2)
    expect(calls.removed).toEqual([])
  })

  it('redraws when the XML changes, and cleans up the old viewer', async () => {
    const { rerender, unmount } = render(<BpmnDiagram {...props} />)
    await waitFor(() => expect(calls.imported).toHaveLength(1))

    rerender(<BpmnDiagram {...props} xml="<b/>" />)

    await waitFor(() => expect(calls.imported).toEqual(['laid-out:<a/>', 'laid-out:<b/>']))
    expect(calls.destroyed).toBe(1)
    unmount()
    expect(calls.destroyed).toBe(2)
  })

  it('skips marks for elements that are not in the diagram', async () => {
    calls.unknownIds.add('start')
    render(<BpmnDiagram {...props} />)

    await waitFor(() => expect(calls.added).toEqual(['review:nexus-active']))
  })

  it('reports a diagram that cannot be drawn', async () => {
    calls.importError = new Error('no diagram to display')
    const onError = vi.fn()
    render(<BpmnDiagram {...props} onError={onError} />)

    await waitFor(() => expect(onError).toHaveBeenCalledWith('no diagram to display'))
    expect(calls.added).toEqual([])
  })
})
