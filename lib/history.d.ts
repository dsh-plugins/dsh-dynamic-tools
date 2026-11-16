import type { Agent } from '@deepseek-ai/dsh-agent';
import type { DisclosedState } from './disclosure.ts';
import type { ToolStrategy } from './strategy.ts';
/** 缓存只依赖已提交的日志位置与有效历史代次，预披露和 deferContext 不写入状态。 */
export declare class DisclosureHistory {
    private readonly cache;
    /** 每次读取检查有效历史代次，避免 compaction 后沿用已移除的声明。 */
    read(agent: Agent, strategy: ToolStrategy): DisclosedState;
}
