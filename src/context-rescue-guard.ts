/** Per-rescue auxiliary-call boundary; never rewrites the shared host summarizer or other sessions. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { ToolkitToolError, toolkitThrowIfCancelled } from './host-tools.ts'

export interface ToolkitRescueFrame {
  readonly sessionId: string
  readonly provider: 'workbuddy' | 'workbuddy-ai'
  readonly model: string
  readonly servingAccount: string
  readonly signal: AbortSignal
  checkScope(provider: string, account: string): Promise<void>
}
export interface ToolkitRescueFramePlan {
  sessionId: string
  provider: 'workbuddy' | 'workbuddy-ai'
  model: string
  servingAccount: string
  signal: AbortSignal
  validate: () => Promise<void>
}
interface ActiveFrame extends ToolkitRescueFrame { sends: number; abort(): void; validate(): Promise<void> }
interface StreamOptions { provider: string; model: string; sessionId?: string; purpose?: string; signal?: AbortSignal }
const storage = new AsyncLocalStorage<ActiveFrame>()
const activeBySession = new Map<string, ActiveFrame>()

export function currentToolkitRescueFrame(): ToolkitRescueFrame | undefined { return storage.getStore() }

export async function withToolkitRescueFrame<T>(plan: ToolkitRescueFramePlan, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  toolkitThrowIfCancelled(plan.signal)
  if (activeBySession.has(plan.sessionId) || activeBySession.size >= 16) throw new ToolkitToolError('rescue-session-busy')
  if (!plan.sessionId || plan.sessionId.length > 256 || !['workbuddy', 'workbuddy-ai'].includes(plan.provider)
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/u.test(plan.model)
    || !(plan.provider === 'workbuddy' ? /^cn-[a-f0-9]{32}$/u : /^global-[a-f0-9]{32}$/u).test(plan.servingAccount)) throw new ToolkitToolError('rescue-host-unavailable')
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, plan.signal])
  const frame: ActiveFrame = {
    sessionId: plan.sessionId, provider: plan.provider, model: plan.model, servingAccount: plan.servingAccount, signal, sends: 0,
    abort: () => { controller.abort() },
    validate: async () => {
      try { toolkitThrowIfCancelled(signal); await plan.validate(); toolkitThrowIfCancelled(signal) }
      catch (error) { controller.abort(); throw error instanceof ToolkitToolError ? error : new ToolkitToolError('rescue-authorization-changed') }
    },
    checkScope: async (provider, account) => {
      toolkitThrowIfCancelled(signal)
      if (provider !== frame.provider || account !== frame.servingAccount) { controller.abort(); throw new ToolkitToolError('rescue-serving-account-changed') }
      await frame.validate()
    },
  }
  activeBySession.set(plan.sessionId, frame)
  try { return await storage.run(frame, () => operation(signal)) }
  finally { controller.abort(); if (activeBySession.get(plan.sessionId) === frame) activeBySession.delete(plan.sessionId) }
}

/** Every host summary/recovery attempt is checked before the lazy adapter is prepared or dispatched. */
export async function* guardToolkitRescueStream<T>(options: StreamOptions, next: () => AsyncIterable<T>): AsyncIterable<T> {
  const frame = storage.getStore() ?? (options.sessionId === undefined ? undefined : activeBySession.get(options.sessionId))
  if (frame === undefined) { yield* next(); return }
  try {
    toolkitThrowIfCancelled(frame.signal)
    if (options.sessionId !== frame.sessionId || options.purpose !== 'compaction' || options.provider !== frame.provider || options.model !== frame.model) throw new ToolkitToolError('rescue-send-target-changed')
    if (frame.sends !== 0) throw new ToolkitToolError('rescue-summary-retry-disabled')
    if (options.signal?.aborted) throw new ToolkitToolError('cancelled')
    // The known summarizer owns this hand-built request. Preserve its checked route
    // and cancellation before any await or later waterfall listener can change them.
    if (options.signal !== frame.signal) {
      if (Object.isFrozen(options)) throw new ToolkitToolError('rescue-send-signal-unavailable')
      const signal = options.signal === undefined ? frame.signal : AbortSignal.any([frame.signal, options.signal])
      try { Object.defineProperty(options, 'signal', { value: signal, enumerable: true, configurable: false, writable: false }) }
      catch { throw new ToolkitToolError('rescue-send-signal-unavailable') }
    }
    Object.freeze(options)
    // Reserve synchronously. A failed validation cannot refund or race this budget.
    frame.sends++
    await frame.validate()
    toolkitThrowIfCancelled(frame.signal)
    const iterator = storage.run(frame, () => next()[Symbol.asyncIterator]())
    let finished = false
    try {
      for (;;) {
        toolkitThrowIfCancelled(frame.signal)
        const step = await storage.run(frame, () => iterator.next())
        if (step.done) { finished = true; break }
        yield step.value
      }
    } finally { if (!finished && iterator.return !== undefined) await storage.run(frame, () => iterator.return!()) }
  } catch (error) {
    // Host recovery hooks must see cancellation and cannot loop on a guard refusal.
    frame.abort()
    throw error instanceof ToolkitToolError ? error : new ToolkitToolError('rescue-send-unavailable')
  }
}
