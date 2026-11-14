import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toolSignature } from '../src/catalog.ts'
import {
  applyDisclosure,
  EMPTY_DISCLOSED,
  oversizedNames,
  planDisclosure,
  withDefinition,
  type DisclosedState,
  type DisclosureLimits,
} from '../src/disclosure.ts'

const limits: DisclosureLimits = {
  mode: 'schema',
  maxToolsPerMessage: 2,
  maxSchemaBytes: 400,
  maxMessageBytes: 1200,
}

const schema = (name: string, description = `does ${name}`, parameters: Record<string, unknown> = {}) => ({
  name,
  description,
  parameters,
})

test('a newly admitted dynamic tool is disclosed once', () => {
  const tool = schema('exit_plan_mode')
  const batches = planDisclosure([tool], [], EMPTY_DISCLOSED, limits)
  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0]?.added.map(entry => entry.name), ['exit_plan_mode'])
  assert.deepEqual(batches[0]?.names, [])
  assert.deepEqual(batches[0]?.removed, [])
})

test('an attached definition is recorded for the declare strategy', () => {
  const tool = schema('exit_plan_mode')
  const batches = planDisclosure([tool], [], EMPTY_DISCLOSED, limits)
  const state = applyDisclosure(EMPTY_DISCLOSED, batches)
  assert.deepEqual([...state.definitions.keys()], ['exit_plan_mode'])
  assert.equal(state.definitions.get('exit_plan_mode'), tool)
})

test('a name announced without a schema records no definition', () => {
  const batches = planDisclosure([schema('mcp__srv__a')], [], EMPTY_DISCLOSED, { ...limits, mode: 'names' })
  const state = applyDisclosure(EMPTY_DISCLOSED, batches)
  assert.equal(state.disclosed.has('mcp__srv__a'), true)
  assert.equal(state.definitions.size, 0)
})

test('an unchanged disclosed tool is not disclosed again', () => {
  const tool = schema('exit_plan_mode')
  const first = planDisclosure([tool], [], EMPTY_DISCLOSED, limits)
  const state = applyDisclosure(EMPTY_DISCLOSED, first)
  assert.deepEqual(planDisclosure([tool], [], state, limits), [])
  assert.equal(state.disclosed.get('exit_plan_mode')?.signature, toolSignature(tool))
  assert.equal(state.loaded.has('exit_plan_mode'), true)
})

test('a changed definition is disclosed again with the new schema', () => {
  const tool = schema('exit_plan_mode')
  const state = applyDisclosure(EMPTY_DISCLOSED, planDisclosure([tool], [], EMPTY_DISCLOSED, limits))
  const changed = schema('exit_plan_mode', 'presents the plan')
  const batches = planDisclosure([changed], [], state, limits)
  assert.deepEqual(batches[0]?.added.map(entry => entry.description), ['presents the plan'])
})

test('a name announced without a schema stays announced', () => {
  const tool = schema('exit_plan_mode')
  const state = applyDisclosure(EMPTY_DISCLOSED, planDisclosure([tool], [], EMPTY_DISCLOSED, { ...limits, mode: 'names' }))
  assert.equal(state.disclosed.get('exit_plan_mode')?.schema, false)
  assert.equal(state.loaded.has('exit_plan_mode'), false)
  assert.deepEqual(planDisclosure([schema('exit_plan_mode', 'changed')], [], state, limits), [])
})

test('an oversized definition is announced by name on a tail route', () => {
  const huge = schema('mcp__srv__big', 'x'.repeat(500))
  const batches = planDisclosure([huge], [], EMPTY_DISCLOSED, limits)
  assert.deepEqual(batches[0]?.added, [])
  assert.deepEqual(batches[0]?.names, ['mcp__srv__big'])
})

test('an oversized definition is dropped on a route that can only load it', () => {
  const huge = schema('mcp__srv__big', 'x'.repeat(500))
  const small = schema('mcp__srv__ok')
  const batches = planDisclosure([huge, small], [], EMPTY_DISCLOSED, { ...limits, mode: 'names' })
  assert.deepEqual(batches.map(batch => batch.names), [['mcp__srv__ok']])
  assert.deepEqual(oversizedNames([huge, small], { ...limits, mode: 'names' }), ['mcp__srv__big'])
})

test('disclosure respects the per-message tool count', () => {
  const tools = [schema('a'), schema('b'), schema('c'), schema('d'), schema('e')]
  const batches = planDisclosure(tools, [], EMPTY_DISCLOSED, limits)
  assert.deepEqual(batches.map(batch => batch.added.length), [2, 2, 1])
})

test('disclosure splits on the message byte budget', () => {
  const tools = [schema('a', 'y'.repeat(300)), schema('b', 'y'.repeat(300)), schema('c', 'y'.repeat(300))]
  const batches = planDisclosure(tools, [], EMPTY_DISCLOSED, { ...limits, maxToolsPerMessage: 8, maxMessageBytes: 400 })
  assert.equal(batches.length, 3)
  for (const batch of batches) assert.equal(batch.added.length, 1)
})

test('removals are announced in their own batch and dropped from state', () => {
  const tool = schema('exit_plan_mode')
  const state = applyDisclosure(EMPTY_DISCLOSED, planDisclosure([tool], [], EMPTY_DISCLOSED, limits))
  const batches = planDisclosure([], ['exit_plan_mode'], state, limits)
  assert.deepEqual(batches[0]?.removed, ['exit_plan_mode'])
  const next = applyDisclosure(state, batches)
  assert.equal(next.disclosed.has('exit_plan_mode'), false)
  assert.equal(next.loaded.has('exit_plan_mode'), false)
  assert.equal(next.definitions.has('exit_plan_mode'), false)
})

test('recording a definition clears the damage mark for that name', () => {
  const damaged: DisclosedState = {
    disclosed: new Map([['broken', { signature: null, schema: false }]]),
    loaded: new Set(),
    definitions: new Map(),
    damaged: ['broken', 'other'],
  }
  const tool = schema('broken')
  const recorded = withDefinition(damaged, tool)
  assert.deepEqual(recorded.damaged, ['other'])
  assert.equal(recorded.definitions.get('broken'), tool)
  assert.equal(recorded.loaded.has('broken'), true)

  const attached = applyDisclosure(damaged, [{ added: [tool], names: [], removed: [] }])
  assert.deepEqual(attached.damaged, ['other'])
  assert.equal(attached.loaded.has('broken'), true)
})

test('an empty plan produces no message at all', () => {
  assert.deepEqual(planDisclosure([], [], EMPTY_DISCLOSED, limits), [])
})
