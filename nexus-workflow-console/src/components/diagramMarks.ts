/** How the diagram marks an instance's progress, as theme palette colours (shared by the diagram and its legend). */
export const MARK_COLORS = {
  active: 'info',
  done: 'success',
  error: 'error',
} as const

/** CSS class that bpmn-js puts on an element for each state. */
export const MARK_CLASSES = {
  active: 'nexus-active',
  done: 'nexus-done',
  error: 'nexus-error',
} as const
