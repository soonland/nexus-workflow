'use client'

import dynamic from 'next/dynamic'

const BpmnViewer = dynamic(() => import('./BpmnViewer'), { ssr: false })

const BpmnViewerLoader = ({ xml }: { xml: string }) => {
  return <BpmnViewer xml={xml} />
}
export default BpmnViewerLoader
