/** tool_load 只加载已公告且当前准入的工具；声明通过 deferContext 保存后才生效。 */
import { schemaBytes, toolSignature } from "./catalog.js";
import { additionMessage, canLoadNative } from "./responses.js";
import { renderLoadedDefinition, renderLoadResult } from "./render.js";
import { TOOL_LOAD_NAME } from "./source.js";
/** Names this plugin owns; a deployment cannot shadow them. */
export { TOOL_LOAD_NAME } from "./source.js";
/**
 * Create the `tool_load` definition.
 * @param options - source kind, limits, and the agent's declaration facts.
 * @returns the unregistered definition.
 */
export function createToolLoad(options) {
    const { defineTool, projectToolSchema, ToolContextUnavailableError, createUserMessage } = options.host;
    return defineTool({
        name: TOOL_LOAD_NAME,
        description: '加载会话中已公布的工具完整定义，传入工具原名。定义在本次调用结果之后保存；Responses 路由从该历史位置追加原生声明，后续可按原名调用。',
        parameters: {
            names: {
                type: 'array',
                items: { type: 'string' },
                required: true,
                description: 'Exact tool names taken from the latest <tools_added> or <tools_load_required> announcement.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    loaded: { type: 'array', items: { type: 'string' }, required: true },
                    alreadyAvailable: { type: 'array', items: { type: 'string' }, required: true },
                    unavailable: { type: 'array', items: { type: 'string' }, required: true },
                    tooLarge: { type: 'array', items: { type: 'string' }, required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: renderLoadResult(value.loaded, value.alreadyAvailable, value.unavailable, value.tooLarge),
                }],
        },
        async execute(args, exec) {
            exec.signal.throwIfAborted();
            const agent = exec.agent;
            if (agent === undefined) {
                throw new ToolContextUnavailableError(`${TOOL_LOAD_NAME} requires a calling Agent`);
            }
            const strategy = options.strategy(agent) ?? 'tail';
            const declared = options.declaredNames(agent);
            const loaded = [];
            const alreadyAvailable = [];
            const unavailable = [];
            const tooLarge = [];
            const definitions = new Map((options.admitted(agent) ?? []).map(definition => [definition.name, definition]));
            const state = options.history.read(agent, strategy);
            const wanted = [...new Set(args.names.map(name => name.trim()).filter(name => name.length > 0))];
            for (const name of wanted) {
                const definition = definitions.get(name);
                if (definition === undefined) {
                    unavailable.push(name);
                    continue;
                }
                if (declared.has(name)) {
                    alreadyAvailable.push(name);
                    continue;
                }
                const schema = options.project?.(agent, definition) ?? projectToolSchema(definition, true);
                const known = state.definitions.get(name);
                if (known && toolSignature(known) === toolSignature(schema)) {
                    alreadyAvailable.push(name);
                    continue;
                }
                if (!state.disclosed.has(name)) {
                    // A registered name nobody announced: bringing it in would declare a
                    // tool the model was never told about.
                    unavailable.push(name);
                    continue;
                }
                if (schemaBytes(schema) > options.limits.maxSchemaBytes || (strategy === 'responses' && !canLoadNative(schema, options.limits))) {
                    tooLarge.push(name);
                    continue;
                }
                loaded.push(name);
                exec.deferContext(strategy === 'responses' ? additionMessage(options.host, [schema]) : createUserMessage({
                    content: [{ type: 'text', text: renderLoadedDefinition(schema, strategy) }],
                    source: { kind: options.sourceKind, form: 'catalog' },
                }));
            }
            return { loaded, alreadyAvailable, unavailable, tooLarge };
        },
        isConcurrencySafe: () => false,
    });
}
