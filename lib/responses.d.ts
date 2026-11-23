import type { ResponsesToolAddition, ResponsesToolAdditionRecord } from '@dsh-plugin/dsh-loader';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import { type ToolSchemaLike } from './catalog.ts';
import type { DisclosedState, DisclosureLimits, DisclosureBatch } from './disclosure.ts';
import type { FoldableMessage } from './fold.ts';
import type { HostBindings } from './host.ts';
import { type ResponsesToolNotice } from './source.ts';
/** 有效历史中带原生声明或公告元数据的消息投影。 */
export interface ResponsesMessage extends FoldableMessage {
    readonly id?: string;
    readonly source?: {
        readonly kind?: string;
        readonly responsesToolAddition?: ResponsesToolAddition;
        readonly responsesToolNotice?: ResponsesToolNotice;
    };
}
/** 固定正文编码供持久化与发送时双向核验，不依赖可变注册表。 */
export declare function renderAddition(addition: ResponsesToolAddition): string;
/** 声明先保存到宿主消息，随后才可计入已加载状态。 */
export declare function additionMessage(host: HostBindings, schemas: readonly ToolSchemaLike[]): UserMessage;
/** UUID 固定长度，预算包含标识与原生函数包装。 */
export declare function additionBytes(schemas: readonly ToolSchemaLike[]): number;
/** 单个定义必须同时适合 schema 预算和持久化消息预算。 */
export declare function canLoadNative(schema: ToolSchemaLike, limits: DisclosureLimits): boolean;
/** 按最终 UTF-8 文本大小分批，定义、名字与移除通知分别记录。 */
export declare function planResponsesDisclosure(candidates: readonly ToolSchemaLike[], state: DisclosedState, limits: DisclosureLimits, requireLoad: boolean, topLevel?: ReadonlySet<string>): {
    additions: ToolSchemaLike[][];
    notices: {
        batch: DisclosureBatch;
        notice: ResponsesToolNotice;
        text: string;
    }[];
};
/** 只接受插件来源的版本化记录，普通文本中的 schema 从不成为声明。 */
export declare function projectResponsesRecords(messages: readonly ResponsesMessage[]): ResponsesToolAdditionRecord[];
/** 声明保留历史最新定义；移除通知只撤销可见状态，执行准入另由当步工具集决定。 */
export declare function foldResponses(messages: readonly ResponsesMessage[], baseline?: readonly ToolSchemaLike[]): DisclosedState;
