/** 保持声明基线稳定，动态工具复用宿主执行管线，并按当步准入与已保存定义校验。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HostBindings } from './host.ts'
import type {
  ResolvedToolSet,
  ToolBatchInput,
  ToolBatchResult,
  ToolDefinition,
  ToolExecutor,
  ToolModelInput,
} from '@deepseek-ai/dsh-tools'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import {
  classifyTool,
  extendCatalog,
  toolSignature,
  type ClassificationRules,
  type ToolSchemaLike,
} from './catalog.ts'
import { hasNoWiderSandbox, projectSandboxSchema, projectSavedSandboxSchema } from './sandbox-schema.ts'
import type { DisclosedEntry } from './disclosure.ts'
import { loadFirstReason, unavailableReason } from './render.ts'
import { selectStrategy, type StrategyRules, type ToolStrategy } from './strategy.ts'

/** Delivered disclosure state shared with the pre-step listener. */
export interface DisclosureStateHandle {
  /** Definitions the model has been told about. */
  disclosed(): ReadonlyMap<string, DisclosedEntry>
  /** Names whose definition was delivered through `tool_load`. */
  loaded(): ReadonlySet<string>
  /** Definitions the model has read, in delivery order. */
  definitions(): ReadonlyMap<string, ToolSchemaLike>
}

/** Runtime settings the executor reads on every step. */
export interface ExecutorOptions {
  /** Whether a dynamic tool must be loaded before it may run. */
  readonly requireLoad: boolean
  /** Configured denial reasons by tool name. */
  readonly unavailableReasons: Readonly<Record<string, string>>
  /** Concurrency used when the loop supplies none. */
  readonly maxParallelCalls: number
  /** Route matching rules for the declare-on-load strategy. */
  readonly strategyRules: StrategyRules
  /** Name of the tool that delivers a definition on demand. */
  readonly loadToolName: string
}

/**
 * Executes the frozen declaration head plus admitted dynamic tools.
 */
export class StableCatalogExecutor implements ToolExecutor {
  /** 原生路由只更新已有顶层工具的定义，保持名单及顺序不变。 */
  private catalog: readonly ToolSchemaLike[] | undefined
  /** Names the head declares. */
  private readonly catalogNames = new Set<string>()
  /** Definitions the current step admits, recorded by the last assembly. */
  private lastAdmitted: readonly ToolDefinition[] = []
  private noWiderSandbox = false
  private stepCatalog: readonly ToolSchemaLike[] = []
  /** Names the current batch's step admits. */
  private admittedNames: ReadonlySet<string> = new Set()
  /** Strategy settled by the current step's assembly, so every reader agrees. */
  private stepStrategy: ToolStrategy | undefined
  private stepRoute: { readonly provider: string, readonly model: string } | undefined
  /** Whether the missing-load-tool diagnostic was already reported. */
  private loadWarningReported = false

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly rules: ClassificationRules,
    private readonly options: ExecutorOptions,
    private readonly state: DisclosureStateHandle,
    private readonly host: HostBindings,
  ) {}

  /** Names the frozen head declares, plus every loaded tool on a declare route. */
  declaredNames(): ReadonlySet<string> {
    if (this.planStrategy() !== 'declare') { return this.catalogNames }
    const names = new Set(this.catalogNames)
    for (const name of this.state.definitions().keys()) { names.add(name) }
    return names
  }

  /** Definitions the current step admits, captured by the last assembly. */
  admittedDefinitions(): readonly ToolDefinition[] {
    return this.lastAdmitted
  }

  /** Model-facing projection shared by catalog, disclosures and load. */
  projectDefinition(definition: ToolDefinition): ToolSchemaLike {
    return projectSandboxSchema(this.host.projectToolSchema(definition, true), this.noWiderSandbox)
  }

  /**
   * 原生策略沿用已保存头部的名单；定义发生变化时就地替换，避免依赖同名追加。
   * declare 仍把已加载定义加入顶层，切回原生时按该已保存头部建立新基线。
   * @param tools - definitions this step admits, in registry order.
   * @returns the frozen model-facing catalog.
   */
  describe(tools: readonly ToolDefinition[]): ToolModelInput {
    this.lastAdmitted = tools
    this.noWiderSandbox = hasNoWiderSandbox(this.agent)
    const previousStrategy = this.stepStrategy
    const selection = this.agent.model.current()
    this.stepRoute = selection === undefined ? undefined : { provider: selection.provider, model: selection.model }
    this.stepStrategy = selectStrategy(selection, this.options.strategyRules)
    const header = this.stepStrategy === 'responses' ? this.agent.session.requestHeader() : undefined
    if (header !== undefined && previousStrategy !== 'responses') {
      const recorded = header.tools ?? []
      this.catalog = this.host.deepFreeze(structuredClone(recorded))
      this.catalogNames.clear()
      for (const schema of recorded) { this.catalogNames.add(schema.name) }
    }
    const live = new Map(tools.map(tool => [tool.name, tool]))
    // 重试或被拒绝的 pre-step 未必提交了上次组装，已保存的头部仍是基线。
    const baseline = header !== undefined && previousStrategy === 'responses'
      ? header.tools ?? []
      : this.catalog ?? this.capture(tools)
    const catalog = baseline.map(schema => {
      const definition = live.get(schema.name)
      if (this.stepStrategy !== 'responses') {
        const current = definition && this.host.projectToolSchema(definition, true)
        return projectSavedSandboxSchema(schema, current, this.noWiderSandbox)
      }
      if (!definition) { return schema }
      const current = this.projectDefinition(definition)
      return toolSignature(schema) === toolSignature(current) ? schema : this.host.deepFreeze(current)
    })
    if (this.stepStrategy === 'responses') { this.catalog = Object.freeze(catalog) }
    this.stepCatalog = catalog
    if (this.stepStrategy !== 'declare') { return { schemas: [...catalog] } }
    this.reportMissingLoadTool()
    return { schemas: this.withDeclared(catalog) }
  }

  /**
   * Execute one batch against the frozen head and the admitted dynamic set.
   * @param input - original calls, admission, agent, and logging step.
   * @returns settled results in model order.
   */
  execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    this.admittedNames = new Set((input.toolSet?.view(this.agent) ?? new Map<string, ToolDefinition>()).keys())
    const pipeline = new this.host.ToolExecutionPipeline(this.ctx, {
      get: (name: string, scope: ScopeKey | undefined, toolSet: ResolvedToolSet | undefined) => this.resolve(name, scope, toolSet),
      reject: (name: string) => this.reject(name),
    })
    return this.host.executeToolBatch(input, pipeline, () => input.maxParallelToolCalls ?? this.options.maxParallelCalls)
  }

  /**
   * How this step's route receives dynamic tools.
   *
   * The assembly that described this step's head fixes it once. Every later
   * reader in the same step — declaration names, the load requirement, the
   * disclosure listener — sees that one decision, so a model switch cannot make
   * the head and the announcement disagree.
   * @returns the recorded strategy, or the current route's before any assembly.
   */
  planStrategy(): ToolStrategy {
    return this.stepStrategy ?? selectStrategy(this.agent.model.current(), this.options.strategyRules)
  }

  /** 配置保存仅影响下次组装，发送时必须仍是本步捕获的原生路由。 */
  matchesResponsesRoute(request: { readonly provider: string, readonly model: string }): boolean {
    return this.stepStrategy === 'responses' && this.stepRoute?.provider === request.provider && this.stepRoute.model === request.model
  }

  /**
   * Capture the declaration head from the first assembly.
   * @param tools - definitions the first assembly admits.
   * @returns the frozen model-facing catalog.
   */
  private capture(tools: readonly ToolDefinition[]): readonly ToolSchemaLike[] {
    const catalog = Object.freeze(tools
      .filter(definition => classifyTool(definition.name, this.rules) === 'inline')
      .map(definition => this.host.deepFreeze(this.projectDefinition(definition))))
    this.catalog = catalog
    for (const schema of catalog) { this.catalogNames.add(schema.name) }
    return catalog
  }

  /**
   * Append every loaded definition to the frozen head.
   * A loaded tool the step still admits uses its live definition, so argument
   * validation matches the call it will run; a tool that no longer admits keeps
   * the definition the model read, because the head must not shrink.
   * @param catalog - frozen declaration head.
   * @returns the head followed by the loaded definitions, in load order.
   */
  private withDeclared(catalog: readonly ToolSchemaLike[]): ToolSchemaLike[] {
    const live = new Map(this.lastAdmitted.map(definition => [definition.name, definition]))
    const declared: ToolSchemaLike[] = []
    for (const [name, recorded] of this.state.definitions()) {
      if (this.catalogNames.has(name)) { continue }
      const current = live.get(name)
      declared.push(Object.freeze(current === undefined ? projectSandboxSchema(recorded, this.noWiderSandbox) : this.projectDefinition(current)))
    }
    return extendCatalog(catalog, declared)
  }

  /**
   * Report once that a declare route cannot load anything because the frozen
   * head does not declare the load tool.
   */
  private reportMissingLoadTool(): void {
    if (this.loadWarningReported || this.catalogNames.has(this.options.loadToolName)) { return }
    this.loadWarningReported = true
    this.ctx.logger.warn(
      'dsh-dynamic-tools: agent "%s" declares loaded tools in its tool list, but "%s" is absent from its frozen head; dynamic tools cannot be loaded in this session',
      this.agent.id,
      this.options.loadToolName,
    )
  }

  /**
   * Resolve one call name: the step's admission first, then the registered
   * definition for a name the head declares or the model was told about.
   * @param name - tool name the model called.
   * @param scope - calling agent scope.
   * @param toolSet - step admission, when one exists.
   * @returns the definition to run, or undefined for an unknown tool.
   */
  private resolve(
    name: string,
    scope: ScopeKey | undefined,
    toolSet: ResolvedToolSet | undefined,
  ): ToolDefinition | undefined {
    const admitted = toolSet?.view(scope).get(name)
    if (admitted !== undefined) { return admitted }
    if (!this.catalogNames.has(name) && !this.state.disclosed().has(name)
      && !(this.planStrategy() === 'responses' && this.state.definitions().has(name))) { return undefined }
    return this.ctx.tools.definitions(this.agent).find(definition => definition.name === name)
  }

  /**
   * Decide the model-facing denial for a declared but unadmitted name, and for a
   * dynamic tool that must be loaded first. Runs before policy and approval.
   * @param name - tool name the model called.
   * @returns the denial, or undefined to let dispatch proceed.
   */
  private reject(name: string): Error | undefined {
    if (this.admittedNames.has(name)) {
      if (this.planStrategy() === 'responses') {
        const current = this.lastAdmitted.find(definition => definition.name === name)
        const declared = this.stepCatalog.find(schema => schema.name === name) ?? this.state.definitions().get(name)
        const currentSchema = current && this.projectDefinition(current)
        if (!currentSchema || !declared || toolSignature(currentSchema) !== toolSignature(declared)) { return new Error(loadFirstReason(name)) }
        return undefined
      }
      if (this.catalogNames.has(name) || !this.requiresLoad()) { return undefined }
      return this.state.loaded().has(name) ? undefined : new Error(loadFirstReason(name))
    }
    if (!this.catalogNames.has(name) && !this.state.disclosed().has(name)
      && !(this.planStrategy() === 'responses' && this.state.definitions().has(name))) { return undefined }
    return new Error(unavailableReason(name, this.options.unavailableReasons[name]))
  }

  /** Whether a dynamic tool must be loaded before it may run on this route. */
  private requiresLoad(): boolean {
    return this.options.requireLoad || this.planStrategy() === 'declare'
  }
}
