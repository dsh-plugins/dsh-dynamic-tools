/**
 * The message source this plugin records, declared once so every module and the
 * fold agree on it.
 *
 * @module dsh-dynamic-tools/source
 */
/** Message source kind used for every disclosure and loaded definition. */
export const SOURCE_KIND = 'dynamic-tools';
/** 静态加载入口名称，原生接管已有会话时可在历史中补齐。 */
export const TOOL_LOAD_NAME = 'tool_load';
