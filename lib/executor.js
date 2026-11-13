/**
 * Frozen-catalog tool executor.
 *
 * The declaration head is captured once, when this executor is installed, and
 * returned unchanged for every later step, so a mid-conversation tool change
 * never rewrites the request prefix. Tools outside that head stay callable
 * through tail disclosure, but only while the step admits them: an unadmitted
 * call is reported as an executable denial before policy and approval run.
 *
 * @module dsh-dynamic-tools/executor
 */
import { executeToolBatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { classifyTool } from "./catalog.js";
import { loadFirstReason, unavailableReason } from "./render.js";
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
    constructor(ctx, agent, rules, options, state) {
        this.ctx = ctx;
        this.agent = agent;
        this.rules = rules;
        this.options = options;
        this.state = state;
    }
    /** Names the frozen head declares; empty before the first assembly. */
    declaredNames() {
        return this.catalogNames;
    }
    /** Definitions the current step admits, captured by the last assembly. */
    admittedDefinitions() {
        return this.lastAdmitted;
    }
    /**
     * Capture the head from the first assembly, then return it unchanged.
     * The first assembly's admission is exactly the declaration set the session
     * starts with, so the head matches what every later request would have
     * declared while the tool set is unchanged.
     * @param tools - definitions this step admits, in registry order.
     * @returns the frozen model-facing catalog.
     */
    describe(tools) {
        this.lastAdmitted = tools;
        if (this.catalog === undefined) {
            this.catalog = Object.freeze(tools
                .filter(definition => classifyTool(definition.name, this.rules) === 'inline')
                .map(definition => Object.freeze(projectToolSchema(definition, true))));
            for (const schema of this.catalog)
                this.catalogNames.add(schema.name);
        }
        return { schemas: [...this.catalog] };
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
            if (this.catalogNames.has(name) || !this.options.requireLoad)
                return undefined;
            return this.state.loaded().has(name) ? undefined : new Error(loadFirstReason(name));
        }
        if (!this.catalogNames.has(name) && !this.state.disclosed().has(name))
            return undefined;
        return new Error(unavailableReason(name, this.options.unavailableReasons[name]));
    }
}
