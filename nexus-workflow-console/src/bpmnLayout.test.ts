import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { ensureLayout, hasLayout } from './bpmnLayout'

const BARE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="http://example.com">
  <bpmn:process id="p" isExecutable="true">
    <bpmn:startEvent id="start"/>
    <bpmn:userTask id="review" name="Review"/>
    <bpmn:endEvent id="end"/>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="end"/>
  </bpmn:process>
</bpmn:definitions>`

describe('bpmnLayout', () => {
  it('tells whether XML carries a layout', () => {
    expect(hasLayout(BARE)).toBe(false)
    expect(hasLayout('<bpmndi:BPMNShape id="s"/>')).toBe(true)
    expect(hasLayout('<BPMNShape id="s"/>')).toBe(true)
  })

  it('adds a layout to a definition that has none', async () => {
    const laidOut = await ensureLayout(BARE)

    expect(hasLayout(laidOut)).toBe(true)
    for (const id of ['start', 'review', 'end', 'f1', 'f2']) expect(laidOut).toContain(`bpmnElement="${id}"`)
  })

  it('draws the arrows even when elements do not list their incoming and outgoing flows', async () => {
    const laidOut = await ensureLayout(BARE) // BARE lists none

    expect(laidOut.match(/<bpmndi:BPMNEdge /g)).toHaveLength(2)
  })

  it('does not list a flow twice when the element already does', async () => {
    const listedAlready = BARE.replace('<bpmn:startEvent id="start"/>', '<bpmn:startEvent id="start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>')

    const laidOut = await ensureLayout(listedAlready)

    expect(laidOut.match(/<bpmn:outgoing>f1<\/bpmn:outgoing>/g)).toHaveLength(1)
  })

  it('leaves XML that already has a layout exactly as it is', async () => {
    const withLayout = '<definitions><bpmndi:BPMNDiagram><bpmndi:BPMNShape id="s"/></bpmndi:BPMNDiagram></definitions>'
    expect(await ensureLayout(withLayout)).toBe(withLayout)
  })

  it("lays out the ERP's real definitions, which have no layout of their own", async () => {
    // tests run from the console package directory
    const xml = readFileSync(join(process.cwd(), '../nexus-erp/src/lib/bpmn/timesheet-approval.xml'), 'utf-8')
    expect(hasLayout(xml)).toBe(false)

    const laidOut = await ensureLayout(xml)

    expect(hasLayout(laidOut)).toBe(true)
    expect(laidOut.match(/<bpmndi:BPMNEdge /g)).toHaveLength(xml.match(/<bpmn:sequenceFlow /g)?.length ?? -1)
  })
})
