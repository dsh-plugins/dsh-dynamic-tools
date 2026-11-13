/**
 * Model-visible text for disclosure messages and the tool-load notice.
 * The tags are the fold's input, so both sides change together.
 *
 * @module dsh-dynamic-tools/render
 */

import type { ToolSchemaLike } from './catalog.ts'
import type { DisclosureBatch } from './disclosure.ts'

const CLOSING_TAG = /<\//g

/**
 * Keep tool prose from closing a wrapper or block early. JSON accepts the
 * resulting backslash-slash escape, so a definition body stays parseable.
 * @param text - arbitrary tool-authored text.
 * @returns the text with every closing tag escape neutralized.
 */
export function escapeReminderText(text: string): string {
  return text.replace(CLOSING_TAG, '<\\/')
}

/**
 * Collapse text to one announcement line, keeping the name list parseable.
 * @param text - arbitrary tool-authored text.
 * @returns the text with line breaks and repeated whitespace collapsed.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Render one disclosure batch.
 * @param batch - definitions, name-only entries, and removals.
 * @returns the complete user-message text.
 */
export function renderDisclosure(batch: DisclosureBatch): string {
  const sections: string[] = []
  const announced: string[] = []
  for (const schema of batch.added) announced.push(`- ${schema.name}: ${oneLine(escapeReminderText(schema.description))}`)
  for (const name of batch.names) announced.push(`- ${name}`)
  if (announced.length > 0) sections.push(`<tools_added>\n${announced.join('\n')}\n</tools_added>`)
  for (const schema of batch.added) {
    sections.push(`<tool_definition name="${schema.name}">\n${escapeReminderText(JSON.stringify(schema))}\n</tool_definition>`)
  }
  if (batch.names.length > 0) {
    sections.push(`<tools_load_required>\n${batch.names.map(name => `- ${name}`).join('\n')}\n</tools_load_required>`)
  }
  if (batch.removed.length > 0) {
    sections.push(`<tools_removed>\n${batch.removed.map(name => `- ${name}`).join('\n')}\n</tools_removed>`)
  }
  const trailers: string[] = []
  if (batch.added.length > 0) {
    trailers.push('These tools are callable directly by name even though they are not in your tool list; match the definitions above.')
  }
  if (batch.names.length > 0) {
    trailers.push('Call tool_load with the names under tools_load_required before calling those tools.')
  }
  if (batch.removed.length > 0) {
    trailers.push('Removed tools are unavailable; they fail if called.')
  }
  sections.push(...trailers)
  return `<system-reminder>\n${sections.join('\n\n')}\n</system-reminder>`
}

/**
 * Render the definitions `tool_load` returns for one tool.
 * @param schema - the definition to deliver.
 * @returns the complete user-message text.
 */
export function renderLoadedDefinition(schema: ToolSchemaLike): string {
  return `<system-reminder>\n<tool_definition name="${schema.name}">\n${escapeReminderText(JSON.stringify(schema))}\n</tool_definition>\nThese tools are callable directly by name even though they are not in your tool list; match the definitions above.\n</system-reminder>`
}

/**
 * Render the model-facing result of one `tool_load` call.
 * @param loaded - names whose definitions were delivered.
 * @param alreadyAvailable - names that are declared in the tool list already.
 * @param unavailable - names no longer registered or not admitted.
 * @param tooLarge - names too large to deliver.
 * @returns plain-text result content.
 */
export function renderLoadResult(
  loaded: readonly string[],
  alreadyAvailable: readonly string[],
  unavailable: readonly string[],
  tooLarge: readonly string[],
): string {
  const lines: string[] = []
  if (loaded.length > 0) lines.push(`Loaded: ${loaded.join(', ')}`)
  if (alreadyAvailable.length > 0) lines.push(`Already available: ${alreadyAvailable.join(', ')}`)
  if (unavailable.length > 0) lines.push(`Unavailable: ${unavailable.join(', ')}`)
  if (tooLarge.length > 0) lines.push(`Definition too large to load: ${tooLarge.join(', ')}`)
  if (lines.length === 0) return 'No tool names were supplied.'
  return lines.join('\n')
}

/**
 * The reason reported when a catalog tool is not admitted for this step.
 * @param name - tool name the model called.
 * @param configured - configured reason for this name, when any.
 * @returns the model-facing denial reason.
 */
export function unavailableReason(name: string, configured: string | undefined): string {
  return configured ?? `Tool "${name}" is registered but not available in the current session state; ask the user to enable it, then retry.`
}

/**
 * The reason reported when a loaded-on-demand tool has not been loaded.
 * @param name - tool name the model called.
 * @returns the model-facing denial reason.
 */
export function loadFirstReason(name: string): string {
  return `Tool "${name}" is available but its definition is not loaded. Call tool_load with {"names":["${name}"]} first, then call it again.`
}
