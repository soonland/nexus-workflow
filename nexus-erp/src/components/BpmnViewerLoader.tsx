'use client'

import dynamic from 'next/dynamic'

const BpmnViewer = dynamic(() => import('./BpmnViewer'), { ssr: false })

export default function BpmnViewerLoader({ xml }: { xml: string }) {
  return <BpmnViewer xml={xml} />
}
