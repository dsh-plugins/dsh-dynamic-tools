import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { modelRows, savedProvider } from '../src/client/model-cards.ts'

const row = (key: string, model: string, expanded = true): string => `<div data-row-key="${key}"><div><label><input aria-label="模型 ID 1" value="${model}"></label>${expanded ? '<div><label><input aria-label="上下文窗口 1"></label></div>' : ''}</div></div>`
const editor = (content: string): string => `<div><h2>模型</h2><section>${content}<footer><button>取消</button><button>保存</button></footer></section></div>`

test('多个 provider 共享显示名时仍按路由关联，折叠行保留编辑器身份', () => {
  const { document } = new JSDOM(`<ul><li><span>同名</span><span>a</span>${editor(row('r1', 'm1') + row('r2', 'm2', false))}</li><li><span>同名</span><span>b</span>${editor(row('r1', 'm1'))}</li></ul>`).window
  const rows = modelRows(document, [{ provider: 'a', displayName: '同名' }, { provider: 'b', displayName: '同名' }])
  assert.deepEqual(rows.map(item => [item.provider, item.model, !!item.panel]), [['a', 'm1', true], ['a', 'm2', false], ['b', 'm1', true]])
  assert.equal(rows[0]!.editor, rows[1]!.editor)
  assert.notEqual(rows[0]!.editor, rows[2]!.editor)
})

test('新建 provider 从自身字段取路由，不借用相邻卡片的字段', () => {
  const { document } = new JSDOM(editor('<input aria-label="Provider ID" value="new-route">' + row('r1', 'new-model')) + editor(row('r2', 'orphan'))).window
  const rows = modelRows(document, [])
  assert.equal(rows[0]!.provider, 'new-route')
  assert.equal(rows[1]!.provider, undefined)
})

test('同名无法唯一识别时不猜测 provider，删除与排序使用稳定行标识', () => {
  const { document } = new JSDOM(`<li><span>同名</span>${editor(row('r1', 'first') + row('r2', 'second'))}</li>`).window
  const directory = [{ provider: 'a', displayName: '同名' }, { provider: 'b', displayName: '同名' }]
  assert.equal(modelRows(document, directory)[0]!.provider, undefined)
  document.querySelector('[data-row-key="r1"]')!.remove()
  const rows = modelRows(document, directory)
  assert.deepEqual(rows.map(item => [item.key, item.model]), [['r2', 'second']])
})

test('英文标签和提交中的按钮仍解析为同一编辑器，普通文本不被当成模型行', () => {
  const { document } = new JSDOM(editor(row('r1', 'm')).replace('模型 ID', 'Model ID').replace('上下文窗口', 'Context window').replace('取消', 'Cancel').replace('保存', 'Apply') + '<input aria-label="Model ID 99">').window
  const before = modelRows(document, [])[0]!
  before.cancel.disabled = true
  before.save.textContent = 'Applying…'
  const after = modelRows(document, [])
  assert.equal(after.length, 1)
  assert.equal(after[0]!.editor, before.editor)
})

test('成功通知必须是当前区域的新通知且精确指向保存的 provider', () => {
  const { document } = new JSDOM('<section><p role="status" aria-live="polite">已保存 旧名字 (route)。</p></section>').window
  const section = document.querySelector('section')!
  const previous = new Set(section.children)
  assert.equal(savedProvider(section, 'route', previous), false)
  section.innerHTML = '<p role="status" aria-live="polite">已保存 新名字 (route)。</p>'
  assert.equal(savedProvider(section, 'route', previous), true)
  assert.equal(savedProvider(section, 'rout', previous), false)
  section.innerHTML = '<p role="status" aria-live="polite">Saved route.</p>'
  assert.equal(savedProvider(section, 'route', previous), true)
  section.innerHTML = '<p role="alert">已保存 新名字 (route)。</p>'
  assert.equal(savedProvider(section, 'route', previous), false)
})
