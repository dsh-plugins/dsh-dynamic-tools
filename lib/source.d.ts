/**
 * The message source this plugin records, declared once so every module and the
 * fold agree on it.
 *
 * @module dsh-dynamic-tools/source
 */
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dynamic-tools': {
            kind: 'dynamic-tools';
        } & ContextFormed;
    }
}
/** Message source kind used for every disclosure and loaded definition. */
export declare const SOURCE_KIND: "dynamic-tools";
/** Type of {@link SOURCE_KIND}. */
export type SourceKind = typeof SOURCE_KIND;
