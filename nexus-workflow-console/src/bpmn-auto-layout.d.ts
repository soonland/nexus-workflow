// bpmn-auto-layout ships no types; this is the one function we use.
declare module 'bpmn-auto-layout' {
  /** Returns the same BPMN XML with a generated diagram (shapes and edges) added. */
  export function layoutProcess(xml: string): Promise<string>
}
