import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, useTheme } from '@mui/material'
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import 'bpmn-js/dist/assets/diagram-js.css'
import { ensureLayout } from '../bpmnLayout'
import { MARK_CLASSES, MARK_COLORS } from './diagramMarks'

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

interface DiagramCanvas {
  zoom(mode: string): void
  addMarker(id: string, marker: string): void
  removeMarker(id: string, marker: string): void
}

/**
 * A read-only BPMN diagram with the instance's progress marked on it. This module pulls in the
 * whole diagram library, so it is loaded lazily and only on the instance page.
 *
 * Drawing and marking are separate on purpose: the diagram is (re)drawn only when the XML changes,
 * so new marks (a refresh, say) do not rebuild it or reset the reader's zoom and position.
 */
export default function BpmnDiagram({ xml, activeIds, doneIds, errorIds, onError }: Props) {
  const theme = useTheme()
  const container = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<NavigatedViewer | null>(null)
  const marked = useRef<Array<{ id: string; marker: string }>>([])

  // Draw
  useEffect(() => {
    const element = container.current
    if (!element) return
    const created = new NavigatedViewer({ container: element })
    let cancelled = false
    marked.current = []

    ensureLayout(xml)
      .then((laidOut) => created.importXML(laidOut))
      .then(() => {
        if (cancelled) return
        ;(created.get('canvas') as DiagramCanvas).zoom('fit-viewport')
        setViewer(created)
      })
      .catch((err: unknown) => {
        if (!cancelled) onError(err instanceof Error ? err.message : 'The diagram could not be drawn')
      })

    return () => {
      cancelled = true
      setViewer(null)
      created.destroy()
    }
  }, [xml, onError])

  // Mark. The marks are compared by content, so passing fresh arrays with the same ids does nothing.
  const marksKey = JSON.stringify([activeIds, doneIds, errorIds])
  useEffect(() => {
    if (!viewer) return
    const canvas = viewer.get('canvas') as DiagramCanvas
    for (const { id, marker } of marked.current) canvas.removeMarker(id, marker)
    marked.current = []

    const [active, done, error] = JSON.parse(marksKey) as [string[], string[], string[]]
    const mark = (ids: string[], marker: string) => {
      for (const id of ids) {
        try {
          canvas.addMarker(id, marker)
          marked.current.push({ id, marker })
        } catch {
          // The element is not in this diagram (e.g. the definition was edited since): skip it
        }
      }
    }
    mark(done, MARK_CLASSES.done)
    mark(error, MARK_CLASSES.error)
    mark(active, MARK_CLASSES.active) // last, so "now" wins over "was"
  }, [viewer, marksKey])

  const style = useMemo(() => {
    const { palette } = theme
    const rule = (state: keyof typeof MARK_CLASSES, extra: string) =>
      `.${MARK_CLASSES[state]} .djs-visual > :nth-child(1) { stroke: ${palette[MARK_COLORS[state]].main} !important; fill: ${palette[MARK_COLORS[state]].main}22 !important; ${extra} }`
    return [rule('active', 'stroke-width: 3px !important;'), rule('done', ''), rule('error', '')].join('\n')
  }, [theme])

  return (
    <>
      <style>{style}</style>
      <Box ref={container} role="img" aria-label="Workflow diagram" sx={{ height: 360, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }} />
    </>
  )
}
