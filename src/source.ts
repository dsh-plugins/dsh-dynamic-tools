/**
 * The message source this plugin records, declared once so every module and the
 * fold agree on it.
 *
 * @module dsh-dynamic-tools/source
 */

import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { ResponsesToolAddition } from '@dsh-plugin/dsh-loader'

/** 公告记录保存定义签名，使未加载的同名更新仍能与已公告版本区分。 */
export interface ResponsesToolNotice {
  readonly version: 1
  readonly added: readonly { readonly name: string, readonly signature: string }[]
  readonly removed: readonly string[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dynamic-tools': {
      kind: 'dynamic-tools'
      responsesToolAddition?: ResponsesToolAddition
      responsesToolNotice?: ResponsesToolNotice
    } & ContextFormed
  }
}

/** Message source kind used for every disclosure and loaded definition. */
export const SOURCE_KIND = 'dynamic-tools' as const

/** 静态加载入口名称，原生接管已有会话时可在历史中补齐。 */
export const TOOL_LOAD_NAME = 'tool_load'

/** Type of {@link SOURCE_KIND}. */
export type SourceKind = typeof SOURCE_KIND
