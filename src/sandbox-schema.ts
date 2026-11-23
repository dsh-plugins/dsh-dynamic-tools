import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchemaLike } from './catalog.ts'

const nativeTools = new Set(['bash', 'pwsh', 'write', 'edit', 'apply_patch'])
const fields = new Set(['sandbox_permissions', 'justification'])

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Use the host's effective standing policy, never a tool argument or deployment default. */
export function hasNoWiderSandbox(agent: Agent): boolean {
  const policy = agent.ctx?.get?.('sandboxPolicy') as { resolve?: (input: { session: Agent['session'] }) => { mode?: unknown } } | undefined
  return policy?.resolve?.({ session: agent.session })?.mode === 'danger-full-access'
}

/** Project only the native escalation pair. Native argument validation and dispatch are untouched. */
export function projectSandboxSchema<T extends ToolSchemaLike>(schema: T, noWider: boolean): T {
  if (!noWider || !nativeTools.has(schema.name)) return schema
  const params = schema.parameters
  const props = record(params.properties)
  if (params.type !== 'object' || !props) return schema
  const permission = record(props.sandbox_permissions)
  const reason = record(props.justification)
  const modes = permission?.enum
  if (permission?.type !== 'string' || reason?.type !== 'string' || !Array.isArray(modes) || modes.length === 0
    || !modes.every(mode => mode === 'workspace-write' || mode === 'danger-full-access')
    || typeof permission.description !== 'string' || !permission.description.includes('wider sandbox mode')
    || typeof reason.description !== 'string' || !reason.description.startsWith('Required with sandbox_permissions:')) return schema

  const parameters = {
    ...params,
    properties: Object.fromEntries(Object.entries(props).filter(([name]) => !fields.has(name))),
    ...(Array.isArray(params.required) ? { required: params.required.filter(name => !fields.has(name)) } : {}),
  }
  return { ...schema, parameters }
}

/** Recover the full native schema from the live registration when a saved header contains its reduced form. */
export function projectSavedSandboxSchema<T extends ToolSchemaLike>(saved: T, live: T | undefined, noWider: boolean): T {
  if (noWider || !live || !nativeTools.has(saved.name)) return projectSandboxSchema(saved, noWider)
  const reduced = projectSandboxSchema(live, true)
  if (reduced === live || !saved.parameters.properties) return saved
  const savedProperties = record(saved.parameters.properties)
  const liveProperties = record(live.parameters.properties)
  if (!savedProperties || !liveProperties || 'sandbox_permissions' in savedProperties || 'justification' in savedProperties) return saved
  return { ...saved, parameters: {
    ...saved.parameters,
    properties: { ...savedProperties, sandbox_permissions: liveProperties.sandbox_permissions, justification: liveProperties.justification },
  } }
}
