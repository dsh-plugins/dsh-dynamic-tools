/** 冻结工具头部，按路由选择 Responses 原生追加、按需声明或尾部文本披露。 */
import z from 'schemastery';
import { registerDisclosure } from "./disclose.js";
import { installAgent } from "./install.js";
import { SOURCE_KIND } from "./source.js";
import { DEFAULT_DECLARE_MODELS } from "./strategy.js";
import { createToolLoad, TOOL_LOAD_NAME } from "./tool-load.js";
import { hostBindings } from "./host.js";
import { DisclosureHistory } from "./history.js";
import { projectResponsesRecords } from "./responses.js";
/** Cordis plugin name. */
export const name = '@dsh-plugin/dsh-dynamic-tools';
/** Services the plugin registers into. */
export const inject = ['dshLoader', 'tools', 'agents', 'agentPresets', 'systemPrompt', 'llm'];
/** Schemastery validation; invalid values fail at load. */
export const Config = z.object({
    installExistingAgents: z.boolean().default(true)
        .description('Install for agents that already exist when this plugin loads.'),
    skipPresets: z.array(z.string()).default(['ptc'])
        .description('Preset ids whose own tool executor keeps the declaration path.'),
    dynamic: z.object({
        names: z.array(z.string()).default(['exit_plan_mode'])
            .description('Exact tool names disclosed at the conversation tail.'),
        prefixes: z.array(z.string()).default([])
            .description('Tool-name prefixes disclosed at the conversation tail.'),
        inlineNames: z.array(z.string()).default([])
            .description('Exact names forced into the frozen head.'),
    }).default({}),
    disclosure: z.object({
        mode: z.union(['schema', 'names']).default('schema')
            .description('Attach definitions to the disclosure, or announce names for tool_load.'),
        requireLoad: z.boolean().default(false)
            .description('Require tool_load before a dynamic tool may run.'),
        maxToolsPerMessage: z.number().min(1).default(8)
            .description('Maximum tools announced in one message.'),
        maxSchemaBytes: z.number().min(1).default(6000)
            .description('Maximum bytes of one attached definition.'),
        maxMessageBytes: z.number().min(1).default(20000)
            .description('Maximum bytes of one disclosure message.'),
        announceRemovals: z.boolean().default(true)
            .description('Announce tools that stop being available.'),
    }).default({}),
    declareOnLoad: z.object({
        models: z.array(z.string()).default([...DEFAULT_DECLARE_MODELS])
            .description('Model-id patterns whose routes call only declared tools; dynamic tools are loaded on demand there.'),
        providers: z.array(z.string()).default([])
            .description('Provider-route patterns restricted to that handling; empty matches every provider.'),
    }).default({}),
    responses: z.object({
        routes: z.array(z.object({
            provider: z.string().required(),
            models: z.array(z.string()).default([]),
        })).default([]),
    }).default({}),
    unavailableReasons: z.dict(z.string()).default({
        exit_plan_mode: 'Plan mode is not active in this session. Ask the user to switch to plan mode, then call it again.',
    }).description('Model-facing reason reported when a declared tool is not admitted.'),
    maxParallelCalls: z.number().min(1).default(10)
        .description('Concurrency used when the loop supplies no limit.'),
});
/**
 * Compose validated settings into the two halves the plugin registers.
 * @param config - validated plugin configuration.
 * @returns classification, execution, and disclosure settings.
 */
function resolveSettings(config) {
    const strategyRules = {
        models: config.declareOnLoad.models,
        providers: config.declareOnLoad.providers,
        get responses() { return config.responses.routes; },
    };
    // A route that declares loaded tools needs the loader in its head, so a
    // deployment cannot classify it onto the tail and lose the only path in.
    const inlineNames = config.dynamic.inlineNames.includes(TOOL_LOAD_NAME)
        ? config.dynamic.inlineNames
        : [...config.dynamic.inlineNames, TOOL_LOAD_NAME];
    const rules = {
        dynamicNames: config.dynamic.names,
        dynamicPrefixes: config.dynamic.prefixes,
        inlineNames,
    };
    return {
        rules,
        strategyRules,
        install: {
            sourceKind: SOURCE_KIND,
            rules,
            executor: {
                requireLoad: config.disclosure.requireLoad,
                unavailableReasons: config.unavailableReasons,
                maxParallelCalls: config.maxParallelCalls,
                strategyRules,
                loadToolName: TOOL_LOAD_NAME,
            },
            skipPresets: config.skipPresets,
        },
        disclose: {
            sourceKind: SOURCE_KIND,
            limits: {
                mode: config.disclosure.mode,
                maxToolsPerMessage: config.disclosure.maxToolsPerMessage,
                maxSchemaBytes: config.disclosure.maxSchemaBytes,
                maxMessageBytes: config.disclosure.maxMessageBytes,
            },
            announceRemovals: config.disclosure.announceRemovals,
            requireLoad: config.disclosure.requireLoad,
        },
    };
}
/**
 * Register the load tool, the frozen catalog per agent, and tail disclosure.
 * @param ctx - plugin context owning every registration.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx, config) {
    const loader = ctx.dshLoader;
    const host = hostBindings(loader);
    const history = new DisclosureHistory();
    const owner = ctx;
    const preferences = await loader.config.register(owner, {
        id: 'dsh-dynamic-tools', packageName: name, title: '动态工具',
        fields: [{ type: 'object', key: 'responses', label: 'Responses 原生声明', fields: [{
                        type: 'array', key: 'routes', label: '启用路由', default: config.responses.routes.map(route => ({ provider: route.provider, models: [...route.models] })),
                        description: '仅填写支持 additional_tools 的 Responses HTTP/SSE 路由。provider 精确匹配，models 支持 *，空数组匹配全部模型。',
                        item: { type: 'object', label: '路由', fields: [
                                { type: 'text', key: 'provider', label: 'Provider ID', required: true },
                                { type: 'array', key: 'models', label: '模型规则', default: [], item: { type: 'text', label: '模型规则' } },
                            ] },
                    }] }],
    });
    config = { ...config, responses: preferences.get().value.responses };
    preferences.watch(({ value }) => { config.responses = value.responses; });
    const settings = resolveSettings(config);
    const executors = new WeakMap();
    const release = new WeakMap();
    const reported = new WeakSet();
    const installOptions = { ...settings.install, executors, reported, host, history };
    const strategyOf = (agent) => executors.get(agent)?.planStrategy();
    const declaredNamesOf = (agent) => executors.get(agent)?.declaredNames() ?? new Set();
    const admitted = (agent) => executors.get(agent)?.admittedDefinitions();
    loader.llm.registerResponsesToolAdditions(owner, request => {
        if (!request.sessionId || request.purpose !== undefined) {
            return undefined;
        }
        const agent = ctx.agents.list().find(agent => agent.session.id === request.sessionId);
        const executor = agent && executors.get(agent);
        if (!executor || executor.planStrategy() !== 'responses') {
            return undefined;
        }
        if (!executor.matchesResponsesRoute(request)) {
            throw new Error('dsh-dynamic-tools: 原生声明已按本步路由准备，但发送路由发生变化；请在下一步重新选择模型');
        }
        return projectResponsesRecords(request.messages);
    });
    ctx.effect(() => ctx.tools.register(createToolLoad({
        sourceKind: SOURCE_KIND,
        host, history, admitted,
        limits: settings.disclose.limits,
        strategy: strategyOf,
        declaredNames: declaredNamesOf,
    })), `dsh-dynamic-tools: register ${TOOL_LOAD_NAME}`);
    ctx.on('agent/created', ({ agent }) => {
        installAgent(ctx, agent, installOptions, release);
        return undefined;
    });
    // An agent's executor belongs to that agent: release it with the agent instead
    // of retaining every closed session's executor until this plugin unloads.
    ctx.on('agent/disposed', ({ agent }) => {
        release.get(agent)?.();
    });
    if (config.installExistingAgents) {
        const agents = ctx.get('agents');
        for (const agent of agents?.list() ?? []) {
            installAgent(ctx, agent, installOptions, release);
        }
    }
    registerDisclosure(ctx, {
        ...settings.disclose,
        host, history,
        strategy: strategyOf,
        catalogNames: declaredNamesOf,
        admitted,
    });
}
