import type { HostAPI } from '@dsh-plugin/dsh-loader'
import type * as Tools from '@deepseek-ai/dsh-tools'
import type * as Pipeline from '@deepseek-ai/dsh-tools/pipeline'
import type * as Llm from '@deepseek-ai/dsh-llm'

/** 绑定当前 loader 实例，工具投影和执行始终使用同一宿主的实现。 */
export function hostBindings(loader: HostAPI) {
  if (typeof loader.llm.registerResponsesToolAdditions !== 'function') {
    throw new Error('dsh-dynamic-tools: 当前 dsh-loader 缺少 registerResponsesToolAdditions，请更新配套 loader')
  }
  return {
    defineTool: loader.dsh.tools.defineTool as typeof Tools.defineTool,
    projectToolSchema: loader.dsh.tools.projectToolSchema as typeof Tools.projectToolSchema,
    ToolContextUnavailableError: loader.dsh.tools.ToolContextUnavailableError as typeof Tools.ToolContextUnavailableError,
    ToolExecutionPipeline: loader.dsh.tools.ToolExecutionPipeline as typeof Pipeline.ToolExecutionPipeline,
    executeToolBatch: loader.dsh.tools.executeToolBatch as typeof Pipeline.executeToolBatch,
    createUserMessage: loader.llm.createUserMessage as typeof Llm.createUserMessage,
    deepFreeze: loader.llm.deepFreeze,
  }
}

/** 每次安装独享的宿主函数引用，避免跨实例共享模块级可变状态。 */
export type HostBindings = ReturnType<typeof hostBindings>
