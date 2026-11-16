import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { type DisclosureLimits } from './disclosure.ts';
import type { DisclosureHistory } from './history.ts';
import type { HostBindings } from './host.ts';
import type { SourceKind } from './source.ts';
import type { ToolStrategy } from './strategy.ts';
/** 披露依赖当前步准入与已保存历史，不维护预提交的加载状态。 */
export interface DiscloseOptions {
    readonly host: HostBindings;
    readonly history: DisclosureHistory;
    readonly sourceKind: SourceKind;
    readonly limits: DisclosureLimits;
    readonly requireLoad: boolean;
    readonly announceRemovals: boolean;
    readonly strategy: (agent: Agent) => ToolStrategy | undefined;
    readonly catalogNames: (agent: Agent) => ReadonlySet<string>;
    readonly admitted: (agent: Agent) => readonly ToolDefinition[] | undefined;
}
/** 其它 pre-step 处理完成后生成待提交消息，异常沿宿主失败管线报告。 */
export declare function registerDisclosure(ctx: Context, options: DiscloseOptions): void;
