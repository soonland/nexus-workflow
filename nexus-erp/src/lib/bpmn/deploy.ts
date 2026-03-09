import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDefinition, deployDefinition } from '@/lib/workflow'

const DEFINITION_ID = 'timesheet-approval'

export async function ensureTimesheetDefinitionDeployed(): Promise<void> {
  const existing = await getDefinition(DEFINITION_ID)
  if (existing) {
    console.log('[bpmn] timesheet-approval already deployed')
    return
  }

  const xmlPath = join(process.cwd(), 'src/lib/bpmn/timesheet-approval.xml')
  const xml = readFileSync(xmlPath, 'utf-8')
  const result = await deployDefinition(xml)
  console.log(`[bpmn] deployed timesheet-approval v${result.version}`)
}
