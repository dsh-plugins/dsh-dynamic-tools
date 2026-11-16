/**
 * Per-Agent installation of the frozen-catalog executor.
 *
 * Every installation is one plugin-owned effect, so unload releases exactly the
 * registrations this plugin made, and an agent's disposal releases its executor
 * immediately instead of retaining it until the plugin unloads. A scope that
 * already selected another executor keeps it: this plugin then stays out of the
 * declaration path instead of replacing that selection.
 *
 * @module dsh-dynamic-tools/install
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ClassificationRules } from './catalog.ts';
import { StableCatalogExecutor, type ExecutorOptions } from './executor.ts';
import type { DisclosureHistory } from './history.ts';
import type { HostBindings } from './host.ts';
import type { SourceKind } from './source.ts';
/** Settings shared by every installed agent. */
export interface InstallOptions {
    readonly host: HostBindings;
    readonly history: DisclosureHistory;
    /** Message source kind owned by this plugin. */
    readonly sourceKind: SourceKind;
    /** Classification rules for the frozen head. */
    readonly rules: ClassificationRules;
    /** Execution settings. */
    readonly executor: ExecutorOptions;
    /** Preset ids this plugin leaves alone. */
    readonly skipPresets: readonly string[];
    /** Executors by agent, shared with the disclosure listener. */
    readonly executors: WeakMap<Agent, StableCatalogExecutor>;
    /** Agents already reported, so each diagnostic appears once. */
    readonly reported: WeakSet<Agent>;
}
/**
 * Install the frozen-catalog executor for one agent.
 * @param ctx - plugin context that owns the registration.
 * @param agent - agent whose scope receives the executor.
 * @param options - installation settings.
 * @param release - disposer registry, so agent disposal can release the executor.
 */
export declare function installAgent(ctx: Context, agent: Agent, options: InstallOptions, release: WeakMap<Agent, () => void>): void;
