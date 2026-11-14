/**
 * Fold durable disclosure messages back into delivery state, so compaction,
 * resume, and fork rebuild the comparison instead of trusting process memory.
 *
 * @module dsh-dynamic-tools/fold
 */

import { toolSignature, type ToolSchemaLike } from './catalog.ts'
import type { DisclosedEntry, DisclosedState } from './disclosure.ts'

/** The subset of a model message this fold reads. */
export interface FoldableMessage {
  readonly role: string
  readonly content: readonly { readonly type: string, readonly text?: string }[]
  readonly source?: { readonly kind?: string }
}

const ADDED = /<tools_added>\n?([\s\S]*?)\n?<\/tools_added>/g
const REMOVED = /<tools_removed>\n?([\s\S]*?)\n?<\/tools_removed>/g
const DEFINITION = /<tool_definition name="([^"\n]+)">\n?([\s\S]*?)\n?<\/tool_definition>/g

function textOf(message: FoldableMessage): string {
  return message.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')
}

function namesOf(body: string): string[] {
  const names: string[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue
    const rest = trimmed.slice(2)
    const colon = rest.indexOf(': ')
    names.push(colon < 0 ? rest : rest.slice(0, colon))
  }
  return names.filter(name => name.length > 0)
}

function matches(text: string, pattern: RegExp): string[] {
  const bodies: string[] = []
  for (const match of text.matchAll(pattern)) bodies.push(match[1] ?? '')
  return bodies.flatMap(namesOf)
}

/**
 * Read one definition block, if it is a valid schema.
 *
 * A malformed block is not an error here: the fold reports it as damage, so the
 * next step re-announces the tool instead of trusting a wrong record.
 *
 * @param json - the block body.
 * @returns the parsed schema, or undefined when the text is not a schema object.
 */
function parseDefinition(json: string): ToolSchemaLike | undefined {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Partial<ToolSchemaLike>
  if (typeof candidate.name !== 'string' || typeof candidate.description !== 'string') return undefined
  if (typeof candidate.parameters !== 'object' || candidate.parameters === null) return undefined
  return candidate as ToolSchemaLike
}

/**
 * Fold every dynamic-tools message in delivery order.
 * A damaged block still marks its name as announced, so the model keeps seeing
 * the name; the definition is re-disclosed because it was never recorded.
 *
 * @param messages - derived session messages in model order.
 * @param kind - message source kind owned by this plugin.
 * @returns the delivered state at the end of the history.
 */
export function foldDisclosed(messages: readonly FoldableMessage[], kind: string): DisclosedState {
  const disclosed = new Map<string, DisclosedEntry>()
  const loaded = new Set<string>()
  const definitions = new Map<string, ToolSchemaLike>()
  const damaged = new Set<string>()
  for (const message of messages) {
    if (message.source?.kind !== kind) continue
    const text = textOf(message)
    for (const name of matches(text, REMOVED)) {
      disclosed.delete(name)
      loaded.delete(name)
      definitions.delete(name)
      damaged.delete(name)
    }
    const parsed = new Map<string, ToolSchemaLike>()
    for (const match of text.matchAll(DEFINITION)) {
      const schema = parseDefinition(match[2] ?? '')
      if (schema === undefined) damaged.add(match[1] ?? '')
      else parsed.set(schema.name, schema)
    }
    for (const name of matches(text, ADDED)) {
      const schema = parsed.get(name)
      if (schema === undefined) {
        disclosed.set(name, { signature: null, schema: false })
        continue
      }
      disclosed.set(name, { signature: toolSignature(schema), schema: true })
      loaded.add(name)
      definitions.set(name, schema)
      damaged.delete(name)
    }
    for (const schema of parsed.values()) {
      disclosed.set(schema.name, { signature: toolSignature(schema), schema: true })
      loaded.add(schema.name)
      definitions.set(schema.name, schema)
    }
  }
  return { disclosed, loaded, definitions, damaged: [...damaged] }
}
