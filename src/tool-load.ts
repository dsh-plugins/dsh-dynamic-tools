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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, projectToolSchema, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { schemaBytes } from './catalog.ts'
import { withDefinition, type DisclosureLimits } from './disclosure.ts'
import { renderLoadedDefinition, renderLoadResult } from './render.ts'
import { currentState, storeState } from './disclose.ts'
import type { SourceKind } from './source.ts'
import type { ToolStrategy } from './strategy.ts'

/** Names this plugin owns; a deployment cannot shadow them. */
export const TOOL_LOAD_NAME = 'tool_load'

/** Settings the load tool needs at call time. */
export interface ToolLoadOptions {
  /** Message source kind owned by this plugin. */
  readonly sourceKind: SourceKind
  /** Validated disclosure limits; `maxSchemaBytes` caps a loaded definition. */
  readonly limits: DisclosureLimits
  /** Strategy this step's executor settled, per installed agent. */
  readonly strategy: (agent: Agent) => ToolStrategy | undefined
  /** Names the frozen head declares, per installed agent. */
  readonly declaredNames: (agent: Agent) => ReadonlySet<string>
}

/**
 * Create the `tool_load` definition.
 * @param ctx - plugin context, used to read the agent's visible tools.
 * @param options - source kind, limits, and the agent's declaration facts.
 * @returns the unregistered definition.
 */
export function createToolLoad(ctx: Context, options: ToolLoadOptions): ToolDefinition {
  return defineTool({
    name: TOOL_LOAD_NAME,
    description: 'Read the full definition of tools that are announced in this conversation but absent from your tool list. Pass their exact names. Definitions arrive as a user message after this result; on a route that loads tools on demand the tool is declared in your tool list from the next step on.',
    parameters: {
      names: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Exact tool names taken from the latest <tools_added> or <tools_load_required> announcement.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          loaded: { type: 'array', items: { type: 'string' }, required: true },
          alreadyAvailable: { type: 'array', items: { type: 'string' }, required: true },
          unavailable: { type: 'array', items: { type: 'string' }, required: true },
          tooLarge: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderLoadResult(value.loaded, value.alreadyAvailable, value.unavailable, value.tooLarge),
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const agent = exec.agent
      if (agent === undefined) {
        throw new ToolContextUnavailableError(`${TOOL_LOAD_NAME} requires a calling Agent`)
      }
      const strategy = options.strategy(agent) ?? 'tail'
      const declared = options.declaredNames(agent)
      const loaded: string[] = []
      const alreadyAvailable: string[] = []
      const unavailable: string[] = []
      const tooLarge: string[] = []
      const definitions = new Map(ctx.tools.definitions(agent).map(definition => [definition.name, definition]))
      let state = currentState(agent, options.sourceKind)
      const wanted = [...new Set(args.names.map(name => name.trim()).filter(name => name.length > 0))]
      for (const name of wanted) {
        const definition = definitions.get(name)
        if (definition === undefined) {
          unavailable.push(name)
          continue
        }
        if (declared.has(name)) {
          // The definition is already in the tool list; repeating it adds nothing.
          alreadyAvailable.push(name)
          continue
        }
        if (!state.disclosed.has(name)) {
          // A registered name nobody announced: bringing it in would declare a
          // tool the model was never told about.
          unavailable.push(name)
          continue
        }
        const schema = projectToolSchema(definition, true)
        if (schemaBytes(schema) > options.limits.maxSchemaBytes) {
          tooLarge.push(name)
          continue
        }
        loaded.push(name)
        state = withDefinition(state, schema)
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: renderLoadedDefinition(schema, strategy) }],
          source: { kind: options.sourceKind, form: 'catalog' },
        }))
      }
      storeState(agent, state)
      return { loaded, alreadyAvailable, unavailable, tooLarge }
    },
    isConcurrencySafe: () => false,
  })
}
