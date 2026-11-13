/**
 * `tool_load`: deliver the definition of a tool the model was told about but
 * whose schema it cannot see in the declaration head.
 *
 * The definition rides `exec.deferContext()`, so the loop logs it after this
 * tool's result and the next request carries it at the tail.
 *
 * @module dsh-dynamic-tools/tool-load
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { DisclosureLimits } from './disclosure.ts';
import type { SourceKind } from './source.ts';
/** Names this plugin owns; a deployment cannot shadow them. */
export declare const TOOL_LOAD_NAME = "tool_load";
/** Settings the load tool needs at call time. */
export interface ToolLoadOptions {
    /** Message source kind owned by this plugin. */
    readonly sourceKind: SourceKind;
    /** Validated disclosure limits; `maxSchemaBytes` caps a loaded definition. */
    readonly limits: DisclosureLimits;
}
/**
 * Create the `tool_load` definition.
 * @param ctx - plugin context, used to read the agent's visible tools.
 * @param options - source kind and limits.
 * @returns the unregistered definition.
 */
export declare function createToolLoad(ctx: Context, options: ToolLoadOptions): ToolDefinition;
