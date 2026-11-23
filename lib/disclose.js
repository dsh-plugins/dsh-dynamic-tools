import { oversizedNames, planDisclosure } from "./disclosure.js";
import { additionMessage, canLoadNative, planResponsesDisclosure } from "./responses.js";
import { renderDisclosure } from "./render.js";
/** 原生定义单独成消息，文字通知不与 additional_tools 共用同一消息位置。 */
function nativeMessages(agent, candidates, topLevel, options) {
    const plan = planResponsesDisclosure(candidates, options.history.read(agent, 'responses'), options.limits, options.requireLoad, topLevel);
    return [
        ...plan.additions.map(schemas => additionMessage(options.host, schemas)),
        ...plan.notices.map(({ notice, text }) => options.host.createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: options.sourceKind, form: 'catalog', responsesToolNotice: notice },
        })),
    ];
}
/** 其它 pre-step 处理完成后生成待提交消息，异常沿宿主失败管线报告。 */
export function registerDisclosure(ctx, options) {
    const reported = new WeakMap();
    const report = (agent, key, emit) => {
        const keys = reported.get(agent) ?? new Set();
        if (keys.has(key)) {
            return;
        }
        reported.set(agent, keys.add(key));
        emit();
    };
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted) {
            return decision;
        }
        const admitted = options.admitted(agent);
        if (!admitted) {
            return decision;
        }
        const strategy = options.strategy(agent) ?? 'tail';
        const catalog = options.catalogNames(agent);
        const all = admitted.map(definition => options.project?.(agent, definition) ?? options.host.projectToolSchema(definition, true));
        const candidates = all.filter(schema => !catalog.has(schema.name));
        const state = options.history.read(agent, strategy);
        const limits = strategy === 'declare' || options.requireLoad ? { ...options.limits, mode: 'names' } : options.limits;
        for (const name of state.damaged) {
            report(agent, `damaged:${name}`, () => ctx.logger.warn('dsh-dynamic-tools: 定义 %s 损坏，将重新披露', name));
        }
        const oversized = strategy === 'responses' ? candidates.filter(schema => !canLoadNative(schema, limits)).map(schema => schema.name) : oversizedNames(candidates, limits);
        for (const name of oversized) {
            report(agent, `oversized:${name}`, () => ctx.logger.warn('dsh-dynamic-tools: %s 超过声明大小限制，tool_load 将报告 tooLarge', name));
        }
        let messages;
        if (strategy === 'responses') {
            // 顶层工具参与可用性判断，但定义已由本步请求头发送。
            messages = nativeMessages(agent, all, catalog, options);
        }
        else {
            const available = new Set(candidates.map(schema => schema.name));
            const removed = options.announceRemovals ? [...state.disclosed.keys()].filter(name => !available.has(name) && !catalog.has(name)) : [];
            messages = planDisclosure(candidates, removed, state, limits).map(batch => options.host.createUserMessage({
                content: [{ type: 'text', text: renderDisclosure(batch, strategy) }],
                source: { kind: options.sourceKind, form: 'catalog' },
            }));
        }
        return messages.length ? { ...decision, messages: [...decision.messages, ...messages] } : decision;
    });
}
