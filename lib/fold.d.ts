/**
 * Fold durable disclosure messages back into delivery state, so compaction,
 * resume, and fork rebuild the comparison instead of trusting process memory.
 *
 * @module dsh-dynamic-tools/fold
 */
import type { DisclosedState } from './disclosure.ts';
/** The subset of a model message this fold reads. */
export interface FoldableMessage {
    readonly role: string;
    readonly content: readonly {
        readonly type: string;
        readonly text?: string;
    }[];
    readonly source?: {
        readonly kind?: string;
    };
}
/**
 * Fold every dynamic-tools message in delivery order.
 * A damaged block still marks its name as announced, so the model keeps seeing
 * the name; the definition is re-disclosed because it was never recorded.
 *
 * @param messages - derived session messages in model order.
 * @param kind - message source kind owned by this plugin.
 * @returns the delivered state at the end of the history.
 */
export declare function foldDisclosed(messages: readonly FoldableMessage[], kind: string): DisclosedState;
