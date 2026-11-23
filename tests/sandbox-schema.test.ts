import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, projectToolSchema } from '@deepseek-ai/dsh-tools'
import { StableCatalogExecutor } from '../lib/executor.js'
import { planResponsesDisclosure, foldResponses, additionMessage, projectResponsesRecords } from '../src/responses.ts'
import { projectSandboxSchema } from '../src/sandbox-schema.ts'
import type { HostBindings } from '../src/host.ts'
import type { ToolSchemaLike } from '../src/catalog.ts'

const native = defineTool({
  name: 'pwsh', description: 'PowerShell',
  parameters: {
    command: { type: 'string', required: true },
    sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'], description: 'The narrowest wider sandbox mode for a one-shot retry of the exact command the sandbox just denied; the retry asks the user for approval.' },
    justification: { type: 'string', description: 'Required with sandbox_permissions: one sentence for the user.' },
  },
  output: { schema: { type: 'string' }, render: () => [] },
  execute: () => 'unused',
})
const raw = projectToolSchema(native, true)
const hasEscalation = (schema: ToolSchemaLike) => Object.hasOwn(schema.parameters.properties as object, 'sandbox_permissions')
const limits = { mode: 'schema' as const, maxToolsPerMessage: 8, maxSchemaBytes: 6000, maxMessageBytes: 20000 }

function setup(responses: boolean) {
  let mode: string | undefined = 'danger-full-access'
  let header: { tools: readonly ToolSchemaLike[] } | undefined
  const session = { requestHeader: () => header }
  const agent = {
    session,
    ctx: { get: () => ({ resolve: (input: { session: unknown }) => {
      assert.equal(input.session, session)
      return { mode }
    } }) },
    model: { current: () => ({ provider: 'native', model: 'gpt-test' }) },
  } as unknown as Agent
  const host = { projectToolSchema, deepFreeze: Object.freeze, createUserMessage: (options: object) => ({ ...options, id: 'test', role: 'user' }) } as unknown as HostBindings
  const state = foldResponses([])
  const makeExecutor = () => new StableCatalogExecutor({ logger: { warn() {} } } as unknown as Context, agent, { dynamicNames: [], dynamicPrefixes: [], inlineNames: [] }, {
    requireLoad: false, maxParallelCalls: 1, unavailableReasons: {}, loadToolName: 'tool_load',
    strategyRules: { models: [], providers: [], responses: responses ? [{ provider: 'native', models: ['*'] }] : [] },
  }, { definitions: () => state.definitions, disclosed: () => state.disclosed, loaded: () => state.loaded }, host)
  return { makeExecutor, host, setMode: (value?: string) => { mode = value }, setHeader: (tools: readonly ToolSchemaLike[]) => { header = { tools } } }
}

test('full access removes only the host escalation parameters, without changing the registered schema', () => {
  const reduced = projectSandboxSchema(raw, true)
  assert.deepEqual(reduced.parameters.properties, { command: { type: 'string' } })
  assert.deepEqual(reduced.parameters.required, ['command'])
  assert.equal(hasEscalation(raw), true)
  assert.equal(projectSandboxSchema(raw, false), raw)
  const other = { ...raw, name: 'plugin_shell' }
  assert.equal(projectSandboxSchema(other, true), other)
  const custom = { ...raw, parameters: { type: 'object', properties: { sandbox_permissions: { type: 'string' }, justification: { type: 'string' } } } }
  assert.equal(projectSandboxSchema(custom, true), custom)
})

test('ordinary catalog tracks standing mode, including unknown, without losing its original schema', () => {
  const f = setup(false)
  const executor = f.makeExecutor()
  assert.equal(hasEscalation(executor.describe([native]).schemas[0]), false)
  f.setMode('read-only')
  assert.equal(hasEscalation(executor.describe([native]).schemas[0]), true)
  f.setMode()
  assert.equal(hasEscalation(executor.describe([native]).schemas[0]), true)
  f.setMode('danger-full-access')
  assert.equal(hasEscalation(executor.describe([native]).schemas[0]), false)
})

test('Responses uses immutable saved declarations and discloses the updated permissions at the tail', () => {
  const f = setup(true)
  const oldHeader = [raw]
  f.setHeader(oldHeader)
  const executor = f.makeExecutor()
  assert.equal(hasEscalation(executor.describe([native]).schemas[0]), true)
  const reduced = executor.projectDefinition(native)
  assert.equal(hasEscalation(reduced), false)
  const before = foldResponses([], oldHeader)
  const plan = planResponsesDisclosure([reduced], before, limits, false)
  assert.deepEqual(plan.additions, [[reduced]])
  const recorded = additionMessage(f.host, [reduced])
  const originalRecord = JSON.stringify(recorded)
  assert.equal(hasEscalation(projectResponsesRecords([recorded])[0].addition.tools[0]), false)
  const after = foldResponses([recorded], oldHeader)
  assert.deepEqual(planResponsesDisclosure([reduced], after, limits, false).additions, [])
  f.setMode('workspace-write')
  executor.describe([native])
  const restored = executor.projectDefinition(native)
  assert.equal(hasEscalation(restored), true)
  assert.deepEqual(planResponsesDisclosure([restored], after, limits, false).additions, [[restored]])
  assert.equal(JSON.stringify(recorded), originalRecord)
})
