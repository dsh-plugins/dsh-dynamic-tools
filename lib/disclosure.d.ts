/**
 * Pure disclosure planning: which dynamic tool definitions become trailing
 * messages on this step, how they are batched, and which names stop applying.
 *
 * @module dsh-dynamic-tools/disclosure
 */
import { type ToolSchemaLike } from './catalog.ts';
/** Validated disclosure limits. */
export interface DisclosureLimits {
    /** Whether definitions are attached to the disclosure message. */
    readonly mode: 'schema' | 'names';
    /** Maximum tools announced in one message. */
    readonly maxToolsPerMessage: number;
    /** Maximum UTF-8 bytes of one attached definition. */
    readonly maxSchemaBytes: number;
    /** Maximum UTF-8 bytes of one disclosure message. */
    readonly maxMessageBytes: number;
}
/** One message's worth of disclosure. */
export interface DisclosureBatch {
    /** Definitions whose full schema is attached. */
    readonly added: readonly ToolSchemaLike[];
    /** Names announced without a schema; the model must call `tool_load`. */
    readonly names: readonly string[];
    /** Names that are no longer available. */
    readonly removed: readonly string[];
}
/** What was delivered for one name. */
export interface DisclosedEntry {
    /** Signature of the delivered definition, or `null` when only the name was announced. */
    readonly signature: string | null;
    /** Whether the full schema was delivered. */
    readonly schema: boolean;
}
/** What the model has already been told, folded from durable messages. */
export interface DisclosedState {
    /** Delivered name → delivery record. */
    readonly disclosed: ReadonlyMap<string, DisclosedEntry>;
    /** Names whose full definition the model has read, attached or loaded on demand. */
    readonly loaded: ReadonlySet<string>;
    /**
     * Definitions the model has read, in delivery order.
     *
     * The declare-on-load strategy turns these into tool-list declarations, so
     * they outlive the announcement: a loaded tool stays declared even after the
     * registry stops admitting it.
     */
    readonly definitions: ReadonlyMap<string, ToolSchemaLike>;
    /**
     * Names whose recorded definition block could not be parsed, in delivery
     * order. The caller reports them: the definition is disclosed again, and the
     * damage must not stay silent.
     */
    readonly damaged: readonly string[];
}
/** The empty state of a session that has disclosed nothing yet. */
export declare const EMPTY_DISCLOSED: DisclosedState;
/**
 * Definitions that no route can deliver because they exceed the schema cap.
 *
 * A `tail` route can still announce such a tool by name — the model calls it
 * without reading the schema, and `tool_load` reports the cap. A `names` route
 * has no such fallback: the tool can only run after its definition was loaded,
 * so announcing it would promise a load that must fail.
 *
 * @param schemas - dynamic definitions admitted for this step.
 * @param limits - validated disclosure limits.
 * @returns names whose definition exceeds `maxSchemaBytes`.
 */
export declare function oversizedNames(schemas: readonly ToolSchemaLike[], limits: DisclosureLimits): string[];
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
export declare function planDisclosure(admitted: readonly ToolSchemaLike[], removed: readonly string[], state: DisclosedState, limits: DisclosureLimits): DisclosureBatch[];
/**
 * Record one delivered definition, clearing any earlier damage for that name.
 * @param state - state before this delivery.
 * @param schema - definition the model has now read.
 * @returns the updated state.
 */
export declare function withDefinition(state: DisclosedState, schema: ToolSchemaLike): DisclosedState;
/**
 * Fold delivered batches into the delivered state.
 * @param previous - state before these batches.
 * @param batches - batches that were delivered.
 * @returns the updated state.
 */
export declare function applyDisclosure(previous: DisclosedState, batches: readonly DisclosureBatch[]): DisclosedState;
