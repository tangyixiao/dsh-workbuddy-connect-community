/** Structural ports verified against the active DSH 0.2.2-rc.1 tool/approval services. */
export interface ToolkitToolExecution {
  readonly agent: unknown
  readonly signal: AbortSignal
  readonly callId?: string
}

export interface ToolkitToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  readonly timeoutMs?: number
  execute(args: unknown, execution: ToolkitToolExecution): Promise<unknown>
}

export interface ToolkitToolRegistry { register(definition: ToolkitToolDefinition): () => void }
export interface ToolkitApproval {
  request(request: { agent: unknown; toolName: string; callId?: string; reason: string; signal: AbortSignal }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}

/** Fixed diagnostics prevent child-process, credential and host internals leaking to tools. */
export class ToolkitToolError extends Error {
  constructor(readonly code: string) { super(`workbuddy: ${code}`) }
}

export function toolkitThrowIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ToolkitToolError('cancelled')
}

/** Approval is action-specific; a setting enabling a feature is not a grant to execute it. */
export async function requireToolkitApproval(approval: ToolkitApproval | undefined, execution: ToolkitToolExecution, toolName: string, reason: string): Promise<void> {
  toolkitThrowIfCancelled(execution.signal)
  if (approval === undefined) throw new ToolkitToolError('approval-unavailable')
  let outcome: string
  try {
    outcome = await approval.request({ agent: execution.agent, toolName, reason, signal: execution.signal, ...(execution.callId === undefined ? {} : { callId: execution.callId }) })
  } catch {
    toolkitThrowIfCancelled(execution.signal)
    throw new ToolkitToolError('approval-unavailable')
  }
  toolkitThrowIfCancelled(execution.signal)
  if (outcome !== 'allowed-once') throw new ToolkitToolError(`approval-${['rejected', 'cancelled', 'unavailable'].includes(outcome) ? outcome : 'unavailable'}`)
}

/** Raw JSON Schema `{}` is the host's supported arbitrary lossless-JSON output contract. */
export function toolkitJsonOutput(): ToolkitToolDefinition['output'] {
  return { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Reject unknown keys before any side effect, including direct calls bypassing host validation. */
export function toolkitObject(args: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)
    || Object.keys(args).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(args, key))) throw new ToolkitToolError('invalid-input')
  return args as Record<string, unknown>
}

/** Transactional optional-host registration; teardown is idempotent and reverse ordered. */
export function registerToolkitTools(registry: ToolkitToolRegistry, definitions: readonly ToolkitToolDefinition[]): () => void {
  const disposers: Array<() => void> = []
  const dispose = (): void => { for (const release of disposers.splice(0).reverse()) { try { release() } catch { /* Continue disposing sibling contributions. */ } } }
  try { for (const definition of definitions) disposers.push(registry.register(definition)) }
  catch (error) { dispose(); throw error }
  return dispose
}
