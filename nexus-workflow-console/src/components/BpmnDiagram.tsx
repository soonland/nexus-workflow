import { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import 'bpmn-js/dist/assets/diagram-js.css'

interface Props {
  xml: string
  /** Elements the instance is at right now. */
  activeIds: string[]
  /** Elements it has passed through. */
  doneIds: string[]
  /** Elements that were cancelled or failed. */
  errorIds: string[]
  /** The diagram could not be drawn (broken XML, unsupported content). */
  onError(message: string): void
}

// Marker styles for the three states, drawn over the diagram's own colours
const MARKERS = {
  active: 'nexus-active',
  done: 'nexus-done',
  error: 'nexus-error',
} as const

const STYLE = `
.nexus-active .djs-visual > :nth-child(1) { stroke: #1e88e5 !important; stroke-width: 3px !important; fill: rgba(30,136,229,0.15) !important; }
.nexus-done .djs-visual > :nth-child(1) { stroke: #43a047 !important; fill: rgba(67,160,71,0.12) !important; }
.nexus-error .djs-visual > :nth-child(1) { stroke: #e53935 !important; fill: rgba(229,57,53,0.12) !important; }
`

/**
 * A read-only BPMN diagram with the instance's progress marked on it. This module pulls in the
 * whole diagram library, so it is loaded lazily and only on the instance page.
 */
export default function BpmnDiagram({ xml, activeIds, doneIds, errorIds, onError }: Props) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const viewer = new NavigatedViewer({ container: element })
    let cancelled = false

    viewer
      .importXML(xml)
      .then(() => {
        if (cancelled) return
        const canvas = viewer.get('canvas') as {
          zoom(mode: string): void
          addMarker(id: string, marker: string): void
        }
        canvas.zoom('fit-viewport')
        const mark = (ids: string[], marker: string) => {
          for (const id of ids) {
            try {
              canvas.addMarker(id, marker)
            } catch {
              // The element is not in this diagram (e.g. the definition was edited since): skip it
            }
          }
        }
        mark(doneIds, MARKERS.done)
        mark(errorIds, MARKERS.error)
        mark(activeIds, MARKERS.active) // last, so "now" wins over "was"
      })
      .catch((err: unknown) => {
        if (!cancelled) onError(err instanceof Error ? err.message : 'The diagram could not be drawn')
      })

    return () => {
      cancelled = true
      viewer.destroy()
    }
  }, [xml, activeIds, doneIds, errorIds, onError])

  return (
    <>
      <style>{STYLE}</style>
      <Box ref={container} role="img" aria-label="Workflow diagram" sx={{ height: 360, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }} />
    </>
  )
}
