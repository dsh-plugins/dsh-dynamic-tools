/** 保持声明基线稳定，动态工具复用宿主执行管线，并按当步准入与已保存定义校验。 */
import { classifyTool, extendCatalog, toolSignature, } from "./catalog.js";
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
    host;
    /** 连续原生步骤共用基线；从其它策略进入时以已保存请求头重新建立基线。 */
    catalog;
    /** Names the head declares. */
    catalogNames = new Set();
    /** Definitions the current step admits, recorded by the last assembly. */
    lastAdmitted = [];
    /** Names the current batch's step admits. */
    admittedNames = new Set();
    /** Strategy settled by the current step's assembly, so every reader agrees. */
    stepStrategy;
    stepRoute;
    /** Whether the missing-load-tool diagnostic was already reported. */
    loadWarningReported = false;
    constructor(ctx, agent, rules, options, state, host) {
        this.ctx = ctx;
        this.agent = agent;
        this.rules = rules;
        this.options = options;
        this.state = state;
        this.host = host;
    }
    /** Names the frozen head declares, plus every loaded tool on a declare route. */
    declaredNames() {
        if (this.planStrategy() !== 'declare') {
            return this.catalogNames;
        }
        const names = new Set(this.catalogNames);
        for (const name of this.state.definitions().keys()) {
            names.add(name);
        }
        return names;
    }
    /** Definitions the current step admits, captured by the last assembly. */
    admittedDefinitions() {
        return this.lastAdmitted;
    }
    /**
     * 原生策略恢复已保存基线并冻结本步路由；连续步骤返回同一工具头部。
     * declare 仍把已加载定义加入顶层，切回原生时按该已保存头部建立新基线。
     * @param tools - definitions this step admits, in registry order.
     * @returns the frozen model-facing catalog.
     */
    describe(tools) {
        this.lastAdmitted = tools;
        const previousStrategy = this.stepStrategy;
        const selection = this.agent.model.current();
        this.stepRoute = selection === undefined ? undefined : { provider: selection.provider, model: selection.model };
        this.stepStrategy = selectStrategy(selection, this.options.strategyRules);
        if (this.stepStrategy === 'responses' && previousStrategy !== 'responses') {
            const header = this.agent.session.requestHeader();
            if (header !== undefined) {
                const recorded = header.tools ?? [];
                this.catalog = this.host.deepFreeze(structuredClone(recorded));
                this.catalogNames.clear();
                for (const schema of recorded) {
                    this.catalogNames.add(schema.name);
                }
            }
        }
        const catalog = this.catalog ?? this.capture(tools);
        if (this.stepStrategy !== 'declare') {
            return { schemas: [...catalog] };
        }
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
        const pipeline = new this.host.ToolExecutionPipeline(this.ctx, {
            get: (name, scope, toolSet) => this.resolve(name, scope, toolSet),
            reject: (name) => this.reject(name),
        });
        return this.host.executeToolBatch(input, pipeline, () => input.maxParallelToolCalls ?? this.options.maxParallelCalls);
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
    /** 配置保存仅影响下次组装，发送时必须仍是本步捕获的原生路由。 */
    matchesResponsesRoute(request) {
        return this.stepStrategy === 'responses' && this.stepRoute?.provider === request.provider && this.stepRoute.model === request.model;
    }
    /**
     * Capture the declaration head from the first assembly.
     * @param tools - definitions the first assembly admits.
     * @returns the frozen model-facing catalog.
     */
    capture(tools) {
        const catalog = Object.freeze(tools
            .filter(definition => classifyTool(definition.name, this.rules) === 'inline')
            .map(definition => this.host.deepFreeze(this.host.projectToolSchema(definition, true))));
        this.catalog = catalog;
        for (const schema of catalog) {
            this.catalogNames.add(schema.name);
        }
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
            if (this.catalogNames.has(name)) {
                continue;
            }
            const current = live.get(name);
            declared.push(Object.freeze(current === undefined ? recorded : this.host.projectToolSchema(current, true)));
        }
        return extendCatalog(catalog, declared);
    }
    /**
     * Report once that a declare route cannot load anything because the frozen
     * head does not declare the load tool.
     */
    reportMissingLoadTool() {
        if (this.loadWarningReported || this.catalogNames.has(this.options.loadToolName)) {
            return;
        }
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
        if (admitted !== undefined) {
            return admitted;
        }
        if (!this.catalogNames.has(name) && !this.state.disclosed().has(name)
            && !(this.planStrategy() === 'responses' && this.state.definitions().has(name))) {
            return undefined;
        }
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
            if (this.planStrategy() === 'responses') {
                const current = this.lastAdmitted.find(definition => definition.name === name);
                const declared = this.state.definitions().get(name) ?? this.catalog?.find(schema => schema.name === name);
                if (!current || !declared || toolSignature(this.host.projectToolSchema(current, true)) !== toolSignature(declared)) {
                    return new Error(loadFirstReason(name));
                }
                return undefined;
            }
            if (this.catalogNames.has(name) || !this.requiresLoad()) {
                return undefined;
            }
            return this.state.loaded().has(name) ? undefined : new Error(loadFirstReason(name));
        }
        if (!this.catalogNames.has(name) && !this.state.disclosed().has(name)
            && !(this.planStrategy() === 'responses' && this.state.definitions().has(name))) {
            return undefined;
        }
        return new Error(unavailableReason(name, this.options.unavailableReasons[name]));
    }
    /** Whether a dynamic tool must be loaded before it may run on this route. */
    requiresLoad() {
        return this.options.requireLoad || this.planStrategy() === 'declare';
    }
}
