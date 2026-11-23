/** 保持声明基线稳定，动态工具复用宿主执行管线，并按当步准入与已保存定义校验。 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { HostBindings } from './host.ts';
import type { ToolBatchInput, ToolBatchResult, ToolDefinition, ToolExecutor, ToolModelInput } from '@deepseek-ai/dsh-tools';
import { type ClassificationRules, type ToolSchemaLike } from './catalog.ts';
import type { DisclosedEntry } from './disclosure.ts';
import { type StrategyRules, type ToolStrategy } from './strategy.ts';
/** Delivered disclosure state shared with the pre-step listener. */
export interface DisclosureStateHandle {
    /** Definitions the model has been told about. */
    disclosed(): ReadonlyMap<string, DisclosedEntry>;
    /** Names whose definition was delivered through `tool_load`. */
    loaded(): ReadonlySet<string>;
    /** Definitions the model has read, in delivery order. */
    definitions(): ReadonlyMap<string, ToolSchemaLike>;
}
/** Runtime settings the executor reads on every step. */
export interface ExecutorOptions {
    /** Whether a dynamic tool must be loaded before it may run. */
    readonly requireLoad: boolean;
    /** Configured denial reasons by tool name. */
    readonly unavailableReasons: Readonly<Record<string, string>>;
    /** Concurrency used when the loop supplies none. */
    readonly maxParallelCalls: number;
    /** Route matching rules for the declare-on-load strategy. */
    readonly strategyRules: StrategyRules;
    /** Name of the tool that delivers a definition on demand. */
    readonly loadToolName: string;
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
    private readonly host;
    /** 原生路由只更新已有顶层工具的定义，保持名单及顺序不变。 */
    private catalog;
    /** Names the head declares. */
    private readonly catalogNames;
    /** Definitions the current step admits, recorded by the last assembly. */
    private lastAdmitted;
    private noWiderSandbox;
    private stepCatalog;
    /** Names the current batch's step admits. */
    private admittedNames;
    /** Strategy settled by the current step's assembly, so every reader agrees. */
    private stepStrategy;
    private stepRoute;
    /** Whether the missing-load-tool diagnostic was already reported. */
    private loadWarningReported;
    constructor(ctx: Context, agent: Agent, rules: ClassificationRules, options: ExecutorOptions, state: DisclosureStateHandle, host: HostBindings);
    /** Names the frozen head declares, plus every loaded tool on a declare route. */
    declaredNames(): ReadonlySet<string>;
    /** Definitions the current step admits, captured by the last assembly. */
    admittedDefinitions(): readonly ToolDefinition[];
    /** Model-facing projection shared by catalog, disclosures and load. */
    projectDefinition(definition: ToolDefinition): ToolSchemaLike;
    /**
     * 原生策略沿用已保存头部的名单；定义发生变化时就地替换，避免依赖同名追加。
     * declare 仍把已加载定义加入顶层，切回原生时按该已保存头部建立新基线。
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
     * How this step's route receives dynamic tools.
     *
     * The assembly that described this step's head fixes it once. Every later
     * reader in the same step — declaration names, the load requirement, the
     * disclosure listener — sees that one decision, so a model switch cannot make
     * the head and the announcement disagree.
     * @returns the recorded strategy, or the current route's before any assembly.
     */
    planStrategy(): ToolStrategy;
    /** 配置保存仅影响下次组装，发送时必须仍是本步捕获的原生路由。 */
    matchesResponsesRoute(request: {
        readonly provider: string;
        readonly model: string;
    }): boolean;
    /**
     * Capture the declaration head from the first assembly.
     * @param tools - definitions the first assembly admits.
     * @returns the frozen model-facing catalog.
     */
    private capture;
    /**
     * Append every loaded definition to the frozen head.
     * A loaded tool the step still admits uses its live definition, so argument
     * validation matches the call it will run; a tool that no longer admits keeps
     * the definition the model read, because the head must not shrink.
     * @param catalog - frozen declaration head.
     * @returns the head followed by the loaded definitions, in load order.
     */
    private withDeclared;
    /**
     * Report once that a declare route cannot load anything because the frozen
     * head does not declare the load tool.
     */
    private reportMissingLoadTool;
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
    /** Whether a dynamic tool must be loaded before it may run on this route. */
    private requiresLoad;
}
