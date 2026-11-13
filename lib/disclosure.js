/**
 * Pure disclosure planning: which dynamic tool definitions become trailing
 * messages on this step, how they are batched, and which names stop applying.
 *
 * @module dsh-dynamic-tools/disclosure
 */
import { schemaBytes, toolSignature } from "./catalog.js";
/** The empty state of a session that has disclosed nothing yet. */
export const EMPTY_DISCLOSED = { disclosed: new Map(), loaded: new Set() };
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
export function planDisclosure(admitted, removed, state, limits) {
    const attached = [];
    const namesOnly = [];
    for (const schema of admitted) {
        const entry = state.disclosed.get(schema.name);
        if (entry !== undefined) {
            if (!entry.schema)
                continue;
            if (entry.signature === toolSignature(schema))
                continue;
        }
        if (limits.mode === 'schema' && schemaBytes(schema) <= limits.maxSchemaBytes)
            attached.push(schema);
        else
            namesOnly.push(schema.name);
    }
    const batches = [];
    let pendingAdded = [];
    let pendingNames = [];
    let pendingRemoved = [];
    let usedBytes = 0;
    let pendingCount = 0;
    const flush = () => {
        if (pendingCount === 0)
            return;
        batches.push({ added: pendingAdded, names: pendingNames, removed: pendingRemoved });
        pendingAdded = [];
        pendingNames = [];
        pendingRemoved = [];
        usedBytes = 0;
        pendingCount = 0;
    };
    const reserve = (bytes) => {
        if (pendingCount > 0 && (pendingCount >= limits.maxToolsPerMessage || usedBytes + bytes > limits.maxMessageBytes))
            flush();
        usedBytes += bytes;
        pendingCount += 1;
    };
    for (const schema of attached) {
        reserve(limits.mode === 'schema' ? schemaBytes(schema) : schema.name.length);
        pendingAdded.push(schema);
    }
    for (const name of namesOnly) {
        reserve(name.length);
        pendingNames.push(name);
    }
    for (const name of removed) {
        reserve(name.length);
        pendingRemoved.push(name);
    }
    flush();
    return batches;
}
/**
 * Fold delivered batches into the delivered state.
 * @param previous - state before these batches.
 * @param batches - batches that were delivered.
 * @returns the updated state.
 */
export function applyDisclosure(previous, batches) {
    const disclosed = new Map(previous.disclosed);
    const loaded = new Set(previous.loaded);
    for (const batch of batches) {
        for (const schema of batch.added) {
            disclosed.set(schema.name, { signature: toolSignature(schema), schema: true });
            loaded.add(schema.name);
        }
        for (const name of batch.names) {
            disclosed.set(name, { signature: null, schema: false });
        }
        for (const name of batch.removed) {
            disclosed.delete(name);
            loaded.delete(name);
        }
    }
    return { disclosed, loaded };
}
