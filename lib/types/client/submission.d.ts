/** 提交结果同时依据编辑器生命周期和宿主成功通知，拒绝将卸载当作保存成功。 */
export declare function submissionOutcome(state: {
    editorConnected: boolean;
    busy: boolean;
    sectionConnected: boolean;
    sameLocation: boolean;
    confirmed: boolean;
}): 'wait' | 'save' | 'discard';
