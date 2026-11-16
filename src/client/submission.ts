/** 提交结果同时依据编辑器生命周期和宿主成功通知，拒绝将卸载当作保存成功。 */
export function submissionOutcome(state: {
  editorConnected: boolean
  busy: boolean
  sectionConnected: boolean
  sameLocation: boolean
  confirmed: boolean
}): 'wait' | 'save' | 'discard' {
  if (!state.sectionConnected || !state.sameLocation) { return 'discard' }
  if (state.editorConnected) { return state.busy ? 'wait' : 'discard' }
  return state.confirmed ? 'save' : 'wait'
}
