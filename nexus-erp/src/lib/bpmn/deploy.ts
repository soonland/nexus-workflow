import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDefinition, getDefinitionXml, deployDefinition } from '@/lib/workflow'

async function ensureDeployed(definitionId: string, xmlFileName: string): Promise<void> {
  const [existing, storedXml] = await Promise.all([
    getDefinition(definitionId),
    getDefinitionXml(definitionId),
  ])

  if (existing && storedXml) {
    console.log(`[bpmn] ${definitionId} already deployed with XML`)
    return
  }

  const xmlPath = join(process.cwd(), 'src/lib/bpmn', xmlFileName)
  const xml = readFileSync(xmlPath, 'utf-8')
  const result = await deployDefinition(xml)
  console.log(`[bpmn] deployed ${definitionId} v${result.version}`)
}

export async function ensureTimesheetDefinitionDeployed(): Promise<void> {
  await ensureDeployed('timesheet-approval', 'timesheet-approval.xml')
}

export async function ensureProfileUpdateDefinitionDeployed(): Promise<void> {
  await ensureDeployed('update-profile-info', 'update-profile-info.xml')
}

export async function ensureOrgStatusChangeDefinitionDeployed(): Promise<void> {
  await ensureDeployed('org-status-change', 'org-status-change.xml')
}
