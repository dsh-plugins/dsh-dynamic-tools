import { createConfigClient, type ConfigView, type DshLoaderUi } from '@dsh-plugin/dsh-loader/client'
import { responsesEnabled, setResponsesOverride, type ResponsesOverride, type ResponsesSettings } from '../strategy.ts'
import { modelRows, savedProvider, type ModelRow, type ProviderEntry } from './model-cards.ts'
import { submissionOutcome } from './submission.ts'

export const name = '@dsh-plugin/dsh-dynamic-tools'
export const inject = ['dshLoaderUi', 'connection']

/** 仅通过 loader 适配的公开目录和独立配置接口读写路由。 */
export interface ClientContext {
  readonly dshLoaderUi: Pick<DshLoaderUi, 'onDomSettled'>
  readonly connection: { api: { llm: {
    providers(input: object): Promise<{ result: { ok: true, value: { providers: ProviderEntry[] } } | { ok: false, error: { message: string } } }>
  } } }
  effect(callback: () => (() => void)): unknown
}

interface Control {
  block: HTMLElement
  checkbox: HTMLInputElement
  hint: HTMLElement
}

interface EditorDraft {
  editor: HTMLElement
  section: HTMLElement
  cancel: HTMLButtonElement
  save: HTMLButtonElement
  choices: Map<string, boolean>
  submission?: { values: ResponsesOverride[], location: string, previous: Set<Element>, editors: Set<HTMLElement> }
}

/** 勾选只修改草稿；宿主保存成功关闭编辑器后，才提交独立的路由配置。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const lifetime = new AbortController()
    const client = createConfigClient((url, init) => fetch(url, { ...init, signal: lifetime.signal }), url => new EventSource(url))
    const controls = new Map<HTMLInputElement, Control>()
    const drafts = new Map<HTMLElement, EditorDraft>()
    let providers: ProviderEntry[] = []
    let view: ConfigView | undefined
    let disposed = false
    let readError = ''
    let directoryError = ''
    let refreshing = false
    let writeQueue = Promise.resolve()
    const notices = new Set<HTMLElement>()
    const settings = (current: ConfigView): ResponsesSettings => (current.value as unknown as { responses: ResponsesSettings }).responses
    const accept = (next: ConfigView): void => {
      if (!disposed && (!view || next.revision >= view.revision)) { view = next }
    }
    const readConfig = async (): Promise<void> => {
      try { accept(await client.read('dsh-dynamic-tools')); readError = '' }
      catch (failure) { readError = `读取原生工具路由失败：${String(failure)}` }
      if (!disposed) { sweep() }
    }
    const refreshDirectory = async (): Promise<void> => {
      if (refreshing || disposed) { return }
      refreshing = true
      try {
        const response = await ctx.connection.api.llm.providers({})
        if (!response.result.ok) { throw new Error(response.result.error.message) }
        providers = response.result.value.providers
        directoryError = ''
      } catch (failure) { directoryError = `读取提供方失败：${String(failure)}` }
      finally { refreshing = false; if (!disposed) { sweep() } }
    }
    const persist = (values: ResponsesOverride[], section: HTMLElement): void => {
      if (!values.length || disposed) { return }
      const notice = document.createElement('div')
      Object.assign(notice.style, { padding: '12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', gap: '8px', overflowWrap: 'anywhere' })
      notice.setAttribute('role', 'status')
      notices.add(notice)
      section.prepend(notice)
      const remove = (): void => { notice.remove(); notices.delete(notice) }
      const run = (): void => {
        notice.textContent = '正在保存原生工具路由…'
        writeQueue = writeQueue.then(async () => {
          if (disposed) { return }
          try {
            // provider 已保存；重新读取插件配置并仅合并本次勾选，保留其它页面的无关改动。
            const current = await client.read('dsh-dynamic-tools')
            if (disposed) { return }
            const responses = values.reduce((value, choice) => setResponsesOverride(value, choice), settings(current))
            accept(await client.update('dsh-dynamic-tools', { responses } as unknown as ConfigView['value'], current.revision, lifetime.signal))
            remove()
          } catch (failure) {
            if (disposed) { return }
            notice.setAttribute('role', 'alert')
            notice.textContent = `提供方已保存，原生工具路由保存失败：${String(failure)}`
            const retry = document.createElement('button')
            retry.type = 'button'
            retry.textContent = '重试保存原生工具路由'
            retry.addEventListener('click', run)
            const dismiss = document.createElement('button')
            dismiss.type = 'button'
            dismiss.textContent = '放弃本次路由修改'
            dismiss.addEventListener('click', remove)
            notice.append(retry, dismiss)
          }
          if (!disposed) { sweep() }
        })
      }
      run()
    }
    const mount = (row: ModelRow, draft: EditorDraft): Control => {
      const block = document.createElement('div')
      block.dataset.dshNativeTools = ''
      Object.assign(block.style, { borderTop: '1px solid var(--dsw-alias-border-l2)', gridColumn: '1 / -1', marginTop: '8px', padding: '8px 4px 2px', display: 'flex', flexDirection: 'column', gap: '4px' })
      const label = document.createElement('label')
      Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '36px' })
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      Object.assign(checkbox.style, { height: '16px', width: '16px', margin: '0' })
      const title = document.createElement('span')
      title.textContent = '启用原生工具路由'
      label.append(checkbox, title)
      const hint = document.createElement('span')
      Object.assign(hint.style, { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' })
      block.append(label, hint)
      row.panel!.append(block)
      checkbox.addEventListener('change', () => { draft.choices.set(row.key, checkbox.checked); sweep() })
      return { block, checkbox, hint }
    }
    const sweep = (): void => {
      if (disposed) { return }
      const rows = modelRows(document, providers)
      for (const [editor, draft] of drafts) {
        const submission = draft.submission
        if (submission) {
          const replaced = !editor.isConnected && rows.some(row => row.section === draft.section && !submission.editors.has(row.editor))
          const outcome = submissionOutcome({ editorConnected: editor.isConnected, busy: draft.cancel.disabled,
            sectionConnected: draft.section.isConnected && !replaced, sameLocation: submission.location === location.href,
            confirmed: submission.values.length > 0 && savedProvider(draft.section, submission.values[0]!.provider, submission.previous) })
          if (outcome !== 'wait') {
            draft.submission = undefined
            if (outcome === 'save') { persist(submission.values, draft.section) }
          }
        }
        if (!editor.isConnected && !draft.submission) {
          drafts.delete(editor)
        }
      }
      const inputs = new Set(rows.filter(row => row.panel).map(row => row.input))
      for (const [input, control] of controls) {
        if (!inputs.has(input) || !control.block.isConnected) { control.block.remove(); controls.delete(input) }
      }
      for (const row of rows) {
        let draft = drafts.get(row.editor)
        if (!draft) {
          draft = { editor: row.editor, section: row.section, save: row.save, cancel: row.cancel, choices: new Map() }
          drafts.set(row.editor, draft)
          void refreshDirectory()
        }
        if (!row.panel) { continue }
        let control = controls.get(row.input)
        if (!control) { control = mount(row, draft); controls.set(row.input, control) }
        control.checkbox.checked = draft.choices.get(row.key) ?? (!!view && !!row.provider && responsesEnabled({ provider: row.provider, model: row.model }, settings(view)))
        const registered = providers.some(provider => provider.provider === row.provider)
        const disabled = !view || !registered || !row.model || row.input.disabled
        if (control.checkbox.disabled !== disabled) { control.checkbox.disabled = disabled }
        const message = readError || directoryError || (!view ? '正在读取配置…' : !registered ? '请先保存提供方，再启用原生工具路由。' : !row.model ? '请填写有效的模型 ID。'
          : draft.choices.has(row.key) ? '尚未保存，将随提供方的“保存”提交。' : '随提供方保存，从下一步生效。需要支持原生工具追加的 Responses 接口。')
        if (control.hint.textContent !== message) { control.hint.textContent = message }
      }
    }
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) { return }
      const button = event.target.closest('button')
      for (const draft of drafts.values()) {
        if (button === draft.save && !draft.save.disabled) {
          const rows = modelRows(document, providers)
          const values = rows.filter(row => row.editor === draft.editor && row.provider && row.model && draft.choices.has(row.key))
            .map(row => ({ provider: row.provider!, model: row.model, enabled: draft.choices.get(row.key)! }))
          draft.submission = values.length ? { values, location: location.href, previous: new Set(draft.section.querySelectorAll(':scope > p[role="status"][aria-live="polite"]')), editors: new Set(rows.map(row => row.editor)) } : undefined
        } else if (button === draft.cancel || (button && !draft.editor.contains(button) && draft.editor.closest('li')?.contains(button))) {
          draft.submission = undefined
          draft.choices.clear()
        }
      }
    }
    const onInput = (event: Event): void => {
      if (event.target instanceof HTMLInputElement && /^(模型 ID |Model ID |Provider ID$)/.test(event.target.getAttribute('aria-label') ?? '')) { sweep() }
    }
    const refresh = (): void => { void readConfig(); void refreshDirectory() }
    const stopObserving = ctx.dshLoaderUi.onDomSettled(sweep)
    const unsubscribe = client.subscribe(() => { void readConfig() })
    document.addEventListener('click', onClick, true)
    document.addEventListener('input', onInput, true)
    window.addEventListener('focus', refresh)
    refresh()
    return () => {
      disposed = true
      lifetime.abort()
      stopObserving()
      unsubscribe()
      client.dispose()
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('input', onInput, true)
      window.removeEventListener('focus', refresh)
      for (const control of controls.values()) { control.block.remove() }
      for (const notice of notices) { notice.remove() }
      controls.clear()
      drafts.clear()
      notices.clear()
    }
  })
}
