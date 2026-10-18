import type { DefinitionDetail, StartInput } from './api/types'

const PLACEHOLDERS = { string: '', number: 0, boolean: false } as const

/** The inputs the workflow's start event declares; none when the start event is missing or declares none. */
export function startInputsOf(definition: DefinitionDetail): StartInput[] {
  return definition.elements.find((element) => element.id === definition.startEventId)?.inputs ?? []
}

/** A JSON object to start from: one key per declared input, filled with a placeholder for its type. */
export function buildStartTemplate(inputs: StartInput[]): string {
  if (inputs.length === 0) return ''
  const template = Object.fromEntries(inputs.map((input) => [input.name, PLACEHOLDERS[input.type ?? 'string']]))
  return JSON.stringify(template, null, 2)
}
