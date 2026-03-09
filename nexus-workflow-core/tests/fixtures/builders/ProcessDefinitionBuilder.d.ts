import type { ProcessDefinition } from '../../../src/model/types.js';
export declare function buildDefinition(overrides?: Partial<ProcessDefinition>): ProcessDefinition;
/**
 * Start → End (simplest possible process)
 *
 * [Start] --flow_1--> [End]
 */
export declare function buildSimpleSequenceDefinition(): ProcessDefinition;
/**
 * Start → ServiceTask → End
 *
 * [Start] --flow_1--> [ServiceTask] --flow_2--> [End]
 */
export declare function buildServiceTaskDefinition(taskType?: string): ProcessDefinition;
/**
 * Start → UserTask → End
 *
 * [Start] --flow_1--> [UserTask] --flow_2--> [End]
 */
export declare function buildUserTaskDefinition(): ProcessDefinition;
/**
 * Start → XOR → [TaskA | TaskB] → End
 *
 * [Start] --> [XOR] --flow_a (amount > 100)--> [TaskA] --> [End]
 *                   --flow_b (default)-------> [TaskB] --> [End]
 */
export declare function buildXorGatewayDefinition(): ProcessDefinition;
/**
 * Start → AND split → [TaskA, TaskB, TaskC] → AND join → End
 *
 * [Start] --> [AND split] --> [TaskA] --> [AND join] --> [End]
 *                         --> [TaskB] -->
 *                         --> [TaskC] -->
 */
export declare function buildParallelGatewayDefinition(): ProcessDefinition;
//# sourceMappingURL=ProcessDefinitionBuilder.d.ts.map