import { createHash } from 'node:crypto'
import { ToolkitToolError } from './host-tools.ts'
import type { ContextRescueSnapshot } from './context-rescue.ts'

interface SessionPort { id: string; surface: { nodes: readonly number[]; contentGeneration: number; replaceGeneration: number }; requestHeader?: () => unknown }
interface AgentPort { session: SessionPort; status: 'idle' | 'running'; options: { provider?: string; model?: string }; runMaintenance: unknown }
export interface ContextQueryPort {
  observeSession(id: string, options: { signal: AbortSignal; projectionMode: 'all' }): Promise<{ source: 'live' | 'prepared'; header: { id: string }; events: readonly unknown[]; [Symbol.dispose](): void }>
}
export interface CompactionPort { compactNow(agent: unknown, signal: AbortSignal): Promise<unknown>; readonly config?: unknown }
export interface TokenMeterPort { measure(session: unknown): { totalTokens?: number } }

function agentPort(value: unknown): AgentPort {
  const agent = value as Partial<AgentPort> | null
  if (agent === null || typeof agent !== 'object' || typeof agent.session?.id !== 'string' || !agent.session.surface
    || !Array.isArray(agent.session.surface.nodes) || !agent.session.surface.nodes.every(seq => Number.isSafeInteger(seq) && seq >= 0)
    || new Set(agent.session.surface.nodes).size !== agent.session.surface.nodes.length
    || !Number.isSafeInteger(agent.session.surface.contentGeneration) || agent.session.surface.contentGeneration < 0
    || !Number.isSafeInteger(agent.session.surface.replaceGeneration) || agent.session.surface.replaceGeneration < 0
    || typeof agent.options !== 'object' || agent.options === null
    || !['idle', 'running'].includes(String(agent.status)) || typeof agent.runMaintenance !== 'function') throw new ToolkitToolError('rescue-host-unavailable')
  return agent as AgentPort
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
const POLICY_KEYS = ['thresholdRatio', 'headroomTokens', 'retainRatio', 'retainTokens', 'summarizationProvider', 'summarizationModel', 'maxTokens', 'compactionRetries', 'maxOverflowRetries'] as const
const ENGINE_METHODS = ['compactNow', 'compactRegion', 'compactIfNeeded', 'compactPressure', 'summarize', 'regionDependencies']
function boundedString(value: unknown): value is string { return typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value) }
function validPolicy(value: Record<string, unknown>, defaults: boolean): boolean {
  for (const key of ['thresholdRatio', 'retainRatio']) if ((defaults && key === 'thresholdRatio') || value[key] !== undefined) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || Number(value[key]) <= 0 || Number(value[key]) > 1) return false
  }
  if (value['retainTokens'] !== undefined && (!Number.isSafeInteger(value['retainTokens']) || Number(value['retainTokens']) < 0)) return false
  if ((defaults || value['headroomTokens'] !== undefined) && (!Number.isSafeInteger(value['headroomTokens']) || Number(value['headroomTokens']) < 0)) return false
  if ((value['retainTokens'] !== undefined && value['retainRatio'] !== undefined) || (defaults && value['retainTokens'] === undefined && value['retainRatio'] === undefined)) return false
  for (const key of ['maxTokens', 'compactionRetries', 'maxOverflowRetries']) if (defaults || value[key] !== undefined) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < (key === 'maxTokens' ? 1 : 0)) return false
  }
  const provider = value['summarizationProvider']; const model = value['summarizationModel']
  if (!defaults && provider === undefined && model === undefined) return true
  return boundedString(provider) && boundedString(model) && (provider.length === 0) === (model.length === 0)
}
/** Direct known BasicCompactionEngine prototype and frozen resolved policy, not a constructor-name guess. */
function knownConfig(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!record(value)) return undefined
    const prototype = Object.getPrototypeOf(value) as Record<string, unknown> | null
    const constructor = prototype?.['constructor']
    if (prototype === null || typeof constructor !== 'function' || constructor.name !== 'BasicCompactionEngine' || constructor.prototype !== prototype
      || ENGINE_METHODS.some(name => Object.hasOwn(value, name) || typeof Object.getOwnPropertyDescriptor(prototype, name)?.value !== 'function')) return undefined
    const config = Object.getOwnPropertyDescriptor(value, 'config')?.value as unknown
    if (!record(config) || !Object.isFrozen(config) || Object.keys(config).some(key => ![...POLICY_KEYS, 'modelPolicies', 'auto'].includes(key))
      || typeof config['auto'] !== 'boolean' || !validPolicy(config, true) || !Array.isArray(config['modelPolicies'])
      || !Object.isFrozen(config['modelPolicies']) || config['modelPolicies'].length > 512) return undefined
    const seen = new Set<string>()
    for (const policy of config['modelPolicies']) {
      if (!record(policy) || !Object.isFrozen(policy) || Object.keys(policy).some(key => ![...POLICY_KEYS, 'provider', 'model'].includes(key))
        || !boundedString(policy['provider']) || policy['provider'].length === 0 || !boundedString(policy['model']) || policy['model'].length === 0 || !validPolicy(policy, false)) return undefined
      const identity = JSON.stringify([policy['provider'], policy['model']])
      if (seen.has(identity)) return undefined
      seen.add(identity)
    }
    return config
  } catch { return undefined }
}
export function isKnownToolkitCompaction(value: unknown): value is CompactionPort { return knownConfig(value) !== undefined }
function route(agent: AgentPort): { provider?: string; model?: string } {
  let header: unknown
  try { header = agent.session.requestHeader?.() } catch { throw new ToolkitToolError('rescue-host-unavailable') }
  if (header === undefined) return agent.options
  if (!record(header) || !record(header['config']) || typeof header['config']['provider'] !== 'string' || typeof header['config']['model'] !== 'string') throw new ToolkitToolError('rescue-host-unavailable')
  return { provider: header['config']['provider'], model: header['config']['model'] }
}
/** Conversation target used to select the host's exact-model policy. Summary overrides are resolved separately. */
export function toolkitContextProvider(value: unknown): 'workbuddy' | 'workbuddy-ai' {
  const target = route(agentPort(value))
  if (!['workbuddy', 'workbuddy-ai'].includes(target.provider ?? '') || !target.model) throw new ToolkitToolError('rescue-provider-unavailable')
  return target.provider as 'workbuddy' | 'workbuddy-ai'
}
function summarySelection(value: unknown, compaction: CompactionPort | undefined) {
  const agent = agentPort(value)
  const conversationProvider = toolkitContextProvider(agent)
  const conversation = route(agent)
  const config = knownConfig(compaction)
  if (config === undefined) throw new ToolkitToolError('rescue-host-unavailable')
  const override = (config['modelPolicies'] as Record<string, unknown>[]).find(policy => policy['provider'] === conversation.provider && policy['model'] === conversation.model)
  // Empty exact-model pairs clear a global override: the host uses ??, never ||.
  const configuredProvider = override?.['summarizationProvider'] ?? config['summarizationProvider']
  const configuredModel = override?.['summarizationModel'] ?? config['summarizationModel']
  const provider = configuredProvider === '' ? conversation.provider : configuredProvider
  const model = configuredProvider === '' ? conversation.model : configuredModel
  if (provider !== conversationProvider || typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(model)) throw new ToolkitToolError('rescue-summary-target-unavailable')
  return {
    target: { provider: conversationProvider, model },
    policy: {
      defaults: POLICY_KEYS.map(key => config[key]),
      override: override === undefined ? null : POLICY_KEYS.map(key => override[key]),
    },
  }
}
export function resolveToolkitSummaryTarget(value: unknown, compaction: CompactionPort | undefined): { provider: 'workbuddy' | 'workbuddy-ai'; model: string } {
  return summarySelection(value, compaction).target
}
/** Model-visible content/routing only: command/approval audit entries cannot invalidate their own apply. */
export function contextContentRevision(value: unknown, compaction?: CompactionPort): string {
  const agent = agentPort(value)
  const routed = route(agent)
  return createHash('sha256').update(JSON.stringify([agent.session.id, agent.session.surface.nodes, agent.session.surface.contentGeneration,
    agent.session.surface.replaceGeneration, agent.options.provider, agent.options.model, routed.provider, routed.model,
    compaction === undefined ? null : summarySelection(agent, compaction)])).digest('hex')
}
export async function readToolkitContext(value: unknown, query: ContextQueryPort | undefined, meter: TokenMeterPort | undefined, signal: AbortSignal, compaction?: CompactionPort): Promise<ContextRescueSnapshot> {
  if (query === undefined || signal.aborted) throw new ToolkitToolError('rescue-host-unavailable')
  const agent = agentPort(value)
  const summaryTarget = resolveToolkitSummaryTarget(agent, compaction)
  const revision = contextContentRevision(agent, compaction)
  let lease: Awaited<ReturnType<ContextQueryPort['observeSession']>> | undefined
  try {
    lease = await query.observeSession(agent.session.id, { signal, projectionMode: 'all' })
    if (lease?.source !== 'live' || lease.header?.id !== agent.session.id || typeof lease[Symbol.dispose] !== 'function') throw new ToolkitToolError('rescue-host-unavailable')
    if (signal.aborted || contextContentRevision(agent, compaction) !== revision) throw new ToolkitToolError('rescue-preview-changed')
    const events = lease.events
    if (!Array.isArray(events)) throw new ToolkitToolError('rescue-host-unavailable')
    if (events.length > 20_000) throw new ToolkitToolError('rescue-export-too-large')
    let bytes = 0
    for (const event of events) { bytes += Buffer.byteLength(JSON.stringify(event)); if (bytes > 4_000_000) throw new ToolkitToolError('rescue-export-too-large') }
    let estimatedTokens: number | undefined
    try { estimatedTokens = meter?.measure(agent.session).totalTokens } catch { /* token estimate is optional evidence */ }
    const copied = structuredClone(events)
    if (signal.aborted || contextContentRevision(agent, compaction) !== revision) throw new ToolkitToolError('rescue-preview-changed')
    return { sessionId: agent.session.id, revision, idle: agent.status === 'idle', events: copied, surfaceNodes: [...agent.session.surface.nodes], summaryTarget,
      ...(estimatedTokens === undefined || !Number.isFinite(estimatedTokens) || estimatedTokens < 0 ? {} : { estimatedTokens }),
    }
  } catch (error) { throw error instanceof ToolkitToolError ? error : new ToolkitToolError('rescue-host-unavailable') }
  finally { try { if (typeof lease?.[Symbol.dispose] === 'function') lease[Symbol.dispose]() } catch { throw new ToolkitToolError('rescue-host-unavailable') } }
}
/** No await between revision/idle validation and the host's synchronous maintenance entry. */
export function applyToolkitContext(value: unknown, compaction: CompactionPort | undefined, signal: AbortSignal, expected: ContextRescueSnapshot): Promise<unknown> {
  const agent = agentPort(value)
  if (compaction === undefined) throw new ToolkitToolError('rescue-host-unavailable')
  if (signal.aborted) throw new ToolkitToolError('cancelled')
  if (agent.status !== 'idle') throw new ToolkitToolError('rescue-session-busy')
  const target = resolveToolkitSummaryTarget(agent, compaction)
  if (agent.session.id !== expected.sessionId || contextContentRevision(agent, compaction) !== expected.revision
    || expected.summaryTarget?.provider !== target.provider || expected.summaryTarget.model !== target.model) throw new ToolkitToolError('rescue-preview-changed')
  return compaction.compactNow(value, signal)
}
