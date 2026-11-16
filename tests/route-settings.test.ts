import assert from 'node:assert/strict'
import test from 'node:test'
import { responsesEnabled, selectStrategy, setResponsesOverride } from '../src/strategy.ts'

test('单模型关闭优先于通配规则，保留其它模型与 provider', () => {
  const original = { routes: [{ provider: 'gateway', models: ['gpt-*'] }] }
  const changed = setResponsesOverride(original, { provider: 'gateway', model: 'gpt-one', enabled: false })
  assert.equal(responsesEnabled({ provider: 'gateway', model: 'gpt-one' }, changed), false)
  assert.equal(responsesEnabled({ provider: 'gateway', model: 'GPT-TWO' }, changed), true)
  assert.equal(responsesEnabled({ provider: 'another', model: 'gpt-two' }, changed), false)
  assert.equal(responsesEnabled({ provider: 'gateway', model: 'gpt-one' }, original), true)
  assert.equal(selectStrategy({ provider: 'gateway', model: 'gpt-one' }, { models: ['gpt*'], providers: [], responses: changed.routes, responsesOverrides: changed.overrides }), 'declare')
})

test('模型选择精确匹配，星号与大小写不扩展到其它模型', () => {
  const changed = setResponsesOverride({ routes: [] }, { provider: 'Gateway', model: 'alias*', enabled: true })
  assert.equal(responsesEnabled({ provider: 'Gateway', model: 'alias*' }, changed), true)
  assert.equal(responsesEnabled({ provider: 'Gateway', model: 'alias-other' }, changed), false)
  assert.equal(responsesEnabled({ provider: 'gateway', model: 'alias*' }, changed), false)
})

test('重复选择最后一条生效，修改时仅合并同一 provider/model', () => {
  const original = {
    routes: [{ provider: 'a', models: [] }],
    overrides: [{ provider: 'a', model: 'm', enabled: true }, { provider: 'b', model: 'm', enabled: false }, { provider: 'a', model: 'm', enabled: false }],
  }
  assert.equal(responsesEnabled({ provider: 'a', model: 'm' }, original), false)
  const changed = setResponsesOverride(original, { provider: 'a', model: 'm', enabled: true })
  assert.deepEqual(changed.overrides, [{ provider: 'b', model: 'm', enabled: false }, { provider: 'a', model: 'm', enabled: true }])
  assert.equal(original.overrides.length, 3)
  assert.equal(responsesEnabled({ provider: 'a', model: 'any-other' }, changed), true)
})
