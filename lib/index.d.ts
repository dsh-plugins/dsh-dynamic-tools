/**
 * Freeze the tool declaration head and disclose later tools at the conversation
 * tail.
 *
 * A model request whose tool list changes forces the agent loop to resend the
 * complete system prompt and declarations, which discards the provider's cached
 * prefix. This plugin keeps the head constant: the first step's declaration set
 * is captured, later admissions are delivered as recorded user messages, and a
 * call to a tool the step does not admit fails through an executable denial
 * instead of running.
 *
 * @module dsh-dynamic-tools
 */
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "dynamic-tools";
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
export declare function apply(ctx: Context, config: Config): void;
