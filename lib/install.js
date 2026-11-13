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
import { StableCatalogExecutor } from "./executor.js";
import { currentState } from "./disclose.js";
/** Read the preset id an agent runs under, when a registry is composed. */
function presetOf(ctx, agent) {
    const registry = ctx.get('agentPresets');
    if (registry === undefined)
        return undefined;
    return registry.presetForSession(agent.session) ?? undefined;
}
/**
 * Install the frozen-catalog executor for one agent.
 * @param ctx - plugin context that owns the registration.
 * @param agent - agent whose scope receives the executor.
 * @param options - installation settings.
 * @param release - disposer registry, so agent disposal can release the executor.
 */
export function installAgent(ctx, agent, options, release) {
    if (options.executors.has(agent))
        return;
    const preset = presetOf(ctx, agent);
    if (preset !== undefined && options.skipPresets.includes(preset)) {
        if (!options.reported.has(agent)) {
            options.reported.add(agent);
            ctx.logger.info('dsh-dynamic-tools: leaving preset "%s" alone; tool declarations stay as composed', preset);
        }
        return;
    }
    const holder = {
        disclosed: () => currentState(agent, options.sourceKind).disclosed,
        loaded: () => currentState(agent, options.sourceKind).loaded,
    };
    const executor = new StableCatalogExecutor(ctx, agent, options.rules, options.executor, holder);
    try {
        const dispose = ctx.effect(() => {
            const uninstall = agent.ctx.tools.setExecutor(executor);
            options.executors.set(agent, executor);
            return () => {
                options.executors.delete(agent);
                uninstall();
            };
        }, 'dsh-dynamic-tools: install frozen-catalog executor');
        let released = false;
        release.set(agent, () => {
            if (released)
                return;
            released = true;
            release.delete(agent);
            dispose();
        });
    }
    catch (error) {
        if (options.reported.has(agent))
            return;
        options.reported.add(agent);
        ctx.logger.warn('dsh-dynamic-tools: cannot install for agent "%s": %o', agent.id, error);
    }
}
