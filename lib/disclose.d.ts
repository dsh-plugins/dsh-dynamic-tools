/**
 * Trailing disclosure of dynamic tool definitions.
 *
 * Runs after the step's own pre-step listeners settle and appends recorded user
 * messages, so the request head never changes. The disclosed set follows the
 * registry, not the step's admission: a tool the model may not call right now
 * is still worth naming, because the call itself reports why it is unavailable.
 *
 * A route that reads only declared tool lists gets names instead of schemas:
 * its definition can only take effect once `tool_load` added it to the head, so
 * attaching it here would claim a callability the route does not have.
 *
 * @module dsh-dynamic-tools/disclose
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type DisclosedState, type DisclosureLimits } from './disclosure.ts';
import type { SourceKind } from './source.ts';
import type { ToolStrategy } from './strategy.ts';
/** Everything the pre-step listener needs to plan one step's disclosure. */
export interface DiscloseOptions {
    /** Message source kind owned by this plugin. */
    readonly sourceKind: SourceKind;
    /** Validated disclosure limits. */
    readonly limits: DisclosureLimits;
    /** Whether names that disappear from the registry are announced. */
    readonly announceRemovals: boolean;
    /** Strategy this step's executor settled, per installed agent. */
    readonly strategy: (agent: Agent) => ToolStrategy | undefined;
    /** Names the frozen head declares, per installed agent. */
    readonly catalogNames: (agent: Agent) => ReadonlySet<string>;
    /** Definitions this step admits, recorded by the executor's last assembly. */
    readonly admitted: (agent: Agent) => readonly ToolDefinition[] | undefined;
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
 * Append this step's disclosure messages.
 *
 * Only definitions the step actually admits are candidates. A registered tool
 * whose `when` condition is false is unavailable right now: announcing it would
 * invite a call that can only be denied, so it is not disclosed at all.
 *
 * @param ctx - plugin context for diagnostics.
 * @param agent - agent entering the step.
 * @param admitted - definitions this step admits.
 * @param executorCatalog - names the frozen head declares.
 * @param options - disclosure settings.
 * @param strategy - how this step's route receives dynamic tools.
 * @returns the messages to append, in order.
 */
export declare function disclosureMessages(ctx: Context, agent: Agent, admitted: readonly ToolDefinition[], executorCatalog: ReadonlySet<string>, options: DiscloseOptions, strategy: ToolStrategy): readonly UserMessage[];
/**
 * Register the pre-step listener that appends disclosures.
 * @param ctx - plugin context owning the listener.
 * @param options - disclosure settings.
 */
export declare function registerDisclosure(ctx: Context, options: DiscloseOptions): void;
