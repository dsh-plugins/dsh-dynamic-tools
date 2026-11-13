import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyTool, schemaBytes, splitCatalog, toolSignature } from '../src/catalog.ts'

const rules = {
  dynamicNames: ['exit_plan_mode'],
  dynamicPrefixes: ['mcp__'],
  inlineNames: [],
}

const inlineRules = { ...rules, inlineNames: ['exit_plan_mode'] }

test('classification prefers inline names, then dynamic names and prefixes', () => {
  assert.equal(classifyTool('read', rules), 'inline')
  assert.equal(classifyTool('exit_plan_mode', rules), 'dynamic')
  assert.equal(classifyTool('mcp__github__list', rules), 'dynamic')
  assert.equal(classifyTool('exit_plan_mode', inlineRules), 'inline')
  assert.equal(classifyTool('mcp__x', inlineRules), 'dynamic')
})

test('an explicit inline entry leaves every other dynamic rule in force', () => {
  assert.equal(classifyTool('read', { ...rules, dynamicNames: ['read'] }), 'dynamic')
  assert.equal(classifyTool('read', { ...rules, dynamicNames: ['read'], inlineNames: ['read'] }), 'inline')
})

test('splitCatalog separates the frozen head from dynamic disclosures', () => {
  const definitions = [
    { name: 'read', description: 'read a file', parameters: {} },
    { name: 'exit_plan_mode', description: 'leave plan mode', parameters: {} },
    { name: 'mcp__srv__run', description: 'remote tool', parameters: {} },
    { name: 'write', description: 'write a file', parameters: {} },
  ]
  const split = splitCatalog(definitions, rules)
  assert.deepEqual(split.inline.map(schema => schema.name), ['read', 'write'])
  assert.deepEqual(split.dynamic.map(schema => schema.name), ['exit_plan_mode', 'mcp__srv__run'])
})

test('toolSignature ignores parameter key order but not values', () => {
  const left = { name: 't', description: 'd', parameters: { a: 1, b: { c: 2, d: 3 } } }
  const right = { name: 't', description: 'd', parameters: { b: { d: 3, c: 2 }, a: 1 } }
  assert.equal(toolSignature(left), toolSignature(right))
  assert.notEqual(toolSignature(left), toolSignature({ ...left, description: 'other' }))
  assert.notEqual(toolSignature(left), toolSignature({ ...left, parameters: { a: 2, b: { c: 2, d: 3 } } }))
})

test('schemaBytes measures UTF-8 bytes rather than characters', () => {
  const ascii = { name: 't', description: 'abc', parameters: {} }
  const wide = { name: 't', description: '中文', parameters: {} }
  assert.equal(schemaBytes(ascii), JSON.stringify(ascii).length)
  assert.ok(schemaBytes(wide) > JSON.stringify(wide).length - 1)
  assert.equal(schemaBytes(wide), new TextEncoder().encode(JSON.stringify(wide)).length)
})

