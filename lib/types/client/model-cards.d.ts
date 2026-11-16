/** 模型目录提供精确路由 ID，显示名只在唯一时用于关联编辑器。 */
export interface ProviderEntry {
    readonly provider: string;
    readonly displayName: string;
}
/** 编辑器边界独立于模型展开区域，折叠模型不能结束 provider 的草稿。 */
export interface ModelRow {
    readonly key: string;
    readonly input: HTMLInputElement;
    readonly panel: HTMLElement | undefined;
    readonly editor: HTMLElement;
    readonly section: HTMLElement;
    readonly save: HTMLButtonElement;
    readonly cancel: HTMLButtonElement;
    readonly provider: string | undefined;
    readonly model: string;
}
/** 宿主只在提交成功后展示此通知；仅关闭或重建 DOM 不构成成功证据。 */
export declare function savedProvider(section: HTMLElement, provider: string, previous: ReadonlySet<Element>): boolean;
/** 通过可访问标签、稳定行标识和提交栏解析模型，避免读取 React 私有状态。 */
export declare function modelRows(document: Document, providers: readonly ProviderEntry[]): ModelRow[];
