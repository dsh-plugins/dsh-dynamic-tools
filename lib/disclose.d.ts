/**
 * Trailing disclosure of dynamic tool definitions.
 *
 * Runs after the step's own pre-step listeners settle and appends recorded user
 * messages, so the request head never changes. The disclosed set follows the
 * registry, not the step's admission: a tool the model may not call right now
 * is still worth naming, because the call itself reports why it is unavailable.
 *
 * @module dsh-dynamic-tools/disclose
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import { type DisclosedState, type DisclosureLimits } from './disclosure.ts';
import type { SourceKind } from './source.ts';
/** Everything the pre-step listener needs to plan one step's disclosure. */
export interface DiscloseOptions {
    /** Message source kind owned by this plugin. */
    readonly sourceKind: SourceKind;
    /** Validated disclosure limits. */
    readonly limits: DisclosureLimits;
    /** Whether names that disappear from the registry are announced. */
    readonly announceRemovals: boolean;
    /** Names the frozen head declares, per installed agent. */
    readonly catalogNames: (agent: Agent) => ReadonlySet<string>;
}
/**
 * Read the session's delivered state, rebuilding it from durable messages when
 * the process-local holder is missing (resume, fork, compaction).
 * @param agent - agent whose session is read.
 * @param kind - message source kind owned by this plugin.
 * @returns the folded state.
 */
export declare function currentState(agent: Agent, kind: SourceKind): DisclosedState;
/**
 * Replace the process-local state after a disclosure or a load.
 * @param agent - agent whose session was updated.
 * @param state - new state.
 */
export declare function storeState(agent: Agent, state: DisclosedState): void;
/**
 * Drop process-local state so the next read folds the durable messages again.
 * @param agent - agent whose session was compacted or replaced.
 */
export declare function invalidateState(agent: Agent): void;
/**
 * Append this step's disclosure messages.
 * @param ctx - plugin context for diagnostics.
 * @param agent - agent entering the step.
 * @param executorCatalog - names the frozen head declares.
 * @param options - disclosure settings.
 * @returns the messages to append, in order.
 */
export declare function disclosureMessages(ctx: Context, agent: Agent, executorCatalog: ReadonlySet<string>, options: DiscloseOptions): readonly UserMessage[];
/**
 * Register the pre-step listener that appends disclosures.
 * @param ctx - plugin context owning the listener.
 * @param options - disclosure settings.
 */
export declare function registerDisclosure(ctx: Context, options: DiscloseOptions): void;
