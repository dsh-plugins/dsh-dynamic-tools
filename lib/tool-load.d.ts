/**
 * `tool_load`: deliver the definition of a tool the conversation announced but
 * the declaration head does not contain.
 *
 * The definition rides `exec.deferContext()`, so the loop logs it after this
 * tool's result and the next request carries it at the tail. On a route that
 * reads only declared tool lists, the next request also declares it.
 *
 * Only a name the model was actually told about is served: announcing is what
 * makes a definition fair game. Serving any registered name would let a guessed
 * name pull an unannounced definition into the head and keep it there.
 *
 * @module dsh-dynamic-tools/tool-load
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type DisclosureLimits } from './disclosure.ts';
import type { SourceKind } from './source.ts';
import type { ToolStrategy } from './strategy.ts';
/** Names this plugin owns; a deployment cannot shadow them. */
export declare const TOOL_LOAD_NAME = "tool_load";
/** Settings the load tool needs at call time. */
export interface ToolLoadOptions {
    /** Message source kind owned by this plugin. */
    readonly sourceKind: SourceKind;
    /** Validated disclosure limits; `maxSchemaBytes` caps a loaded definition. */
    readonly limits: DisclosureLimits;
    /** Strategy this step's executor settled, per installed agent. */
    readonly strategy: (agent: Agent) => ToolStrategy | undefined;
    /** Names the frozen head declares, per installed agent. */
    readonly declaredNames: (agent: Agent) => ReadonlySet<string>;
}
/**
 * Create the `tool_load` definition.
 * @param ctx - plugin context, used to read the agent's visible tools.
 * @param options - source kind, limits, and the agent's declaration facts.
 * @returns the unregistered definition.
 */
export declare function createToolLoad(ctx: Context, options: ToolLoadOptions): ToolDefinition;
