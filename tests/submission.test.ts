import assert from 'node:assert/strict'
import test from 'node:test'
import { submissionOutcome } from '../src/client/submission.ts'

test('保存过程中等待，宿主关闭并确认后才提交路由', () => {
  const state = { editorConnected: true, busy: true, sectionConnected: true, sameLocation: true, confirmed: false }
  assert.equal(submissionOutcome(state), 'wait')
  assert.equal(submissionOutcome({ ...state, editorConnected: false }), 'wait')
  assert.equal(submissionOutcome({ ...state, editorConnected: false, confirmed: true }), 'save')
})

test('快速失败不依赖是否观察过忙碌帧，取消和离开页面都不能提交', () => {
  const state = { editorConnected: true, busy: false, sectionConnected: true, sameLocation: true, confirmed: false }
  assert.equal(submissionOutcome(state), 'discard')
  assert.equal(submissionOutcome({ ...state, editorConnected: false, confirmed: true, sectionConnected: false }), 'discard')
  assert.equal(submissionOutcome({ ...state, editorConnected: false, confirmed: true, sameLocation: false }), 'discard')
})
