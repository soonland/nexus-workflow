import type { Token, BpmnElementType, WaitCondition } from '../../../src/model/types.js';
export declare function buildToken(overrides?: Partial<Token>): Token;
export declare function buildWaitingToken(waitingFor: WaitCondition, overrides?: Partial<Token>): Token;
export declare function buildTokenAt(elementId: string, elementType: BpmnElementType, overrides?: Partial<Token>): Token;
//# sourceMappingURL=TokenBuilder.d.ts.map