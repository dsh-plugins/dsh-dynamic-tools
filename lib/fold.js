/**
 * Fold durable disclosure messages back into delivery state, so compaction,
 * resume, and fork rebuild the comparison instead of trusting process memory.
 *
 * @module dsh-dynamic-tools/fold
 */
import { toolSignature } from "./catalog.js";
const ADDED = /<tools_added>\n?([\s\S]*?)\n?<\/tools_added>/g;
const REMOVED = /<tools_removed>\n?([\s\S]*?)\n?<\/tools_removed>/g;
const DEFINITION = /<tool_definition name="([^"\n]+)">\n?([\s\S]*?)\n?<\/tool_definition>/g;
function textOf(message) {
    return message.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('');
}
function namesOf(body) {
    const names = [];
    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('- '))
            continue;
        const rest = trimmed.slice(2);
        const colon = rest.indexOf(': ');
        names.push(colon < 0 ? rest : rest.slice(0, colon));
    }
    return names.filter(name => name.length > 0);
}
function matches(text, pattern) {
    const bodies = [];
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern))
        bodies.push(match[1] ?? '');
    return bodies.flatMap(namesOf);
}
/**
 * Read one definition block, if it is a valid schema.
 * @param json - the block body.
 * @returns the parsed schema, or undefined when the text is not a schema object.
 */
function parseDefinition(json) {
    try {
        const value = JSON.parse(json);
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            return undefined;
        const candidate = value;
        if (typeof candidate.name !== 'string' || typeof candidate.description !== 'string')
            return undefined;
        if (typeof candidate.parameters !== 'object' || candidate.parameters === null)
            return undefined;
        return candidate;
    }
    catch (error) {
        void error;
        return undefined;
    }
}
/**
 * Fold every dynamic-tools message in delivery order.
 * Damaged blocks are ignored: an unreadable disclosure only costs one
 * re-announcement, never a wrong refusal.
 *
 * @param messages - derived session messages in model order.
 * @param kind - message source kind owned by this plugin.
 * @returns the delivered state at the end of the history.
 */
export function foldDisclosed(messages, kind) {
    const disclosed = new Map();
    const loaded = new Set();
    for (const message of messages) {
        if (message.source?.kind !== kind)
            continue;
        const text = textOf(message);
        for (const name of matches(text, REMOVED)) {
            disclosed.delete(name);
            loaded.delete(name);
        }
        const definitions = new Map();
        DEFINITION.lastIndex = 0;
        for (const match of text.matchAll(DEFINITION)) {
            const schema = parseDefinition(match[2] ?? '');
            if (schema !== undefined)
                definitions.set(schema.name, schema);
        }
        for (const name of matches(text, ADDED)) {
            const schema = definitions.get(name);
            if (schema === undefined) {
                disclosed.set(name, { signature: null, schema: false });
                continue;
            }
            disclosed.set(name, { signature: toolSignature(schema), schema: true });
            loaded.add(name);
        }
        for (const schema of definitions.values()) {
            disclosed.set(schema.name, { signature: toolSignature(schema), schema: true });
            loaded.add(schema.name);
        }
    }
    return { disclosed, loaded };
}
