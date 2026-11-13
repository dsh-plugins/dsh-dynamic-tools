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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { projectToolSchema } from '@deepseek-ai/dsh-tools'
import type {
  ResolvedToolSet,
  ToolBatchInput,
  ToolBatchResult,
  ToolDefinition,
  ToolExecutor,
  ToolModelInput,
} from '@deepseek-ai/dsh-tools'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { classifyTool, type ClassificationRules, type ToolSchemaLike } from './catalog.ts'
import type { DisclosedEntry } from './disclosure.ts'
import { loadFirstReason, unavailableReason } from './render.ts'

/** Delivered disclosure state shared with the pre-step listener. */
export interface DisclosureStateHandle {
  /** Definitions the model has been told about. */
  disclosed(): ReadonlyMap<string, DisclosedEntry>
  /** Names whose definition was delivered through `tool_load`. */
  loaded(): ReadonlySet<string>
}

/** Runtime settings the executor reads on every step. */
export interface ExecutorOptions {
  /** Whether a dynamic tool must be loaded before it may run. */
  readonly requireLoad: boolean
  /** Configured denial reasons by tool name. */
  readonly unavailableReasons: Readonly<Record<string, string>>
  /** Concurrency used when the loop supplies none. */
  readonly maxParallelCalls: number
}

/**
 * Executes the frozen declaration head plus admitted dynamic tools.
 */
export class StableCatalogExecutor implements ToolExecutor {
  /** Declaration head, captured by the first assembly and never replaced. */
  private catalog: readonly ToolSchemaLike[] | undefined
  /** Names the head declares. */
  private readonly catalogNames = new Set<string>()
  /** Definitions the current step admits, recorded by the last assembly. */
  private lastAdmitted: readonly ToolDefinition[] = []
  /** Names the current batch's step admits. */
  private admittedNames: ReadonlySet<string> = new Set()

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly rules: ClassificationRules,
    private readonly options: ExecutorOptions,
    private readonly state: DisclosureStateHandle,
  ) {}

  /** Names the frozen head declares; empty before the first assembly. */
  declaredNames(): ReadonlySet<string> {
    return this.catalogNames
  }

  /** Definitions the current step admits, captured by the last assembly. */
  admittedDefinitions(): readonly ToolDefinition[] {
    return this.lastAdmitted
  }

  /**
   * Capture the head from the first assembly, then return it unchanged.
   * The first assembly's admission is exactly the declaration set the session
   * starts with, so the head matches what every later request would have
   * declared while the tool set is unchanged.
   * @param tools - definitions this step admits, in registry order.
   * @returns the frozen model-facing catalog.
   */
  describe(tools: readonly ToolDefinition[]): ToolModelInput {
    this.lastAdmitted = tools
    if (this.catalog === undefined) {
      this.catalog = Object.freeze(tools
        .filter(definition => classifyTool(definition.name, this.rules) === 'inline')
        .map(definition => Object.freeze(projectToolSchema(definition, true))))
      for (const schema of this.catalog) this.catalogNames.add(schema.name)
    }
    return { schemas: [...this.catalog] }
  }

  /**
   * Execute one batch against the frozen head and the admitted dynamic set.
   * @param input - original calls, admission, agent, and logging step.
   * @returns settled results in model order.
   */
  execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    this.admittedNames = new Set((input.toolSet?.view(this.agent) ?? new Map<string, ToolDefinition>()).keys())
    const pipeline = new ToolExecutionPipeline(this.ctx, {
      get: (name: string, scope: ScopeKey | undefined, toolSet: ResolvedToolSet | undefined) => this.resolve(name, scope, toolSet),
      reject: (name: string) => this.reject(name),
    })
    return executeToolBatch(input, pipeline, () => input.maxParallelToolCalls ?? this.options.maxParallelCalls)
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
    if (admitted !== undefined) return admitted
    if (!this.catalogNames.has(name) && !this.state.disclosed().has(name)) return undefined
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
      if (this.catalogNames.has(name) || !this.options.requireLoad) return undefined
      return this.state.loaded().has(name) ? undefined : new Error(loadFirstReason(name))
    }
    if (!this.catalogNames.has(name) && !this.state.disclosed().has(name)) return undefined
    return new Error(unavailableReason(name, this.options.unavailableReasons[name]))
  }
}
