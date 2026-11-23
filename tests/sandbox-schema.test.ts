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

test('原生路由首次组装工具头部时按有效权限决定是否提供提权参数', () => {
  for (const mode of ['danger-full-access', 'workspace-write', 'read-only', undefined]) {
    const f = setup(true)
    f.setMode(mode)
    const executor = f.makeExecutor()
    const first = executor.describe([native]).schemas[0]
    const properties = first.parameters.properties as object
    for (const field of ['sandbox_permissions', 'justification']) {
      assert.equal(Object.hasOwn(properties, field), mode !== 'danger-full-access')
    }
    assert.equal(executor.describe([native]).schemas[0], first)
  }
})

test('原生路由更新旧头部和权限切换，已保存的同名追加不能覆盖顶层', () => {
  const f = setup(true)
  const unchanged = { name: 'unchanged', description: '', parameters: {} }
  const oldHeader = [unchanged, raw]
  f.setHeader(oldHeader)
  const executor = f.makeExecutor()
  const head = executor.describe([native]).schemas
  assert.deepEqual(head.map(tool => tool.name), ['unchanged', 'pwsh'])
  assert.deepEqual(head[0], unchanged)
  assert.equal(hasEscalation(head[1]), false)
  assert.equal(hasEscalation(oldHeader[1]), true)
  assert.equal(executor.describe([]).schemas[1], oldHeader[1])
  f.setHeader(head)
  assert.equal(executor.describe([native]).schemas[1], head[1])

  const dynamic = { name: 'late', description: '动态工具', parameters: {} }
  const recorded = additionMessage(f.host, [head[1], dynamic])
  const originalRecord = JSON.stringify(recorded)
  assert.deepEqual(projectResponsesRecords([recorded])[0].addition.tools.map(tool => tool.name), ['pwsh', 'late'])
  const before = foldResponses([], oldHeader)
  const candidates = [unchanged, head[1], dynamic]
  const plan = planResponsesDisclosure(candidates, before, limits, false, executor.declaredNames())
  assert.deepEqual(plan.additions, [[dynamic]])
  assert.deepEqual(plan.notices, [])

  f.setMode('workspace-write')
  const restored = executor.describe([native]).schemas
  assert.equal(hasEscalation(restored[1]), true)
  const after = foldResponses([recorded], restored)
  assert.equal(after.definitions.get('pwsh'), restored[1])
  assert.deepEqual(after.definitions.get('late'), dynamic)
  assert.deepEqual(planResponsesDisclosure([unchanged, restored[1], dynamic], after, limits, true, executor.declaredNames()), { additions: [], notices: [] })
  assert.equal(JSON.stringify(recorded), originalRecord)
})
