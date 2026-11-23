import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolSchemaLike } from './catalog.ts';
/** Use the host's effective standing policy, never a tool argument or deployment default. */
export declare function hasNoWiderSandbox(agent: Agent): boolean;
/** Project only the native escalation pair. Native argument validation and dispatch are untouched. */
export declare function projectSandboxSchema<T extends ToolSchemaLike>(schema: T, noWider: boolean): T;
/** Recover the full native schema from the live registration when a saved header contains its reduced form. */
export declare function projectSavedSandboxSchema<T extends ToolSchemaLike>(saved: T, live: T | undefined, noWider: boolean): T;
