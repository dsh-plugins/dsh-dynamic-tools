/** 绑定当前 loader 实例，工具投影和执行始终使用同一宿主的实现。 */
export function hostBindings(loader) {
    if (typeof loader.llm.registerResponsesToolAdditions !== 'function') {
        throw new Error('dsh-dynamic-tools: 当前 dsh-loader 缺少 registerResponsesToolAdditions，请更新配套 loader');
    }
    return {
        defineTool: loader.dsh.tools.defineTool,
        projectToolSchema: loader.dsh.tools.projectToolSchema,
        ToolContextUnavailableError: loader.dsh.tools.ToolContextUnavailableError,
        ToolExecutionPipeline: loader.dsh.tools.ToolExecutionPipeline,
        executeToolBatch: loader.dsh.tools.executeToolBatch,
        createUserMessage: loader.llm.createUserMessage,
        deepFreeze: loader.llm.deepFreeze,
    };
}
