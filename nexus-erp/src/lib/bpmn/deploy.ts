import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDefinition, deployDefinition } from '@/lib/workflow'

export async function ensureTimesheetDefinitionDeployed(): Promise<void> {
  const existing = await getDefinition('timesheet-approval')
  if (existing) {
    console.log('[bpmn] timesheet-approval already deployed')
    return
  }

  const xmlPath = join(process.cwd(), 'src/lib/bpmn/timesheet-approval.xml')
  const xml = readFileSync(xmlPath, 'utf-8')
  const result = await deployDefinition(xml)
  console.log(`[bpmn] deployed timesheet-approval v${result.version}`)
}

export async function ensureProfileUpdateDefinitionDeployed(): Promise<void> {
  const existing = await getDefinition('update-profile-info')
  if (existing) {
    console.log('[bpmn] update-profile-info already deployed')
    return
  }

  const xmlPath = join(process.cwd(), 'src/lib/bpmn/update-profile-info.xml')
  const xml = readFileSync(xmlPath, 'utf-8')
  const result = await deployDefinition(xml)
  console.log(`[bpmn] deployed update-profile-info v${result.version}`)
}
