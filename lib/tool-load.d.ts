/** tool_load 只加载已公告且当前准入的工具；声明通过 deferContext 保存后才生效。 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type ToolSchemaLike } from './catalog.ts';
import type { DisclosureLimits } from './disclosure.ts';
import type { DisclosureHistory } from './history.ts';
import type { HostBindings } from './host.ts';
import type { SourceKind } from './source.ts';
import type { ToolStrategy } from './strategy.ts';
/** Names this plugin owns; a deployment cannot shadow them. */
export { TOOL_LOAD_NAME } from './source.ts';
/** Settings the load tool needs at call time. */
export interface ToolLoadOptions {
    readonly host: HostBindings;
    readonly history: DisclosureHistory;
    readonly project?: (agent: Agent, definition: ToolDefinition) => ToolSchemaLike;
    readonly admitted: (agent: Agent) => readonly ToolDefinition[] | undefined;
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
 * @param options - source kind, limits, and the agent's declaration facts.
 * @returns the unregistered definition.
 */
export declare function createToolLoad(options: ToolLoadOptions): ToolDefinition;
