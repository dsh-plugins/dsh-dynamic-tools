import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DECLARE_MODELS, patternMatches, selectStrategy } from '../src/strategy.ts'

test('a wildcard pattern matches the whole identifier, ignoring case', () => {
  assert.equal(patternMatches('gpt*', 'gpt-6-astra'), true)
  assert.equal(patternMatches('gpt*', 'GPT-6-Luna'), true)
  assert.equal(patternMatches('gpt*', 'x-gpt-6'), false)
  assert.equal(patternMatches('*gpt*', 'x-gpt-6'), true)
  assert.equal(patternMatches('*', 'anything'), true)
})

test('a pattern treats regex metacharacters literally', () => {
  assert.equal(patternMatches('gpt-6.1*', 'gpt-6.1-sol'), true)
  assert.equal(patternMatches('gpt-6.1*', 'gpt-6x1-sol'), false)
  assert.equal(patternMatches('mclans-gpt', 'mclans-gpt'), true)
  assert.equal(patternMatches('mclans-gpt', 'mclansxgpt'), false)
})

test('an empty pattern matches only an empty identifier', () => {
  assert.equal(patternMatches('', ''), true)
  assert.equal(patternMatches('', 'gpt-6'), false)
})

test('the default model list covers the GPT families and leaves DeepSeek alone', () => {
  const rules = { models: DEFAULT_DECLARE_MODELS, providers: [] }
  const route = (model: string) => selectStrategy({ provider: 'mclans-gpt', model }, rules)
  assert.equal(route('gpt-6-astra'), 'declare')
  assert.equal(route('gpt-6.1-sol'), 'declare')
  assert.equal(route('o3-mini'), 'declare')
  assert.equal(route('deepseek-v4.1-flash'), 'tail')
  assert.equal(route('claude-opus-5-5'), 'tail')
})

test('a missing selection keeps the tail strategy', () => {
  assert.equal(selectStrategy(undefined, { models: ['*'], providers: [] }), 'tail')
})

test('an empty list matches everything on its own axis', () => {
  assert.equal(selectStrategy({ provider: 'p', model: 'm' }, { models: [], providers: [] }), 'declare')
  assert.equal(selectStrategy({ provider: 'p', model: 'm' }, { models: [], providers: ['p'] }), 'declare')
  assert.equal(selectStrategy({ provider: 'p', model: 'm' }, { models: ['m'], providers: [] }), 'declare')
})

test('a provider restricted to another route keeps the tail strategy', () => {
  const rules = { models: ['gpt*'], providers: ['mclans-gpt'] }
  assert.equal(selectStrategy({ provider: 'mclans-gpt', model: 'gpt-6-sol' }, rules), 'declare')
  assert.equal(selectStrategy({ provider: 'mclans', model: 'gpt-6-sol' }, rules), 'tail')
})
