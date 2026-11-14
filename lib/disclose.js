/**
 * Trailing disclosure of dynamic tool definitions.
 *
 * Runs after the step's own pre-step listeners settle and appends recorded user
 * messages, so the request head never changes. The disclosed set follows the
 * registry, not the step's admission: a tool the model may not call right now
 * is still worth naming, because the call itself reports why it is unavailable.
 *
 * A route that reads only declared tool lists gets names instead of schemas:
 * its definition can only take effect once `tool_load` added it to the head, so
 * attaching it here would claim a callability the route does not have.
 *
 * @module dsh-dynamic-tools/disclose
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { applyDisclosure, oversizedNames, planDisclosure, } from "./disclosure.js";
import { foldDisclosed } from "./fold.js";
import { renderDisclosure } from "./render.js";
/** Per-Agent delivery state without retaining agents. */
const stateByAgent = new WeakMap();
/** Per-Agent diagnostics already reported, so each one appears once. */
const reportedByAgent = new WeakMap();
/**
 * Read the session's delivered state, rebuilding it from durable messages when
 * the process-local holder is missing (resume, fork, compaction).
 * @param agent - agent whose session is read.
 * @param kind - message source kind owned by this plugin.
 * @returns the folded state.
 */
export function currentState(agent, kind) {
    const held = stateByAgent.get(agent);
    if (held !== undefined)
        return held;
    const folded = foldDisclosed(agent.session.deriveMessages(), kind);
    stateByAgent.set(agent, folded);
    return folded;
}
/**
 * Replace the process-local state after a disclosure or a load.
 * @param agent - agent whose session was updated.
 * @param state - new state.
 */
export function storeState(agent, state) {
    stateByAgent.set(agent, state);
}
/**
 * Report a per-agent diagnostic once, so a repeated condition does not repeat
 * its log line on every step.
 * @param agent - agent the condition belongs to.
 * @param key - stable key for this condition.
 * @param report - emitter, called only for a key not reported before.
 */
function reportOnce(agent, key, report) {
    const reported = reportedByAgent.get(agent) ?? new Set();
    if (reported.has(key))
        return;
    reported.add(key);
    reportedByAgent.set(agent, reported);
    report();
}
function schemasOutsideCatalog(definitions, catalogNames) {
    return definitions
        .filter(definition => !catalogNames.has(definition.name))
        .map(definition => projectToolSchema(definition, true));
}
/**
 * Append this step's disclosure messages.
 *
 * Only definitions the step actually admits are candidates. A registered tool
 * whose `when` condition is false is unavailable right now: announcing it would
 * invite a call that can only be denied, so it is not disclosed at all.
 *
 * @param ctx - plugin context for diagnostics.
 * @param agent - agent entering the step.
 * @param admitted - definitions this step admits.
 * @param executorCatalog - names the frozen head declares.
 * @param options - disclosure settings.
 * @param strategy - how this step's route receives dynamic tools.
 * @returns the messages to append, in order.
 */
export function disclosureMessages(ctx, agent, admitted, executorCatalog, options, strategy) {
    const candidates = schemasOutsideCatalog(admitted, executorCatalog);
    const current = currentState(agent, options.sourceKind);
    for (const name of current.damaged) {
        reportOnce(agent, `damaged:${name}`, () => {
            ctx.logger.warn('dsh-dynamic-tools: recorded definition for "%s" could not be parsed; disclosing it again', name);
        });
    }
    const limits = strategy === 'declare' ? { ...options.limits, mode: 'names' } : options.limits;
    if (limits.mode === 'names') {
        for (const name of oversizedNames(candidates, limits)) {
            reportOnce(agent, `oversized:${name}`, () => {
                ctx.logger.warn('dsh-dynamic-tools: "%s" exceeds maxSchemaBytes (%d) and cannot be loaded on this route; it is not announced', name, limits.maxSchemaBytes);
            });
        }
    }
    const available = new Set(candidates.map(schema => schema.name));
    const removed = options.announceRemovals
        ? [...current.disclosed.keys()].filter(name => !available.has(name) && !executorCatalog.has(name))
        : [];
    const batches = planDisclosure(candidates, removed, current, limits);
    if (batches.length === 0) {
        // A pruned history still needs its records re-linked for later comparisons.
        const folded = foldDisclosed(agent.session.deriveMessages(), options.sourceKind);
        if (folded.disclosed.size !== current.disclosed.size)
            storeState(agent, folded);
        return [];
    }
    const messages = batches.map(batch => createUserMessage({
        content: [{ type: 'text', text: renderDisclosure(batch, strategy) }],
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
    ctx.on('agent/pre-step', async ({ agent, signal, modelSelection }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted)
            return decision;
        try {
            // The executor recorded this step's admission and strategy when assembly
            // described the head, which happens before this listener runs.
            const admitted = options.admitted(agent);
            if (admitted === undefined)
                return decision;
            const strategy = options.strategy(agent) ?? 'tail';
            if (strategy === 'declare') {
                reportOnce(agent, 'declare', () => {
                    ctx.logger.info('dsh-dynamic-tools: announcing definitions by name only on %s/%s; a loaded tool is declared in the next request', modelSelection.provider, modelSelection.model);
                });
            }
            const messages = disclosureMessages(ctx, agent, admitted, options.catalogNames(agent), options, strategy);
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
