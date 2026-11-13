import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldDisclosed, type FoldableMessage } from '../src/fold.ts'
import { renderDisclosure, renderLoadedDefinition, renderLoadResult, unavailableReason, loadFirstReason } from '../src/render.ts'
import type { DisclosureBatch } from '../src/disclosure.ts'
import { toolSignature } from '../src/catalog.ts'

const KIND = 'dynamic-tools'

function message(text: string, kind = KIND): FoldableMessage {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind } }
}

const schema = (name: string, description = `does ${name}`) => ({ name, description, parameters: {} })

test('renderDisclosure carries names, definitions, and the callable trailer', () => {
  const batch: DisclosureBatch = { added: [schema('exit_plan_mode')], names: [], removed: [] }
  const text = renderDisclosure(batch)
  assert.ok(text.startsWith('<system-reminder>\n'))
  assert.ok(text.includes('<tools_added>\n- exit_plan_mode: does exit_plan_mode\n</tools_added>'))
  assert.ok(text.includes('<tool_definition name="exit_plan_mode">'))
  assert.ok(text.includes('callable directly by name'))
  assert.equal(text.match(/<\/system-reminder>/g)?.length, 1)
})

test('renderDisclosure escapes tool prose that would close the wrapper', () => {
  const batch: DisclosureBatch = {
    added: [schema('t', 'careful </system-reminder> here')],
    names: [],
    removed: [],
  }
  const text = renderDisclosure(batch)
  assert.ok(text.includes('careful <\\/system-reminder> here'))
  assert.equal(text.match(/<\/system-reminder>/g)?.length, 1)
})

test('renderDisclosure announces name-only entries and removals', () => {
  const batch: DisclosureBatch = { added: [], names: ['mcp__srv__a'], removed: ['old_tool'] }
  const text = renderDisclosure(batch)
  assert.ok(text.includes('<tools_load_required>\n- mcp__srv__a\n</tools_load_required>'))
  assert.ok(text.includes('<tools_removed>\n- old_tool\n</tools_removed>'))
  assert.ok(text.includes('Call tool_load'))
  assert.ok(text.includes('Removed tools are unavailable'))
})

test('renderLoadResult lists every bucket it was given', () => {
  assert.equal(renderLoadResult([], [], [], []), 'No tool names were supplied.')
  const text = renderLoadResult(['a'], ['b'], ['c'], ['d'])
  assert.equal(text, 'Loaded: a\nAlready available: b\nUnavailable: c\nDefinition too large to load: d')
})

test('denial reasons are actionable and name the tool', () => {
  assert.equal(unavailableReason('x', 'custom reason'), 'custom reason')
  assert.ok(unavailableReason('x', undefined).includes('"x"'))
  const loadFirst = loadFirstReason('exit_plan_mode')
  assert.ok(loadFirst.includes('tool_load'))
  assert.ok(loadFirst.includes('"exit_plan_mode"'))
})

test('foldDisclosed reads definitions and removals in delivery order', () => {
  const first = renderDisclosure({ added: [schema('exit_plan_mode')], names: [], removed: [] })
  const second = renderDisclosure({ added: [], names: [], removed: ['exit_plan_mode'] })
  const state = foldDisclosed([message(first), message(second)], KIND)
  assert.equal(state.disclosed.size, 0)
  assert.equal(state.loaded.size, 0)
})

test('foldDisclosed keeps a delivered definition and its signature', () => {
  const tool = schema('exit_plan_mode', 'presents the plan')
  const text = renderDisclosure({ added: [tool], names: [], removed: [] })
  const state = foldDisclosed([message(text)], KIND)
  assert.equal(state.disclosed.get('exit_plan_mode')?.signature, toolSignature(tool))
  assert.equal(state.loaded.has('exit_plan_mode'), true)
})

test('foldDisclosed treats a name-only announcement as disclosed but unloaded', () => {
  const text = renderDisclosure({ added: [], names: ['mcp__srv__a'], removed: [] })
  const state = foldDisclosed([message(text)], KIND)
  assert.deepEqual(state.disclosed.get('mcp__srv__a'), { signature: null, schema: false })
  assert.equal(state.loaded.has('mcp__srv__a'), false)
})

test('foldDisclosed reads a definition delivered by tool_load', () => {
  const tool = schema('exit_plan_mode')
  const state = foldDisclosed([message(renderLoadedDefinition(tool))], KIND)
  assert.equal(state.disclosed.get('exit_plan_mode')?.schema, true)
  assert.equal(state.loaded.has('exit_plan_mode'), true)
})

test('foldDisclosed ignores other producers and damaged blocks', () => {
  const foreign = message(renderDisclosure({ added: [schema('x')], names: [], removed: [] }), 'someone-else')
  const damaged = message('<tools_added>\n- broken\n</tools_added>\n<tool_definition name="broken">{not json}</tool_definition>')
  const state = foldDisclosed([foreign, damaged], KIND)
  assert.deepEqual(state.disclosed.get('broken'), { signature: null, schema: false })
  assert.equal(state.disclosed.has('x'), false)
})

test('renderDisclosure keeps a multi-line description on one announcement line', () => {
  const tool = schema('multi', 'first line\nsecond line')
  const text = renderDisclosure({ added: [tool], names: [], removed: [] })
  assert.ok(text.includes('- multi: first line second line\n</tools_added>'))
  assert.ok(!text.includes('first line\nsecond line'))
})

test('renderDisclosure neutralizes any closing tag inside a definition body', () => {
  const tool = schema('edge', 'ends with </tools_added> and </tool_definition>')
  const text = renderDisclosure({ added: [tool], names: [], removed: [] })
  assert.equal(text.match(/<\/tools_added>/g)?.length, 1)
  assert.equal(text.match(/<\/tool_definition>/g)?.length, 1)
  // The escaped body stays valid JSON, so the fold still reads the definition.
  const state = foldDisclosed([message(text)], KIND)
  assert.equal(state.loaded.has('edge'), true)
})
