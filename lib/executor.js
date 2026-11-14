/**
 * Frozen-catalog tool executor.
 *
 * The declaration head is captured once, when this executor is installed, and
 * returned unchanged for every later step, so a mid-conversation tool change
 * never rewrites the request prefix. Tools outside that head stay callable
 * through tail disclosure, but only while the step admits them: an unadmitted
 * call is reported as an executable denial before policy and approval run.
 *
 * Routes that call only declared tools need the second half: a definition the
 * model loaded through `tool_load` is appended to the declaration head, so the
 * model can invoke it natively. The addition is monotone — a loaded tool keeps
 * its declaration for the rest of the session — so the head changes once per
 * loaded tool instead of once per admission change.
 *
 * @module dsh-dynamic-tools/executor
 */
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { classifyTool, extendCatalog, } from "./catalog.js";
import { loadFirstReason, unavailableReason } from "./render.js";
import { selectStrategy } from "./strategy.js";
/**
 * Executes the frozen declaration head plus admitted dynamic tools.
 */
export class StableCatalogExecutor {
    ctx;
    agent;
    rules;
    options;
    state;
    /** Declaration head, captured by the first assembly and never replaced. */
    catalog;
    /** Names the head declares. */
    catalogNames = new Set();
    /** Definitions the current step admits, recorded by the last assembly. */
    lastAdmitted = [];
    /** Names the current batch's step admits. */
    admittedNames = new Set();
    /** Strategy settled by the current step's assembly, so every reader agrees. */
    stepStrategy;
    /** Whether the missing-load-tool diagnostic was already reported. */
    loadWarningReported = false;
    constructor(ctx, agent, rules, options, state) {
        this.ctx = ctx;
        this.agent = agent;
        this.rules = rules;
        this.options = options;
        this.state = state;
    }
    /** Names the frozen head declares, plus every loaded tool on a declare route. */
    declaredNames() {
        if (this.planStrategy() !== 'declare')
            return this.catalogNames;
        const names = new Set(this.catalogNames);
        for (const name of this.state.definitions().keys())
            names.add(name);
        return names;
    }
    /** Definitions the current step admits, captured by the last assembly. */
    admittedDefinitions() {
        return this.lastAdmitted;
    }
    /**
     * Capture the head from the first assembly, then return it unchanged, plus
     * every loaded definition on a declare route.
     * The first assembly's admission is exactly the declaration set the session
     * starts with, so the head matches what every later request would have
     * declared while the tool set is unchanged.
     * @param tools - definitions this step admits, in registry order.
     * @returns the frozen model-facing catalog.
     */
    describe(tools) {
        this.lastAdmitted = tools;
        this.stepStrategy = selectStrategy(this.agent.model.current(), this.options.strategyRules);
        const catalog = this.catalog ?? this.capture(tools);
        if (this.stepStrategy !== 'declare')
            return { schemas: [...catalog] };
        this.reportMissingLoadTool();
        return { schemas: this.withDeclared(catalog) };
    }
    /**
     * Execute one batch against the frozen head and the admitted dynamic set.
     * @param input - original calls, admission, agent, and logging step.
     * @returns settled results in model order.
     */
    execute(input) {
        this.admittedNames = new Set((input.toolSet?.view(this.agent) ?? new Map()).keys());
        const pipeline = new ToolExecutionPipeline(this.ctx, {
            get: (name, scope, toolSet) => this.resolve(name, scope, toolSet),
            reject: (name) => this.reject(name),
        });
        return executeToolBatch(input, pipeline, () => input.maxParallelToolCalls ?? this.options.maxParallelCalls);
    }
    /**
     * How this step's route receives dynamic tools.
     *
     * The assembly that described this step's head fixes it once. Every later
     * reader in the same step — declaration names, the load requirement, the
     * disclosure listener — sees that one decision, so a model switch cannot make
     * the head and the announcement disagree.
     * @returns the recorded strategy, or the current route's before any assembly.
     */
    planStrategy() {
        return this.stepStrategy ?? selectStrategy(this.agent.model.current(), this.options.strategyRules);
    }
    /**
     * Capture the declaration head from the first assembly.
     * @param tools - definitions the first assembly admits.
     * @returns the frozen model-facing catalog.
     */
    capture(tools) {
        const catalog = Object.freeze(tools
            .filter(definition => classifyTool(definition.name, this.rules) === 'inline')
            .map(definition => Object.freeze(projectToolSchema(definition, true))));
        this.catalog = catalog;
        for (const schema of catalog)
            this.catalogNames.add(schema.name);
        return catalog;
    }
    /**
     * Append every loaded definition to the frozen head.
     * A loaded tool the step still admits uses its live definition, so argument
     * validation matches the call it will run; a tool that no longer admits keeps
     * the definition the model read, because the head must not shrink.
     * @param catalog - frozen declaration head.
     * @returns the head followed by the loaded definitions, in load order.
     */
    withDeclared(catalog) {
        const live = new Map(this.lastAdmitted.map(definition => [definition.name, definition]));
        const declared = [];
        for (const [name, recorded] of this.state.definitions()) {
            if (this.catalogNames.has(name))
                continue;
            const current = live.get(name);
            declared.push(Object.freeze(current === undefined ? recorded : projectToolSchema(current, true)));
        }
        return extendCatalog(catalog, declared);
    }
    /**
     * Report once that a declare route cannot load anything because the frozen
     * head does not declare the load tool.
     */
    reportMissingLoadTool() {
        if (this.loadWarningReported || this.catalogNames.has(this.options.loadToolName))
            return;
        this.loadWarningReported = true;
        this.ctx.logger.warn('dsh-dynamic-tools: agent "%s" declares loaded tools in its tool list, but "%s" is absent from its frozen head; dynamic tools cannot be loaded in this session', this.agent.id, this.options.loadToolName);
    }
    /**
     * Resolve one call name: the step's admission first, then the registered
     * definition for a name the head declares or the model was told about.
     * @param name - tool name the model called.
     * @param scope - calling agent scope.
     * @param toolSet - step admission, when one exists.
     * @returns the definition to run, or undefined for an unknown tool.
     */
    resolve(name, scope, toolSet) {
        const admitted = toolSet?.view(scope).get(name);
        if (admitted !== undefined)
            return admitted;
        if (!this.catalogNames.has(name) && !this.state.disclosed().has(name))
            return undefined;
        return this.ctx.tools.definitions(this.agent).find(definition => definition.name === name);
    }
    /**
     * Decide the model-facing denial for a declared but unadmitted name, and for a
     * dynamic tool that must be loaded first. Runs before policy and approval.
     * @param name - tool name the model called.
     * @returns the denial, or undefined to let dispatch proceed.
     */
    reject(name) {
        if (this.admittedNames.has(name)) {
            if (this.catalogNames.has(name) || !this.requiresLoad())
                return undefined;
            return this.state.loaded().has(name) ? undefined : new Error(loadFirstReason(name));
        }
        if (!this.catalogNames.has(name) && !this.state.disclosed().has(name))
            return undefined;
        return new Error(unavailableReason(name, this.options.unavailableReasons[name]));
    }
    /** Whether a dynamic tool must be loaded before it may run on this route. */
    requiresLoad() {
        return this.options.requireLoad || this.planStrategy() === 'declare';
    }
}
