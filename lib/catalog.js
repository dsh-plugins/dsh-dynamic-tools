/**
 * Pure classification and signature helpers for the frozen tool catalog.
 * No Harness imports: these run under the Node type-stripping loader in tests.
 *
 * @module dsh-dynamic-tools/catalog
 */
/**
 * Decide how one tool name is disclosed.
 * @param name - registered tool name.
 * @param rules - configured classification rules.
 * @returns `inline` for the frozen catalog, `dynamic` for tail disclosure.
 */
export function classifyTool(name, rules) {
    if (rules.inlineNames.includes(name))
        return 'inline';
    if (rules.dynamicNames.includes(name))
        return 'dynamic';
    if (rules.dynamicPrefixes.some(prefix => name.startsWith(prefix)))
        return 'dynamic';
    return 'inline';
}
/** Deterministic JSON text with object keys sorted, so equal schemas compare equal. */
function stableJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    const entries = Object.keys(value).sort()
        .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`);
    return `{${entries.join(',')}}`;
}
/**
 * Identity of one tool definition for change detection.
 * Same-name registrations that differ only in key order share a signature.
 * @param schema - model-facing schema of the definition.
 * @returns a comparable signature string.
 */
export function toolSignature(schema) {
    return `${schema.name}\u0000${schema.description}\u0000${stableJson(schema.parameters)}`;
}
/**
 * Split the registered definitions into the frozen catalog and tail disclosures.
 * @param definitions - every definition visible to the agent at capture time.
 * @param rules - configured classification rules.
 * @returns inline schemas for the head and configured dynamic schemas.
 */
export function splitCatalog(definitions, rules) {
    const inline = [];
    const dynamic = [];
    for (const definition of definitions) {
        if (classifyTool(definition.name, rules) === 'inline')
            inline.push(definition);
        else
            dynamic.push(definition);
    }
    return { inline, dynamic };
}
const encoder = new TextEncoder();
/**
 * JSON size of one definition as it would be disclosed.
 * @param schema - model-facing schema of the definition.
 * @returns UTF-8 byte length of its JSON encoding.
 */
export function schemaBytes(schema) {
    return encoder.encode(JSON.stringify(schema)).length;
}
