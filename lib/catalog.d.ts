/**
 * Pure classification and signature helpers for the frozen tool catalog.
 * No Harness imports: these run under the Node type-stripping loader in tests.
 *
 * @module dsh-dynamic-tools/catalog
 */
/** Model-facing tool schema fields this plugin reads without Harness types. */
export interface ToolSchemaLike {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
}
/** How one registered tool name is disclosed. */
export type ToolClass = 'inline' | 'dynamic';
/** Rules that decide which tools belong in the frozen declaration head. */
export interface ClassificationRules {
    /** Exact names that never enter the frozen catalog. */
    readonly dynamicNames: readonly string[];
    /** Name prefixes that never enter the frozen catalog. */
    readonly dynamicPrefixes: readonly string[];
    /** Exact names forced into the catalog, overriding the rules above. */
    readonly inlineNames: readonly string[];
}
/**
 * Decide how one tool name is disclosed.
 * @param name - registered tool name.
 * @param rules - configured classification rules.
 * @returns `inline` for the frozen catalog, `dynamic` for tail disclosure.
 */
export declare function classifyTool(name: string, rules: ClassificationRules): ToolClass;
/**
 * Identity of one tool definition for change detection.
 * Same-name registrations that differ only in key order share a signature.
 * @param schema - model-facing schema of the definition.
 * @returns a comparable signature string.
 */
export declare function toolSignature(schema: ToolSchemaLike): string;
/**
 * Split the registered definitions into the frozen catalog and tail disclosures.
 * @param definitions - every definition visible to the agent at capture time.
 * @param rules - configured classification rules.
 * @returns inline schemas for the head and configured dynamic schemas.
 */
export declare function splitCatalog(definitions: readonly ToolSchemaLike[], rules: ClassificationRules): {
    inline: ToolSchemaLike[];
    dynamic: ToolSchemaLike[];
};
/**
 * Append declared definitions to the frozen catalog, keeping both orders.
 *
 * A name the catalog already declares keeps its catalog position and
 * definition: the head must not move because a tool became loadable.
 *
 * @param catalog - frozen declaration head.
 * @param declared - definitions loaded on demand, in load order.
 * @returns the head followed by every declared name it does not declare.
 */
export declare function extendCatalog(catalog: readonly ToolSchemaLike[], declared: readonly ToolSchemaLike[]): ToolSchemaLike[];
/**
 * JSON size of one definition as it would be disclosed.
 * @param schema - model-facing schema of the definition.
 * @returns UTF-8 byte length of its JSON encoding.
 */
export declare function schemaBytes(schema: ToolSchemaLike): number;
