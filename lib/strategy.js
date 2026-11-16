/** 按显式 Responses 路由、declareOnLoad 和 tail 的顺序选择动态工具协议。 */
/** Model families whose routes call only tools declared in the request. */
export const DEFAULT_DECLARE_MODELS = Object.freeze([
    'gpt*',
    'o1*',
    'o3*',
    'o4*',
    'chatgpt*',
    'codex*',
]);
/** Everything a pattern-match treats literally, apart from `*`. */
const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g;
/**
 * Match one identifier against a `*` wildcard pattern, ignoring case.
 *
 * The `*` is the only metacharacter; every other character is literal, so a
 * model id containing `.` or `-` matches only itself. The pattern is anchored,
 * so `gpt*` does not match `x-gpt-6`.
 *
 * @param pattern - glob-like pattern from configuration.
 * @param value - model id or provider route to test.
 * @returns whether the whole value matches the whole pattern.
 */
export function patternMatches(pattern, value) {
    const source = pattern.replace(REGEX_SPECIALS, '\\$&').split('*').join('.*');
    return new RegExp(`^${source}$`, 'i').test(value);
}
function matchesAny(patterns, value) {
    return patterns.length === 0 || patterns.some(pattern => patternMatches(pattern, value));
}
/**
 * Decide how one step's route receives dynamic tools.
 *
 * A missing selection cannot be classified, so it keeps the tail strategy: the
 * declaration head must never be guessed into a different shape.
 *
 * @param selection - route the step fixed for its request, when one is recorded.
 * @param rules - configured declare-on-load matching rules.
 * @returns 显式原生路由优先，其次按需声明，其余使用尾部文本。
 */
export function selectStrategy(selection, rules) {
    if (selection === undefined) {
        return 'tail';
    }
    if (rules.responses?.some(route => route.provider === selection.provider && matchesAny(route.models, selection.model))) {
        return 'responses';
    }
    if (!matchesAny(rules.models, selection.model)) {
        return 'tail';
    }
    if (!matchesAny(rules.providers, selection.provider)) {
        return 'tail';
    }
    return 'declare';
}
