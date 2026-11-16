import type { ResponsesToolAddition, ResponsesToolAdditionRecord } from '@dsh-plugin/dsh-loader'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { schemaBytes, toolSignature, type ToolSchemaLike } from './catalog.ts'
import type { DisclosedState, DisclosureLimits, DisclosureBatch } from './disclosure.ts'
import { renderDisclosure } from './render.ts'
import type { FoldableMessage } from './fold.ts'
import type { HostBindings } from './host.ts'
import { SOURCE_KIND, TOOL_LOAD_NAME, type ResponsesToolNotice } from './source.ts'

/** 有效历史中带原生声明或公告元数据的消息投影。 */
export interface ResponsesMessage extends FoldableMessage {
  readonly id?: string
  readonly source?: {
    readonly kind?: string
    readonly responsesToolAddition?: ResponsesToolAddition
    readonly responsesToolNotice?: ResponsesToolNotice
  }
}

/** 固定正文编码供持久化与发送时双向核验，不依赖可变注册表。 */
export function renderAddition(addition: ResponsesToolAddition): string {
  return `[dsh-responses-tools:${addition.id}]\n${JSON.stringify(addition.tools)}`
}

function makeAddition(schemas: readonly ToolSchemaLike[], id: string): ResponsesToolAddition {
  return {
    version: 1, id,
    tools: schemas.map(schema => ({ type: 'function', name: schema.name, description: schema.description, parameters: schema.parameters, strict: false })),
  }
}

/** 声明先保存到宿主消息，随后才可计入已加载状态。 */
export function additionMessage(host: HostBindings, schemas: readonly ToolSchemaLike[]): UserMessage {
  const addition = makeAddition(schemas, crypto.randomUUID())
  return host.createUserMessage({
    content: [{ type: 'text', text: renderAddition(addition) }],
    source: { kind: SOURCE_KIND, form: 'catalog', responsesToolAddition: addition },
  })
}

/** UUID 固定长度，预算包含标识与原生函数包装。 */
export function additionBytes(schemas: readonly ToolSchemaLike[]): number {
  return new TextEncoder().encode(renderAddition(makeAddition(schemas, '00000000-0000-0000-0000-000000000000'))).length
}

/** 单个定义必须同时适合 schema 预算和持久化消息预算。 */
export function canLoadNative(schema: ToolSchemaLike, limits: DisclosureLimits): boolean {
  return schemaBytes(schema) <= limits.maxSchemaBytes && additionBytes([schema]) <= limits.maxMessageBytes
}

/** 按最终 UTF-8 文本大小分批，定义、名字与移除通知分别记录。 */
export function planResponsesDisclosure(candidates: readonly ToolSchemaLike[], state: DisclosedState, limits: DisclosureLimits, requireLoad: boolean) {
  const additions: ToolSchemaLike[][] = []
  const notices: { batch: DisclosureBatch, notice: ResponsesToolNotice, text: string }[] = []
  const names: ToolSchemaLike[] = []
  let pending: ToolSchemaLike[] = []
  for (const schema of candidates) {
    const known = state.disclosed.get(schema.name)
    const bootstrap = schema.name === TOOL_LOAD_NAME
    if (known?.signature === toolSignature(schema)
      && (known.schema || (!bootstrap && (requireLoad || limits.mode === 'names' || !canLoadNative(schema, limits))))) { continue }
    if (bootstrap && !canLoadNative(schema, limits)) { throw new Error('dsh-dynamic-tools: tool_load 超过声明大小限制，无法建立原生加载入口') }
    if (!bootstrap && (requireLoad || limits.mode === 'names' || !canLoadNative(schema, limits))) { names.push(schema); continue }
    if (pending.length && (pending.length >= limits.maxToolsPerMessage || additionBytes([...pending, schema]) > limits.maxMessageBytes)) {
      additions.push(pending)
      pending = []
    }
    pending.push(schema)
  }
  if (pending.length) { additions.push(pending) }
  const available = new Set(candidates.map(schema => schema.name))
  const entries = [
    ...[...state.disclosed.keys()].filter(name => !available.has(name)).map(name => ({ name, removed: true, signature: '' })),
    ...names.map(schema => ({ name: schema.name, removed: false, signature: toolSignature(schema) })),
  ]
  let group: typeof entries = []
  const build = (entries: typeof group) => {
    const batch: DisclosureBatch = { added: [], names: entries.filter(entry => !entry.removed).map(entry => entry.name), removed: entries.filter(entry => entry.removed).map(entry => entry.name) }
    const notice: ResponsesToolNotice = { version: 1, added: entries.filter(entry => !entry.removed).map(({ name, signature }) => ({ name, signature })), removed: batch.removed }
    return { batch, notice, text: renderDisclosure(batch, 'responses') }
  }
  const fits = (entries: typeof group): boolean => entries.length <= limits.maxToolsPerMessage && new TextEncoder().encode(build(entries).text).length <= limits.maxMessageBytes
  for (const entry of entries) {
    if (group.length && !fits([...group, entry])) { notices.push(build(group)); group = [] }
    if (!fits([entry])) { throw new Error(`dsh-dynamic-tools: maxMessageBytes 无法容纳 ${entry.name} 的工具通知，请提高限制`) }
    group.push(entry)
  }
  if (group.length) { notices.push(build(group)) }
  return { additions, notices }
}

/** 只接受插件来源的版本化记录，普通文本中的 schema 从不成为声明。 */
export function projectResponsesRecords(messages: readonly ResponsesMessage[]): ResponsesToolAdditionRecord[] {
  const records: ResponsesToolAdditionRecord[] = []
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.source?.kind !== SOURCE_KIND || message.source.responsesToolAddition === undefined) { continue }
    const addition = message.source.responsesToolAddition
    if (message.role !== 'user' || !message.id || !addition || addition.version !== 1
      || typeof addition.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(addition.id) || ids.has(addition.id)
      || !Array.isArray(addition.tools) || addition.tools.length === 0) {
      throw new Error('dsh-dynamic-tools: 原生声明记录损坏、标识缺失或重复')
    }
    const names = new Set<string>()
    for (const tool of addition.tools) {
      if (tool.type !== 'function' || typeof tool.name !== 'string' || !tool.name
        || typeof tool.description !== 'string' || tool.strict !== false || !tool.parameters
        || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters) || names.has(tool.name)) {
        throw new Error(`dsh-dynamic-tools: 原生工具定义无效 ${addition.id}`)
      }
      names.add(tool.name)
    }
    const text = renderAddition(addition)
    if (message.content.length !== 1 || message.content[0]?.type !== 'text' || message.content[0].text !== text) {
      throw new Error(`dsh-dynamic-tools: 原生声明正文不匹配 ${addition.id}`)
    }
    ids.add(addition.id)
    records.push({ messageId: message.id, sourceKind: SOURCE_KIND, text, addition })
  }
  return records
}

/** 声明保留历史最新定义；移除通知只撤销可见状态，执行准入另由当步工具集决定。 */
export function foldResponses(messages: readonly ResponsesMessage[], baseline: readonly ToolSchemaLike[] = []): DisclosedState {
  const records = new Map(projectResponsesRecords(messages).map(record => [record.messageId, record]))
  const disclosed = new Map<string, { signature: string | null, schema: boolean }>()
  const definitions = new Map<string, ToolSchemaLike>()
  const loaded = new Set<string>()
  for (const schema of baseline) {
    definitions.set(schema.name, schema)
    loaded.add(schema.name)
    disclosed.set(schema.name, { signature: toolSignature(schema), schema: true })
  }
  for (const message of messages) {
    const record = message.id ? records.get(message.id) : undefined
    if (record) {
      for (const tool of record.addition.tools) {
        const schema = { name: tool.name, description: tool.description, parameters: tool.parameters }
        definitions.set(tool.name, schema)
        loaded.add(tool.name)
        disclosed.set(tool.name, { signature: toolSignature(schema), schema: true })
      }
    }
    if (message.role !== 'user' || message.source?.kind !== SOURCE_KIND) { continue }
    const notice = message.source.responsesToolNotice
    if (!notice) { continue }
    if (notice.version !== 1 || !Array.isArray(notice.added) || !Array.isArray(notice.removed)) {
      throw new Error('dsh-dynamic-tools: 原生工具通知记录无效')
    }
    for (const name of notice.removed) { disclosed.delete(name) }
    for (const entry of notice.added) { disclosed.set(entry.name, { signature: entry.signature, schema: false }) }
  }
  return { disclosed, definitions, loaded, damaged: [] }
}
