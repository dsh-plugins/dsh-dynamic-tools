/**
 * Pure disclosure planning: which dynamic tool definitions become trailing
 * messages on this step, how they are batched, and which names stop applying.
 *
 * @module dsh-dynamic-tools/disclosure
 */

import { schemaBytes, toolSignature, type ToolSchemaLike } from './catalog.ts'

/** Validated disclosure limits. */
export interface DisclosureLimits {
  /** Whether definitions are attached to the disclosure message. */
  readonly mode: 'schema' | 'names'
  /** Maximum tools announced in one message. */
  readonly maxToolsPerMessage: number
  /** Maximum UTF-8 bytes of one attached definition. */
  readonly maxSchemaBytes: number
  /** Maximum UTF-8 bytes of one disclosure message. */
  readonly maxMessageBytes: number
}

/** One message's worth of disclosure. */
export interface DisclosureBatch {
  /** Definitions whose full schema is attached. */
  readonly added: readonly ToolSchemaLike[]
  /** Names announced without a schema; the model must call `tool_load`. */
  readonly names: readonly string[]
  /** Names that are no longer available. */
  readonly removed: readonly string[]
}

/** What was delivered for one name. */
export interface DisclosedEntry {
  /** Signature of the delivered definition, or `null` when only the name was announced. */
  readonly signature: string | null
  /** Whether the full schema was delivered. */
  readonly schema: boolean
}

/** What the model has already been told, folded from durable messages. */
export interface DisclosedState {
  /** Delivered name → delivery record. */
  readonly disclosed: ReadonlyMap<string, DisclosedEntry>
  /** Names whose full definition the model has read, attached or loaded on demand. */
  readonly loaded: ReadonlySet<string>
}

/** The empty state of a session that has disclosed nothing yet. */
export const EMPTY_DISCLOSED: DisclosedState = { disclosed: new Map(), loaded: new Set() }

/**
 * Plan the disclosures one step needs.
 *
 * Adds a tool when it is newly admitted or its definition changed since a full
 * delivery. A name announced without a schema stays announced: `tool_load`
 * always serves the current definition, so re-announcing it would only add noise.
 *
 * @param admitted - dynamic definitions admitted for this step.
 * @param removed - names previously disclosed that are no longer admitted.
 * @param state - previously delivered state.
 * @param limits - validated disclosure limits.
 * @returns ordered batches, empty when the model already knows everything.
 */
export function planDisclosure(
  admitted: readonly ToolSchemaLike[],
  removed: readonly string[],
  state: DisclosedState,
  limits: DisclosureLimits,
): DisclosureBatch[] {
  const attached: ToolSchemaLike[] = []
  const namesOnly: string[] = []
  for (const schema of admitted) {
    const entry = state.disclosed.get(schema.name)
    if (entry !== undefined) {
      if (!entry.schema) continue
      if (entry.signature === toolSignature(schema)) continue
    }
    if (limits.mode === 'schema' && schemaBytes(schema) <= limits.maxSchemaBytes) attached.push(schema)
    else namesOnly.push(schema.name)
  }

  const batches: DisclosureBatch[] = []
  let pendingAdded: ToolSchemaLike[] = []
  let pendingNames: string[] = []
  let pendingRemoved: string[] = []
  let usedBytes = 0
  let pendingCount = 0

  const flush = (): void => {
    if (pendingCount === 0) return
    batches.push({ added: pendingAdded, names: pendingNames, removed: pendingRemoved })
    pendingAdded = []
    pendingNames = []
    pendingRemoved = []
    usedBytes = 0
    pendingCount = 0
  }

  const reserve = (bytes: number): void => {
    if (pendingCount > 0 && (pendingCount >= limits.maxToolsPerMessage || usedBytes + bytes > limits.maxMessageBytes)) flush()
    usedBytes += bytes
    pendingCount += 1
  }

  for (const schema of attached) {
    reserve(limits.mode === 'schema' ? schemaBytes(schema) : schema.name.length)
    pendingAdded.push(schema)
  }
  for (const name of namesOnly) {
    reserve(name.length)
    pendingNames.push(name)
  }
  for (const name of removed) {
    reserve(name.length)
    pendingRemoved.push(name)
  }
  flush()
  return batches
}

/**
 * Fold delivered batches into the delivered state.
 * @param previous - state before these batches.
 * @param batches - batches that were delivered.
 * @returns the updated state.
 */
export function applyDisclosure(
  previous: DisclosedState,
  batches: readonly DisclosureBatch[],
): DisclosedState {
  const disclosed = new Map(previous.disclosed)
  const loaded = new Set(previous.loaded)
  for (const batch of batches) {
    for (const schema of batch.added) {
      disclosed.set(schema.name, { signature: toolSignature(schema), schema: true })
      loaded.add(schema.name)
    }
    for (const name of batch.names) {
      disclosed.set(name, { signature: null, schema: false })
    }
    for (const name of batch.removed) {
      disclosed.delete(name)
      loaded.delete(name)
    }
  }
  return { disclosed, loaded }
}
