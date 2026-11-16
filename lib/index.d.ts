/** 冻结工具头部，按路由选择 Responses 原生追加、按需声明或尾部文本披露。 */
import z from 'schemastery';
import type { HostAPI } from '@dsh-plugin/dsh-loader';
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "@dsh-plugin/dsh-dynamic-tools";
/** Services the plugin registers into. */
export declare const inject: string[];
/** Tool-selection and disclosure settings. */
export interface Config {
    /** Install for agents that already exist when this plugin loads. */
    installExistingAgents: boolean;
    /** Preset ids left untouched, so their own executor keeps the declaration path. */
    skipPresets: string[];
    dynamic: {
        /** Exact tool names disclosed at the conversation tail. */
        names: string[];
        /** Tool-name prefixes disclosed at the conversation tail. */
        prefixes: string[];
        /** Exact names forced into the frozen head. */
        inlineNames: string[];
    };
    disclosure: {
        /** Attach definitions to the disclosure, or announce names for `tool_load`. */
        mode: 'schema' | 'names';
        /** Require `tool_load` before a dynamic tool may run. */
        requireLoad: boolean;
        /** Maximum tools announced in one message. */
        maxToolsPerMessage: number;
        /** Maximum bytes of one attached definition. */
        maxSchemaBytes: number;
        /** Maximum bytes of one disclosure message. */
        maxMessageBytes: number;
        /** Announce tools that stop being available. */
        announceRemovals: boolean;
    };
    declareOnLoad: {
        /** Model-id patterns whose routes declare loaded tools instead of reading the tail. */
        models: string[];
        /** Provider-route patterns restricted to that handling; empty matches every provider. */
        providers: string[];
    };
    responses: {
        /** 仅显式配置的 HTTP/SSE Responses 路由使用 additional_tools。 */
        routes: {
            provider: string;
            models: string[];
        }[];
    };
    /** Model-facing reason reported when a declared tool is not admitted. */
    unavailableReasons: Record<string, string>;
    /** Concurrency used when the loop supplies no limit. */
    maxParallelCalls: number;
}
/** Schemastery validation; invalid values fail at load. */
export declare const Config: z<Config>;
/**
 * Register the load tool, the frozen catalog per agent, and tail disclosure.
 * @param ctx - plugin context owning every registration.
 * @param config - validated plugin configuration.
 */
export declare function apply(ctx: Context & {
    dshLoader: HostAPI;
}, config: Config): Promise<void>;
