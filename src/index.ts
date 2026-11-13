/**
 * Freeze the tool declaration head and disclose later tools at the conversation
 * tail.
 *
 * A model request whose tool list changes forces the agent loop to resend the
 * complete system prompt and declarations, which discards the provider's cached
 * prefix. This plugin keeps the head constant: the first step's declaration set
 * is captured, later admissions are delivered as recorded user messages, and a
 * call to a tool the step does not admit fails through an executable denial
 * instead of running.
 *
 * @module dsh-dynamic-tools
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ClassificationRules } from './catalog.ts'
import { registerDisclosure, type DiscloseOptions } from './disclose.ts'
import type { StableCatalogExecutor } from './executor.ts'
import { installAgent, type InstallOptions } from './install.ts'
import { SOURCE_KIND } from './source.ts'
import { createToolLoad, TOOL_LOAD_NAME } from './tool-load.ts'

/** Cordis plugin name. */
export const name = 'dynamic-tools'

/** Services the plugin registers into. */
export const inject = ['tools', 'systemPrompt']

/** Tool-selection and disclosure settings. */
export interface Config {
  /** Install for agents that already exist when this plugin loads. */
  installExistingAgents: boolean
  /** Preset ids left untouched, so their own executor keeps the declaration path. */
  skipPresets: string[]
  dynamic: {
    /** Exact tool names disclosed at the conversation tail. */
    names: string[]
    /** Tool-name prefixes disclosed at the conversation tail. */
    prefixes: string[]
    /** Exact names forced into the frozen head. */
    inlineNames: string[]
  }
  disclosure: {
    /** Attach definitions to the disclosure, or announce names for `tool_load`. */
    mode: 'schema' | 'names'
    /** Require `tool_load` before a dynamic tool may run. */
    requireLoad: boolean
    /** Maximum tools announced in one message. */
    maxToolsPerMessage: number
    /** Maximum bytes of one attached definition. */
    maxSchemaBytes: number
    /** Maximum bytes of one disclosure message. */
    maxMessageBytes: number
    /** Announce tools that stop being available. */
    announceRemovals: boolean
  }
  /** Model-facing reason reported when a declared tool is not admitted. */
  unavailableReasons: Record<string, string>
  /** Concurrency used when the loop supplies no limit. */
  maxParallelCalls: number
}

/** Schemastery validation; invalid values fail at load. */
export const Config: z<Config> = z.object({
  installExistingAgents: z.boolean().default(true)
    .description('Install for agents that already exist when this plugin loads.'),
  skipPresets: z.array(z.string()).default(['ptc'])
    .description('Preset ids whose own tool executor keeps the declaration path.'),
  dynamic: z.object({
    names: z.array(z.string()).default(['exit_plan_mode'])
      .description('Exact tool names disclosed at the conversation tail.'),
    prefixes: z.array(z.string()).default([])
      .description('Tool-name prefixes disclosed at the conversation tail.'),
    inlineNames: z.array(z.string()).default([])
      .description('Exact names forced into the frozen head.'),
  }).default({}),
  disclosure: z.object({
    mode: z.union(['schema', 'names']).default('schema')
      .description('Attach definitions to the disclosure, or announce names for tool_load.'),
    requireLoad: z.boolean().default(false)
      .description('Require tool_load before a dynamic tool may run.'),
    maxToolsPerMessage: z.number().min(1).default(8)
      .description('Maximum tools announced in one message.'),
    maxSchemaBytes: z.number().min(1).default(6000)
      .description('Maximum bytes of one attached definition.'),
    maxMessageBytes: z.number().min(1).default(20000)
      .description('Maximum bytes of one disclosure message.'),
    announceRemovals: z.boolean().default(true)
      .description('Announce tools that stop being available.'),
  }).default({}),
  unavailableReasons: z.dict(z.string()).default({
    exit_plan_mode: 'Plan mode is not active in this session. Ask the user to switch to plan mode, then call it again.',
  }).description('Model-facing reason reported when a declared tool is not admitted.'),
  maxParallelCalls: z.number().min(1).default(10)
    .description('Concurrency used when the loop supplies no limit.'),
})

/**
 * Compose validated settings into the two halves the plugin registers.
 * @param config - validated plugin configuration.
 * @returns classification, execution, and disclosure settings.
 */
function resolveSettings(config: Config): {
  rules: ClassificationRules
  install: Omit<InstallOptions, 'executors' | 'reported'>
  disclose: Omit<DiscloseOptions, 'catalogNames' | 'admitted'>
} {
  const rules: ClassificationRules = {
    dynamicNames: config.dynamic.names,
    dynamicPrefixes: config.dynamic.prefixes,
    inlineNames: config.dynamic.inlineNames,
  }
  return {
    rules,
    install: {
      sourceKind: SOURCE_KIND,
      rules,
      executor: {
        requireLoad: config.disclosure.requireLoad,
        unavailableReasons: config.unavailableReasons,
        maxParallelCalls: config.maxParallelCalls,
      },
      skipPresets: config.skipPresets,
    },
    disclose: {
      sourceKind: SOURCE_KIND,
      limits: {
        mode: config.disclosure.mode,
        maxToolsPerMessage: config.disclosure.maxToolsPerMessage,
        maxSchemaBytes: config.disclosure.maxSchemaBytes,
        maxMessageBytes: config.disclosure.maxMessageBytes,
      },
      announceRemovals: config.disclosure.announceRemovals,
    },
  }
}

/**
 * Register the load tool, the frozen catalog per agent, and tail disclosure.
 * @param ctx - plugin context owning every registration.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const settings = resolveSettings(config)
  const executors = new WeakMap<Agent, StableCatalogExecutor>()
  const release = new WeakMap<Agent, () => void>()
  const reported = new WeakSet<Agent>()
  const installOptions: InstallOptions = { ...settings.install, executors, reported }

  ctx.effect(() => ctx.tools.register(createToolLoad(ctx, {
    sourceKind: SOURCE_KIND,
    limits: settings.disclose.limits,
  })), `dsh-dynamic-tools: register ${TOOL_LOAD_NAME}`)

  ctx.on('agent/created', ({ agent }) => {
    installAgent(ctx, agent, installOptions, release)
    return undefined
  })

  // An agent's executor belongs to that agent: release it with the agent instead
  // of retaining every closed session's executor until this plugin unloads.
  ctx.on('agent/disposed', ({ agent }) => {
    release.get(agent)?.()
  })

  if (config.installExistingAgents) {
    const agents = ctx.get('agents')
    for (const agent of agents?.list() ?? []) installAgent(ctx, agent, installOptions, release)
  }

  registerDisclosure(ctx, {
    ...settings.disclose,
    catalogNames: agent => executors.get(agent)?.declaredNames() ?? new Set(),
    admitted: agent => executors.get(agent)?.admittedDefinitions(),
  })
}
