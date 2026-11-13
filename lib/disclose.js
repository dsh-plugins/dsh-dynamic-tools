/**
 * Trailing disclosure of dynamic tool definitions.
 *
 * Runs after the step's own pre-step listeners settle and appends recorded user
 * messages, so the request head never changes. The disclosed set follows the
 * registry, not the step's admission: a tool the model may not call right now
 * is still worth naming, because the call itself reports why it is unavailable.
 *
 * @module dsh-dynamic-tools/disclose
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { applyDisclosure, planDisclosure } from "./disclosure.js";
import { foldDisclosed } from "./fold.js";
import { renderDisclosure } from "./render.js";
/** Per-Agent delivery state without retaining agents. */
const stateByAgent = new WeakMap();
/**
 * Read the session's delivered state, rebuilding it from durable messages when
 * the process-local holder is missing (resume, fork, compaction).
 * @param agent - agent whose session is read.
 * @param kind - message source kind owned by this plugin.
 * @returns the folded state.
 */
export function currentState(agent, kind) {
    const holder = stateByAgent.get(agent);
    if (holder !== undefined)
        return holder.state;
    const folded = foldDisclosed(agent.session.deriveMessages(), kind);
    stateByAgent.set(agent, { state: folded });
    return folded;
}
/**
 * Replace the process-local state after a disclosure or a load.
 * @param agent - agent whose session was updated.
 * @param state - new state.
 */
export function storeState(agent, state) {
    stateByAgent.set(agent, { state });
}
/**
 * Drop process-local state so the next read folds the durable messages again.
 * @param agent - agent whose session was compacted or replaced.
 */
export function invalidateState(agent) {
    stateByAgent.delete(agent);
}
function schemasOutsideCatalog(definitions, catalogNames) {
    return definitions
        .filter(definition => !catalogNames.has(definition.name))
        .map(definition => projectToolSchema(definition, true));
}
/**
 * Append this step's disclosure messages.
 * @param ctx - plugin context for diagnostics.
 * @param agent - agent entering the step.
 * @param executorCatalog - names the frozen head declares.
 * @param options - disclosure settings.
 * @returns the messages to append, in order.
 */
export function disclosureMessages(ctx, agent, executorCatalog, options) {
    const candidates = schemasOutsideCatalog(ctx.tools.definitions(agent), executorCatalog);
    const current = currentState(agent, options.sourceKind);
    const registered = new Set(candidates.map(schema => schema.name));
    const removed = options.announceRemovals
        ? [...current.disclosed.keys()].filter(name => !registered.has(name) && !executorCatalog.has(name))
        : [];
    const batches = planDisclosure(candidates, removed, current, options.limits);
    if (batches.length === 0) {
        // A pruned history still needs its records re-linked for later comparisons.
        const folded = foldDisclosed(agent.session.deriveMessages(), options.sourceKind);
        if (folded.disclosed.size !== current.disclosed.size)
            storeState(agent, folded);
        return [];
    }
    const messages = batches.map(batch => createUserMessage({
        content: [{ type: 'text', text: renderDisclosure(batch) }],
        source: { kind: options.sourceKind, form: 'catalog' },
    }));
    storeState(agent, applyDisclosure(current, batches));
    ctx.logger.debug('dsh-dynamic-tools: disclosed %d batch(es) at step start', batches.length);
    return messages;
}
/**
 * Register the pre-step listener that appends disclosures.
 * @param ctx - plugin context owning the listener.
 * @param options - disclosure settings.
 */
export function registerDisclosure(ctx, options) {
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted)
            return decision;
        try {
            const messages = disclosureMessages(ctx, agent, options.catalogNames(agent), options);
            if (messages.length === 0)
                return decision;
            return { ...decision, messages: [...decision.messages, ...messages] };
        }
        catch (error) {
            ctx.logger.warn('dsh-dynamic-tools: failed to disclose tool definitions at step start: %o', error);
            return decision;
        }
    });
}
