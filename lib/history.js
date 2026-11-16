import { foldDisclosed } from "./fold.js";
import { foldResponses } from "./responses.js";
import { SOURCE_KIND } from "./source.js";
/** 缓存只依赖已提交的日志位置与有效历史代次，预披露和 deferContext 不写入状态。 */
export class DisclosureHistory {
    cache = new WeakMap();
    /** 每次读取检查有效历史代次，避免 compaction 后沿用已移除的声明。 */
    read(agent, strategy) {
        const seq = agent.session.seq;
        const generation = agent.session.surface.contentGeneration;
        const cached = this.cache.get(agent);
        if (cached?.seq === seq && cached.generation === generation && cached.strategy === strategy) {
            return cached.state;
        }
        const messages = agent.session.deriveMessages();
        const state = strategy === 'responses'
            ? foldResponses(messages, agent.session.requestHeader()?.tools ?? [])
            : foldDisclosed(messages, SOURCE_KIND);
        this.cache.set(agent, { seq, generation, strategy, state });
        return state;
    }
}
