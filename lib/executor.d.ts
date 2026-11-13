/**
 * Frozen-catalog tool executor.
 *
 * The declaration head is captured once, when this executor is installed, and
 * returned unchanged for every later step, so a mid-conversation tool change
 * never rewrites the request prefix. Tools outside that head stay callable
 * through tail disclosure, but only while the step admits them: an unadmitted
 * call is reported as an executable denial before policy and approval run.
 *
 * @module dsh-dynamic-tools/executor
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolBatchInput, ToolBatchResult, ToolDefinition, ToolExecutor, ToolModelInput } from '@deepseek-ai/dsh-tools';
import { type ClassificationRules } from './catalog.ts';
import type { DisclosedEntry } from './disclosure.ts';
/** Delivered disclosure state shared with the pre-step listener. */
export interface DisclosureStateHandle {
    /** Definitions the model has been told about. */
    disclosed(): ReadonlyMap<string, DisclosedEntry>;
    /** Names whose definition was delivered through `tool_load`. */
    loaded(): ReadonlySet<string>;
}
/** Runtime settings the executor reads on every step. */
export interface ExecutorOptions {
    /** Whether a dynamic tool must be loaded before it may run. */
    readonly requireLoad: boolean;
    /** Configured denial reasons by tool name. */
    readonly unavailableReasons: Readonly<Record<string, string>>;
    /** Concurrency used when the loop supplies none. */
    readonly maxParallelCalls: number;
}
/**
 * Executes the frozen declaration head plus admitted dynamic tools.
 */
export declare class StableCatalogExecutor implements ToolExecutor {
    private readonly ctx;
    private readonly agent;
    private readonly rules;
    private readonly options;
    private readonly state;
    /** Declaration head, captured by the first assembly and never replaced. */
    private catalog;
    /** Names the head declares. */
    private readonly catalogNames;
    /** Definitions the current step admits, recorded by the last assembly. */
    private lastAdmitted;
    /** Names the current batch's step admits. */
    private admittedNames;
    constructor(ctx: Context, agent: Agent, rules: ClassificationRules, options: ExecutorOptions, state: DisclosureStateHandle);
    /** Names the frozen head declares; empty before the first assembly. */
    declaredNames(): ReadonlySet<string>;
    /** Definitions the current step admits, captured by the last assembly. */
    admittedDefinitions(): readonly ToolDefinition[];
    /**
     * Capture the head from the first assembly, then return it unchanged.
     * The first assembly's admission is exactly the declaration set the session
     * starts with, so the head matches what every later request would have
     * declared while the tool set is unchanged.
     * @param tools - definitions this step admits, in registry order.
     * @returns the frozen model-facing catalog.
     */
    describe(tools: readonly ToolDefinition[]): ToolModelInput;
    /**
     * Execute one batch against the frozen head and the admitted dynamic set.
     * @param input - original calls, admission, agent, and logging step.
     * @returns settled results in model order.
     */
    execute(input: ToolBatchInput): Promise<ToolBatchResult>;
    /**
     * Resolve one call name: the step's admission first, then the registered
     * definition for a name the head declares or the model was told about.
     * @param name - tool name the model called.
     * @param scope - calling agent scope.
     * @param toolSet - step admission, when one exists.
     * @returns the definition to run, or undefined for an unknown tool.
     */
    private resolve;
    /**
     * Decide the model-facing denial for a declared but unadmitted name, and for a
     * dynamic tool that must be loaded first. Runs before policy and approval.
     * @param name - tool name the model called.
     * @returns the denial, or undefined to let dispatch proceed.
     */
    private reject;
}
