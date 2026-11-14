/**
 * How one route receives dynamic tools: at the conversation tail, or declared
 * in the tool list after an explicit load.
 *
 * OpenAI Responses routes call only the functions present in the request's
 * `tools` array, so a definition delivered as conversation text is never
 * invoked. Those routes need the definition loaded through `tool_load` and
 * declared on the following request. Every other route reads the tail
 * disclosure and calls the tool directly, which needs no declaration change.
 *
 * Pure module: no Harness imports, so it runs under the Node type-stripping
 * loader in tests.
 *
 * @module dsh-dynamic-tools/strategy
 */

/** How one Agent's dynamic tools reach the model. */
export type ToolStrategy = 'tail' | 'declare'

/** Route matching rules for the declare-on-load strategy. */
export interface StrategyRules {
  /** Model-id patterns; an empty list matches every model. */
  readonly models: readonly string[]
  /** Provider-route patterns; an empty list matches every provider. */
  readonly providers: readonly string[]
}

/** Model families whose routes call only tools declared in the request. */
export const DEFAULT_DECLARE_MODELS: readonly string[] = Object.freeze([
  'gpt*',
  'o1*',
  'o3*',
  'o4*',
  'chatgpt*',
  'codex*',
])

/** Everything a pattern-match treats literally, apart from `*`. */
const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g

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
export function patternMatches(pattern: string, value: string): boolean {
  const source = pattern.replace(REGEX_SPECIALS, '\\$&').split('*').join('.*')
  return new RegExp(`^${source}$`, 'i').test(value)
}

function matchesAny(patterns: readonly string[], value: string): boolean {
  return patterns.length === 0 || patterns.some(pattern => patternMatches(pattern, value))
}

/**
 * Decide how one step's route receives dynamic tools.
 *
 * A missing selection cannot be classified, so it keeps the tail strategy: the
 * declaration head must never be guessed into a different shape.
 *
 * @param selection - route the step fixed for its request, when one is recorded.
 * @param rules - configured declare-on-load matching rules.
 * @returns `declare` only when both the model and the provider match.
 */
export function selectStrategy(
  selection: { readonly provider: string, readonly model: string } | undefined,
  rules: StrategyRules,
): ToolStrategy {
  if (selection === undefined) return 'tail'
  if (!matchesAny(rules.models, selection.model)) return 'tail'
  if (!matchesAny(rules.providers, selection.provider)) return 'tail'
  return 'declare'
}
