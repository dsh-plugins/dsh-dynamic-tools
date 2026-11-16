/** 模型目录提供精确路由 ID，显示名只在唯一时用于关联编辑器。 */
export interface ProviderEntry {
  readonly provider: string
  readonly displayName: string
}

/** 编辑器边界独立于模型展开区域，折叠模型不能结束 provider 的草稿。 */
export interface ModelRow {
  readonly key: string
  readonly input: HTMLInputElement
  readonly panel: HTMLElement | undefined
  readonly editor: HTMLElement
  readonly section: HTMLElement
  readonly save: HTMLButtonElement
  readonly cancel: HTMLButtonElement
  readonly provider: string | undefined
  readonly model: string
}

const modelLabels = ['模型 ID ', 'Model ID ']
const capacityLabels = ['上下文窗口 ', 'Context window ', '最大输出 token ', 'Max output tokens ']
const cancelLabels = new Set(['取消', 'Cancel', 'Cancelar', 'Annuler', 'Abbrechen', 'Отмена'])
const saveLabels = new Set(['保存', 'Apply', 'Save', 'Aplicar', 'Appliquer', 'Anwenden', 'Применить', '创建提供商', 'Create provider', 'Crear proveedor', 'Créer un fournisseur', 'Anbieter erstellen', 'Создать поставщика', 'Criar provedor'])

function editorOf(input: HTMLInputElement): Pick<ModelRow, 'editor' | 'section' | 'save' | 'cancel'> | undefined {
  for (let editor = input.parentElement; editor && editor !== input.ownerDocument.body; editor = editor.parentElement) {
    const buttons = editor.lastElementChild?.children
    if (buttons?.length !== 2) { continue }
    const [cancel, save] = Array.from(buttons)
    if (cancel?.tagName === 'BUTTON' && save?.tagName === 'BUTTON' && cancelLabels.has(cancel.textContent?.trim() ?? '')) {
      // 提交期间按钮文案会改变；已禁用的取消按钮只用于继续识别同一个编辑器。
      if (saveLabels.has(save.textContent?.trim() ?? '') || (cancel as HTMLButtonElement).disabled) {
        for (let section = editor.parentElement; section && section !== input.ownerDocument.body; section = section.parentElement) {
          if (section.querySelector(':scope > h2')) {
            return { editor, section, save: save as HTMLButtonElement, cancel: cancel as HTMLButtonElement }
          }
        }
      }
    }
  }
  return undefined
}

/** 宿主只在提交成功后展示此通知；仅关闭或重建 DOM 不构成成功证据。 */
export function savedProvider(section: HTMLElement, provider: string, previous: ReadonlySet<Element>): boolean {
  for (const notice of section.querySelectorAll(':scope > p[role="status"][aria-live="polite"]')) {
    if (previous.has(notice)) { continue }
    const text = notice.textContent?.trim() ?? ''
    const match = /^(?:已保存 |Saved |Guardado |Gespeichert |Сохранено |Salvo )(.+)[。.\s]$/.exec(text)
      ?? /^(.+) enregistré\.$/.exec(text)
    const identity = match?.[1]
    if (identity === provider || identity?.endsWith(` (${provider})`)) { return true }
  }
  return false
}

function providerOf(editor: HTMLElement, providers: readonly ProviderEntry[]): string | undefined {
  const route = editor.querySelector<HTMLInputElement>('input[aria-label="Provider ID"]')
  if (route) { return route.value.trim() || undefined }
  const card = editor.closest('li') ?? editor
  const labels = new Set([...card.querySelectorAll('span')].map(span => span.textContent?.trim()))
  const routes = providers.filter(provider => labels.has(provider.provider))
  if (routes.length === 1) { return routes[0]!.provider }
  if (routes.length > 1) { return undefined }
  const names = providers.filter(provider => labels.has(provider.displayName))
  return names.length === 1 ? names[0]!.provider : undefined
}

/** 通过可访问标签、稳定行标识和提交栏解析模型，避免读取 React 私有状态。 */
export function modelRows(document: Document, providers: readonly ProviderEntry[]): ModelRow[] {
  const rows: ModelRow[] = []
  for (const input of document.querySelectorAll<HTMLInputElement>('input[aria-label]')) {
    if (!modelLabels.some(prefix => input.getAttribute('aria-label')?.startsWith(prefix))) { continue }
    const entry = input.closest<HTMLElement>('[data-row-key]')
    const identity = editorOf(input)
    if (!entry?.dataset.rowKey || !identity) { continue }
    const capacity = [...entry.querySelectorAll<HTMLInputElement>('input[aria-label]')]
      .find(field => capacityLabels.some(prefix => field.getAttribute('aria-label')?.startsWith(prefix)))
    const panel = capacity?.parentElement?.parentElement ?? undefined
    rows.push({ ...identity, key: entry.dataset.rowKey, input, panel, provider: providerOf(identity.editor, providers), model: input.value.trim() })
  }
  return rows
}
