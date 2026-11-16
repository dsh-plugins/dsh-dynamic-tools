import { test } from 'node:test'
import assert from 'node:assert/strict'
import { additionBytes, canLoadNative, foldResponses, planResponsesDisclosure, projectResponsesRecords, renderAddition, type ResponsesMessage } from '../src/responses.ts'
import { selectStrategy } from '../src/strategy.ts'
import { toolSignature } from '../src/catalog.ts'
import { DisclosureHistory } from '../src/history.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { HostBindings } from '../src/host.ts'
import { StableCatalogExecutor } from '../lib/executor.js'

function addition(id: string, name = id, description = '定义'): ResponsesMessage {
  const record = { version: 1 as const, id, tools: [{ type: 'function' as const, name, description, parameters: { type: 'object', properties: {}, additionalProperties: false }, strict: false as const }] }
  return { id: `message-${id}`, role: 'user', content: [{ type: 'text', text: renderAddition(record) }], source: { kind: 'dynamic-tools', responsesToolAddition: record } }
}

test('原生路由先于 declare，provider 精确匹配并支持模型别名通配', () => {
  const rules = { models: ['gpt*'], providers: [], responses: [{ provider: 'custom', models: ['alias-*', 'gpt*'] }] }
  assert.equal(selectStrategy({ provider: 'custom', model: 'gpt-6' }, rules), 'responses')
  assert.equal(selectStrategy({ provider: 'custom', model: 'ALIAS-reasoner' }, rules), 'responses')
  assert.equal(selectStrategy({ provider: 'Custom', model: 'gpt-6' }, rules), 'declare')
  assert.equal(selectStrategy({ provider: 'custom', model: 'other' }, rules), 'tail')
  assert.equal(selectStrategy({ provider: 'custom', model: 'alias' }, { ...rules, responses: [] }), 'tail')
  assert.equal(selectStrategy({ provider: 'custom', model: 'any' }, { ...rules, responses: [{ provider: 'custom', models: [] }] }), 'responses')
})

test('恢复与 fork 按历史顺序折叠同名更新，原记录保持不变', () => {
  const messages = [addition('a', 'one'), addition('b', 'two'), addition('c', 'one', '更新')]
  const original = JSON.stringify(messages)
  const state = foldResponses(messages)
  assert.deepEqual([...state.definitions.keys()], ['one', 'two'])
  assert.equal(state.definitions.get('one')?.description, '更新')
  assert.deepEqual(projectResponsesRecords(messages).map(record => record.addition.id), ['a', 'b', 'c'])
  assert.equal(foldResponses(messages.slice(0, 2)).definitions.get('one')?.description, '定义')
  assert.equal(JSON.stringify(messages), original)
})

test('移除只撤销可见状态，重新准入沿用历史定义并可加载更新', () => {
  const added = addition('a', 'tool')
  const schema = { name: 'tool', description: '定义', parameters: { type: 'object', properties: {}, additionalProperties: false } }
  const removed: ResponsesMessage = { role: 'user', content: [], source: { kind: 'dynamic-tools', responsesToolNotice: { version: 1, added: [], removed: ['tool'] } } }
  const state = foldResponses([added, removed])
  assert.equal(state.disclosed.has('tool'), false)
  assert.equal(state.loaded.has('tool'), true)
  assert.deepEqual(state.definitions.get('tool'), schema)
  const reintroduced: ResponsesMessage = { role: 'user', content: [], source: { kind: 'dynamic-tools', responsesToolNotice: { version: 1, added: [{ name: 'tool', signature: toolSignature(schema) }], removed: [] } } }
  assert.equal(foldResponses([added, removed, reintroduced]).disclosed.has('tool'), true)
  assert.equal(foldResponses([added, removed, reintroduced, addition('update', 'tool', '新定义')]).definitions.get('tool')?.description, '新定义')
})

test('旧文本不能冒充原生声明，损坏记录与重复标识必须诊断', () => {
  const original = addition('a')
  assert.equal(foldResponses([{ ...original, source: { kind: 'user' } }]).definitions.size, 0)
  assert.equal(foldResponses([{ ...original, source: { kind: 'dynamic-tools' } }]).definitions.size, 0)
  assert.throws(() => projectResponsesRecords([original, { ...original, id: 'other' }]), /重复/)
  assert.throws(() => projectResponsesRecords([{ ...original, id: undefined }]), /标识/)
  assert.throws(() => projectResponsesRecords([{ ...original, content: [{ type: 'text', text: '修改' }] }]), /正文/)
})

test('已保存的 header 作为基线，compaction 后只保留有效历史中的声明', () => {
  const baseline = [{ name: 'static', description: '初始工具', parameters: {} }]
  let messages: ResponsesMessage[] = []
  let seq = 0, generation = 0
  const agent = { session: { get seq() { return seq }, surface: { get contentGeneration() { return generation } }, deriveMessages: () => messages, requestHeader: () => ({ tools: baseline }) } } as unknown as Agent
  const history = new DisclosureHistory()
  const planned = addition('a')
  assert.deepEqual([...history.read(agent, 'responses').loaded], ['static'])
  assert.equal(history.read(agent, 'responses').loaded.has('a'), false)
  messages = [planned]; seq++
  assert.equal(history.read(agent, 'responses').loaded.has('a'), true)
  messages = []; generation++
  assert.deepEqual([...history.read(agent, 'responses').loaded], ['static'])
  const second = { session: { ...agent.session, deriveMessages: () => [] } } as unknown as Agent
  assert.equal(history.read(second, 'responses').loaded.has('a'), false)
})

test('原生加载同时限制 schema 和最终消息的 UTF-8 大小', () => {
  const schema = { name: '工具', description: '很长的说明'.repeat(20), parameters: {} }
  const limits = { mode: 'schema' as const, maxToolsPerMessage: 8, maxSchemaBytes: 6000, maxMessageBytes: 20000 }
  assert.equal(canLoadNative(schema, limits), true)
  assert.equal(canLoadNative(schema, { ...limits, maxSchemaBytes: 20 }), false)
  assert.equal(canLoadNative(schema, { ...limits, maxMessageBytes: 200 }), false)
})

test('自动披露、显式加载、重复披露和同名更新按已保存状态规划', () => {
  const schemas = ['one', 'two'].map(name => ({ name, description: '定义', parameters: {} }))
  const limits = { mode: 'schema' as const, maxToolsPerMessage: 8, maxSchemaBytes: 6000, maxMessageBytes: 20000 }
  assert.equal(planResponsesDisclosure(schemas, foldResponses([]), limits, false).additions.flat().length, 2)
  const required = planResponsesDisclosure(schemas, foldResponses([]), limits, true)
  assert.equal(required.additions.length, 0)
  assert.deepEqual(required.notices.flatMap(item => item.batch.names), ['one', 'two'])
  const state = foldResponses([], schemas)
  assert.deepEqual(planResponsesDisclosure(schemas, state, limits, false), { additions: [], notices: [] })
  const changed = [{ ...schemas[0]!, description: '新定义' }, schemas[1]!]
  assert.deepEqual(planResponsesDisclosure(changed, state, limits, false).additions, [[changed[0]]])
  assert.equal(planResponsesDisclosure(changed, state, { ...limits, mode: 'names' }, false).notices[0]?.notice.added[0]?.signature, toolSignature(changed[0]!))
})

test('按最终文本大小和工具数量拆分原生定义及移除通知', () => {
  const schemas = Array.from({ length: 8 }, (_, i) => ({ name: `tool_${i}`, description: '中文定义'.repeat(10), parameters: {} }))
  const limits = { mode: 'schema' as const, maxToolsPerMessage: 2, maxSchemaBytes: 6000, maxMessageBytes: additionBytes(schemas.slice(0, 2)) }
  const initial = planResponsesDisclosure(schemas, foldResponses([]), limits, false)
  assert.equal(initial.additions.length, 4)
  for (const batch of initial.additions) { assert.ok(additionBytes(batch) <= limits.maxMessageBytes) }
  const removed = planResponsesDisclosure([], foldResponses([], schemas), limits, false)
  assert.equal(removed.notices.length, 4)
  for (const notice of removed.notices) { assert.ok(new TextEncoder().encode(notice.text).length <= limits.maxMessageBytes) }
  assert.throws(() => planResponsesDisclosure(schemas, foldResponses([]), { ...limits, maxMessageBytes: 20 }, true), /无法容纳/)
})

test('旧会话缺少加载入口或入口定义升级时直接追加入口，避免要求自身加载', () => {
  const load = { name: 'tool_load', description: '当前入口', parameters: {} }
  const dynamic = { name: 'dynamic', description: '定义', parameters: {} }
  const limits = { mode: 'names' as const, maxToolsPerMessage: 8, maxSchemaBytes: 6000, maxMessageBytes: 20000 }
  for (const baseline of [[], [{ ...load, description: '旧入口' }]]) {
    const plan = planResponsesDisclosure([load, dynamic], foldResponses([], baseline), limits, true)
    assert.deepEqual(plan.additions, [[load]])
    assert.deepEqual(plan.notices.flatMap(item => item.batch.names), ['dynamic'])
  }
  assert.throws(() => planResponsesDisclosure([load], foldResponses([]), { ...limits, maxSchemaBytes: 1 }, true), /加载入口/)
})

test('进入原生策略时统一恢复 header 基线，路由配置变更从下次组装生效', () => {
  const load = { name: 'tool_load', description: '加载', parameters: {} }
  const dynamic = { name: 'dynamic', description: '定义', parameters: {} }
  let selected = { provider: 'native', model: 'gpt-test' }
  let header: { tools?: readonly typeof load[] } | undefined
  let routes = [{ provider: 'native', models: ['*'] }]
  const agent = { model: { current: () => selected }, session: { requestHeader: () => header } } as unknown as Agent
  const state = foldResponses([], [dynamic])
  const host = { projectToolSchema: (value: unknown) => value, deepFreeze: Object.freeze } as unknown as HostBindings
  const executor = new StableCatalogExecutor({} as Context, agent, { dynamicNames: ['dynamic'], dynamicPrefixes: [], inlineNames: ['tool_load'] }, {
    requireLoad: true, maxParallelCalls: 1, unavailableReasons: {}, loadToolName: 'tool_load', strategyRules: { models: ['gpt*'], providers: [], get responses() { return routes } },
  }, { definitions: () => state.definitions, disclosed: () => state.disclosed, loaded: () => state.loaded }, host)
  const definitions = [load, dynamic] as unknown as ToolDefinition[]
  header = { tools: executor.describe(definitions).schemas }
  assert.deepEqual(header.tools?.map(tool => tool.name), ['tool_load'])
  routes = []
  assert.equal(executor.matchesResponsesRoute(selected), true)
  assert.equal(executor.matchesResponsesRoute({ ...selected, model: 'other' }), false)
  header = { tools: executor.describe(definitions).schemas }
  assert.equal(executor.planStrategy(), 'declare')
  assert.deepEqual(header.tools?.map(tool => tool.name), ['tool_load', 'dynamic'])
  routes = [{ provider: 'native', models: ['*'] }]
  const restored = executor.describe(definitions).schemas
  assert.deepEqual(restored, header.tools)
  assert.equal(foldResponses([], restored).definitions.has('dynamic'), true)
})
