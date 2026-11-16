import type { HostAPI } from '@dsh-plugin/dsh-loader';
import type * as Tools from '@deepseek-ai/dsh-tools';
import type * as Pipeline from '@deepseek-ai/dsh-tools/pipeline';
import type * as Llm from '@deepseek-ai/dsh-llm';
/** 绑定当前 loader 实例，工具投影和执行始终使用同一宿主的实现。 */
export declare function hostBindings(loader: HostAPI): {
    defineTool: typeof Tools.defineTool;
    projectToolSchema: typeof Tools.projectToolSchema;
    ToolContextUnavailableError: typeof Tools.ToolContextUnavailableError;
    ToolExecutionPipeline: typeof Pipeline.ToolExecutionPipeline;
    executeToolBatch: typeof Pipeline.executeToolBatch;
    createUserMessage: typeof Llm.createUserMessage;
    deepFreeze: <T>(value: T) => T;
};
/** 每次安装独享的宿主函数引用，避免跨实例共享模块级可变状态。 */
export type HostBindings = ReturnType<typeof hostBindings>;
