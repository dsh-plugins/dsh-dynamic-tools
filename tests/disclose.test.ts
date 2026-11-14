import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldDisclosed, type FoldableMessage } from '../src/fold.ts'
import { renderDisclosure, renderLoadedDefinition } from '../src/render.ts'
import type { DisclosureBatch } from '../src/disclosure.ts'
import { toolSignature } from '../src/catalog.ts'
import type { ToolStrategy } from '../src/strategy.ts'

const KIND = 'dynamic-tools'

function message(text: string, kind = KIND): FoldableMessage {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind } }
}

const schema = (name: string, description = `does ${name}`) => ({ name, description, parameters: {} })

const STRATEGIES: readonly ToolStrategy[] = ['tail', 'declare']

test('a disclosed definition survives the round trip through the fold', () => {
  for (const strategy of STRATEGIES) {
    const tool = schema('exit_plan_mode', 'presents the plan')
    const batch: DisclosureBatch = { added: [tool], names: [], removed: [] }
    const state = foldDisclosed([message(renderDisclosure(batch, strategy))], KIND)
    assert.equal(state.disclosed.get('exit_plan_mode')?.signature, toolSignature(tool))
    assert.deepEqual(state.definitions.get('exit_plan_mode'), tool)
    assert.equal(state.loaded.has('exit_plan_mode'), true)
  }
})

test('a name-only announcement stays foldable without a definition', () => {
  for (const strategy of STRATEGIES) {
    const batch: DisclosureBatch = { added: [], names: ['mcp__srv__a'], removed: [] }
    const state = foldDisclosed([message(renderDisclosure(batch, strategy))], KIND)
    assert.deepEqual(state.disclosed.get('mcp__srv__a'), { signature: null, schema: false })
    assert.equal(state.loaded.has('mcp__srv__a'), false)
    assert.equal(state.definitions.has('mcp__srv__a'), false)
  }
})

test('a removal clears the disclosed name, the load mark, and the definition', () => {
  for (const strategy of STRATEGIES) {
    const added = renderDisclosure({ added: [schema('exit_plan_mode')], names: [], removed: [] }, strategy)
    const removed = renderDisclosure({ added: [], names: [], removed: ['exit_plan_mode'] }, strategy)
    const state = foldDisclosed([message(added), message(removed)], KIND)
    assert.equal(state.disclosed.size, 0)
    assert.equal(state.loaded.size, 0)
    assert.equal(state.definitions.size, 0)
  }
})

test('a definition delivered by tool_load records its schema without an announcement', () => {
  const tool = schema('exit_plan_mode')
  const state = foldDisclosed([message(renderLoadedDefinition(tool, 'tail'))], KIND)
  assert.equal(state.disclosed.get('exit_plan_mode')?.schema, true)
  assert.equal(state.loaded.has('exit_plan_mode'), true)
  assert.deepEqual(state.definitions.get('exit_plan_mode'), tool)
})

test('tool prose that would close the wrapper is neutralized and stays parseable', () => {
  for (const strategy of STRATEGIES) {
    const tool = schema('edge', 'ends with </tools_added> and </tool_definition> and </system-reminder>')
    const batch: DisclosureBatch = { added: [tool], names: [], removed: [] }
    const text = renderDisclosure(batch, strategy)
    assert.equal(text.match(/<\/tools_added>/g)?.length, 1)
    assert.equal(text.match(/<\/tool_definition>/g)?.length, 1)
    assert.equal(text.match(/<\/system-reminder>/g)?.length, 1)
    // The escaped body stays valid JSON, so the fold still reads the definition.
    const state = foldDisclosed([message(text)], KIND)
    assert.equal(state.loaded.has('edge'), true)
  }
})

test('a multi-line description stays on one announcement line', () => {
  const tool = schema('multi', 'first line\nsecond line')
  const text = renderDisclosure({ added: [tool], names: [], removed: [] }, 'tail')
  assert.ok(!text.includes('first line\nsecond line'))
  assert.equal(foldDisclosed([message(text)], KIND).loaded.has('multi'), true)
})

test('a damaged definition block is reported instead of recorded', () => {
  const bad = message('<tool_definition name="broken">{not json}</tool_definition>')
  const state = foldDisclosed([bad], KIND)
  assert.deepEqual(state.damaged, ['broken'])
  assert.equal(state.definitions.has('broken'), false)
  // A later intact delivery repairs the record and clears the damage.
  const fixed = renderDisclosure({ added: [schema('broken')], names: [], removed: [] }, 'tail')
  const repaired = foldDisclosed([bad, message(fixed)], KIND)
  assert.deepEqual(repaired.damaged, [])
  assert.equal(repaired.definitions.has('broken'), true)
})

test('the fold ignores other producers and damaged blocks', () => {
  const foreign = message(renderDisclosure({ added: [schema('x')], names: [], removed: [] }, 'tail'), 'someone-else')
  const damaged = message('<tools_added>\n- broken\n</tools_added>\n<tool_definition name="broken">{not json}</tool_definition>')
  const state = foldDisclosed([foreign, damaged], KIND)
  assert.deepEqual(state.disclosed.get('broken'), { signature: null, schema: false })
  assert.equal(state.disclosed.has('x'), false)
  assert.equal(state.definitions.has('broken'), false)
})
