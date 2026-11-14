/**
 * Model-visible text for disclosure messages and the tool-load notice.
 * The tags are the fold's input, so both sides change together.
 *
 * @module dsh-dynamic-tools/render
 */
import type { ToolSchemaLike } from './catalog.ts';
import type { DisclosureBatch } from './disclosure.ts';
import type { ToolStrategy } from './strategy.ts';
/**
 * Keep tool prose from closing a wrapper or block early. JSON accepts the
 * resulting backslash-slash escape, so a definition body stays parseable.
 * @param text - arbitrary tool-authored text.
 * @returns the text with every closing tag escape neutralized.
 */
export declare function escapeReminderText(text: string): string;
/**
 * Collapse text to one announcement line, keeping the name list parseable.
 * @param text - arbitrary tool-authored text.
 * @returns the text with line breaks and repeated whitespace collapsed.
 */
export declare function oneLine(text: string): string;
/**
 * Render one disclosure batch.
 *
 * An attached definition is only ever planned in `schema` mode, which the
 * declare-on-load strategy never uses, so it always carries the direct-call
 * instruction.
 *
 * @param batch - definitions, name-only entries, and removals.
 * @param strategy - how this route receives dynamic tools.
 * @returns the complete user-message text.
 */
export declare function renderDisclosure(batch: DisclosureBatch, strategy: ToolStrategy): string;
/**
 * Render the definitions `tool_load` returns for one tool.
 * @param schema - the definition to deliver.
 * @param strategy - how this route receives dynamic tools.
 * @returns the complete user-message text.
 */
export declare function renderLoadedDefinition(schema: ToolSchemaLike, strategy: ToolStrategy): string;
/**
 * Render the model-facing result of one `tool_load` call.
 * @param loaded - names whose definitions were delivered.
 * @param alreadyAvailable - names that are declared in the tool list already.
 * @param unavailable - names no longer registered or not admitted.
 * @param tooLarge - names too large to deliver.
 * @returns plain-text result content.
 */
export declare function renderLoadResult(loaded: readonly string[], alreadyAvailable: readonly string[], unavailable: readonly string[], tooLarge: readonly string[]): string;
/**
 * The reason reported when a catalog tool is not admitted for this step.
 * @param name - tool name the model called.
 * @param configured - configured reason for this name, when any.
 * @returns the model-facing denial reason.
 */
export declare function unavailableReason(name: string, configured: string | undefined): string;
/**
 * The reason reported when a loaded-on-demand tool has not been loaded.
 * @param name - tool name the model called.
 * @returns the model-facing denial reason.
 */
export declare function loadFirstReason(name: string): string;
