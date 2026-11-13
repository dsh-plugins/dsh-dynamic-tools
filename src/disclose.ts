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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { projectToolSchema } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolSchemaLike } from './catalog.ts'
import { applyDisclosure, planDisclosure, type DisclosedState, type DisclosureLimits } from './disclosure.ts'
import { foldDisclosed } from './fold.ts'
import { renderDisclosure } from './render.ts'
import type { SourceKind } from './source.ts'

/** Everything the pre-step listener needs to plan one step's disclosure. */
export interface DiscloseOptions {
  /** Message source kind owned by this plugin. */
  readonly sourceKind: SourceKind
  /** Validated disclosure limits. */
  readonly limits: DisclosureLimits
  /** Whether names that disappear from the registry are announced. */
  readonly announceRemovals: boolean
  /** Names the frozen head declares, per installed agent. */
  readonly catalogNames: (agent: Agent) => ReadonlySet<string>
  /** Definitions this step admits, recorded by the executor's last assembly. */
  readonly admitted: (agent: Agent) => readonly ToolDefinition[] | undefined
}

/** Process-local delivery state, kept as a fast path beside the durable fold. */
interface HeldState {
  state: DisclosedState
}

/** Per-Agent delivery state without retaining agents. */
const stateByAgent = new WeakMap<Agent, HeldState>()

/**
 * Read the session's delivered state, rebuilding it from durable messages when
 * the process-local holder is missing (resume, fork, compaction).
 * @param agent - agent whose session is read.
 * @param kind - message source kind owned by this plugin.
 * @returns the folded state.
 */
export function currentState(agent: Agent, kind: SourceKind): DisclosedState {
  const holder = stateByAgent.get(agent)
  if (holder !== undefined) return holder.state
  const folded = foldDisclosed(agent.session.deriveMessages(), kind)
  stateByAgent.set(agent, { state: folded })
  return folded
}

/**
 * Replace the process-local state after a disclosure or a load.
 * @param agent - agent whose session was updated.
 * @param state - new state.
 */
export function storeState(agent: Agent, state: DisclosedState): void {
  stateByAgent.set(agent, { state })
}

/**
 * Drop process-local state so the next read folds the durable messages again.
 * @param agent - agent whose session was compacted or replaced.
 */
export function invalidateState(agent: Agent): void {
  stateByAgent.delete(agent)
}

function schemasOutsideCatalog(
  definitions: readonly ToolDefinition[],
  catalogNames: ReadonlySet<string>,
): ToolSchemaLike[] {
  return definitions
    .filter(definition => !catalogNames.has(definition.name))
    .map(definition => projectToolSchema(definition, true))
}

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
 * @returns the messages to append, in order.
 */
export function disclosureMessages(
  ctx: Context,
  agent: Agent,
  admitted: readonly ToolDefinition[],
  executorCatalog: ReadonlySet<string>,
  options: DiscloseOptions,
): readonly UserMessage[] {
  const candidates = schemasOutsideCatalog(admitted, executorCatalog)
  const current = currentState(agent, options.sourceKind)
  const available = new Set(candidates.map(schema => schema.name))
  const removed = options.announceRemovals
    ? [...current.disclosed.keys()].filter(name => !available.has(name) && !executorCatalog.has(name))
    : []
  const batches = planDisclosure(candidates, removed, current, options.limits)
  if (batches.length === 0) {
    // A pruned history still needs its records re-linked for later comparisons.
    const folded = foldDisclosed(agent.session.deriveMessages(), options.sourceKind)
    if (folded.disclosed.size !== current.disclosed.size) storeState(agent, folded)
    return []
  }
  const messages = batches.map(batch => createUserMessage({
    content: [{ type: 'text', text: renderDisclosure(batch) }],
    source: { kind: options.sourceKind, form: 'catalog' },
  }))
  storeState(agent, applyDisclosure(current, batches))
  ctx.logger.debug('dsh-dynamic-tools: disclosed %d batch(es) at step start', batches.length)
  return messages
}

/**
 * Register the pre-step listener that appends disclosures.
 * @param ctx - plugin context owning the listener.
 * @param options - disclosure settings.
 */
export function registerDisclosure(ctx: Context, options: DiscloseOptions): void {
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    try {
      // The executor recorded this step's admission when assembly described the head.
      const admitted = options.admitted(agent)
      if (admitted === undefined) return decision
      const messages = disclosureMessages(ctx, agent, admitted, options.catalogNames(agent), options)
      if (messages.length === 0) return decision
      return { ...decision, messages: [...decision.messages, ...messages] }
    } catch (error: unknown) {
      ctx.logger.warn('dsh-dynamic-tools: failed to disclose tool definitions at step start: %o', error)
      return decision
    }
  })
}
