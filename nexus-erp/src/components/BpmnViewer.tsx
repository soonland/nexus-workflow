'use client'

import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'

interface Props {
  xml: string
}

const BpmnViewer = ({ xml }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Destroy any previous viewer instance before creating a new one
    if (viewerRef.current) {
      viewerRef.current.destroy()
      viewerRef.current = null
    }

    let cancelled = false

    Promise.all([import('bpmn-js'), import('bpmn-auto-layout')]).then(([{ default: BpmnJS }, { layoutProcess }]) => {
      if (cancelled || !containerRef.current) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const viewer = new (BpmnJS as any)({ container: containerRef.current })
      viewerRef.current = viewer

      // Auto-layout adds <bpmndi:BPMNDiagram> coordinates to execution-only BPMN files
      layoutProcess(xml).then((laidOutXml) => viewer.importXML(laidOutXml))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(({ warnings }: { warnings: any[] }) => {
        if (cancelled) return
        if (warnings.length) console.warn('[BpmnViewer] import warnings:', warnings)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canvas = viewer.get('canvas') as any
        canvas.zoom('fit-viewport')
        setLoading(false)
      }).catch((err: unknown) => {
        if (cancelled) return
        console.error('[BpmnViewer] importXML error:', err)
        setError(err instanceof Error ? err.message : 'Failed to render BPMN diagram')
        setLoading(false)
      })
    }).catch((err: unknown) => {
      if (cancelled) return
      console.error('[BpmnViewer] failed to load bpmn-js:', err)
      setError('Failed to load diagram renderer')
      setLoading(false)
    })

    return () => {
      cancelled = true
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [xml])

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: 480,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: '#fafafa',
      }}
    >
      {loading && !error && (
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <CircularProgress size={32} />
        </Stack>
      )}
      {error && (
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, zIndex: 1, p: 3 }}>
          <Typography variant="body2" color="error" align="center">{error}</Typography>
        </Stack>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </Box>
  )
}
export default BpmnViewer
