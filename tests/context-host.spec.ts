import { describe, expect, it, vi } from 'vitest'
import { applyToolkitContext, contextContentRevision, readToolkitContext, toolkitContextProvider, resolveToolkitSummaryTarget, isKnownToolkitCompaction } from '../src/context-host.ts'

class BasicCompactionEngine {
  config: Readonly<Record<string, unknown>>
  readonly calls: unknown[] = []
  constructor(values: Record<string, unknown> = {}) { this.config = Object.freeze({ thresholdRatio: 0.8, headroomTokens: 65536, retainRatio: 0.16, summarizationProvider: '', summarizationModel: '', maxTokens: 65536, compactionRetries: 1, maxOverflowRetries: 1, auto: true, modelPolicies: Object.freeze([]), ...values }) }
  summarize() {} compactRegion() {} compactIfNeeded() {} compactPressure() {} regionDependencies() {}
  async compactNow(value: unknown): Promise<null> { this.calls.push(value); return null }
}

function agent() {
  let provider = 'workbuddy'
  return { status: 'idle', options: { provider: 'workbuddy', model: 'hy4-preview' }, runMaintenance() {}, session: { id: 'session-a', surface: { nodes: [0], contentGeneration: 0, replaceGeneration: 0 }, requestHeader: () => ({ config: { provider, model: 'hy4-preview' } }) }, route: (next: string) => { provider = next } }
}
function query(events: readonly unknown[] = [{ seq: 0, type: 'user/message', data: 'original' }]) {
  const dispose = vi.fn()
  return { dispose, events, port: { observeSession: vi.fn(async () => ({ source: 'live' as const, header: { id: 'session-a' }, cursor: 0, events, [Symbol.dispose]: dispose })) } }
}
describe('active host context adapter', () => {
  it('exports an independent bounded live observation and always releases its lease', async () => {
    const q = query(); const a = agent()
    const snapshot = await readToolkitContext(a, q.port, { measure: () => ({ totalTokens: 42 }) }, new AbortController().signal, new BasicCompactionEngine())
    expect(snapshot.events).toEqual([{ seq: 0, type: 'user/message', data: 'original' }])
    expect(snapshot.events).not.toBe(q.events)
    expect(snapshot.estimatedTokens).toBe(42); expect(q.dispose).toHaveBeenCalledTimes(1)
  })

  it('binds durable request routing as well as selected options and surface content', async () => {
    const a = agent(); const before = contextContentRevision(a)
    a.route('workbuddy-ai')
    expect(contextContentRevision(a)).not.toBe(before)
    expect(toolkitContextProvider(a)).toBe('workbuddy-ai')
    a.route('unrelated-provider')
    expect(() => toolkitContextProvider(a)).toThrow('rescue-provider-unavailable')
  })

  it('rejects changed routing, prepared or wrong-session observations and disposes each lease', async () => {
    const a = agent(); const q = query()
    q.port.observeSession.mockImplementationOnce(async () => { a.route('workbuddy-ai'); return { source: 'live', header: { id: 'session-a' }, cursor: 0, events: [], [Symbol.dispose]: q.dispose } })
    await expect(readToolkitContext(a, q.port, undefined, new AbortController().signal, new BasicCompactionEngine())).rejects.toThrow('rescue-preview-changed')
    expect(q.dispose).toHaveBeenCalledTimes(1)
    const wrong = { observeSession: async () => ({ source: 'prepared' as const, header: { id: 'other' }, cursor: 0, events: [], [Symbol.dispose]: q.dispose }) }
    await expect(readToolkitContext(a, wrong, undefined, new AbortController().signal, new BasicCompactionEngine())).rejects.toThrow('rescue-host-unavailable')
    expect(q.dispose).toHaveBeenCalledTimes(2)
  })

  it('refuses oversized observations and enters host maintenance synchronously only for the exact idle revision', async () => {
    const a = agent(); const q = query(Array.from({ length: 20_001 }, () => ({})))
    const engine = new BasicCompactionEngine()
    await expect(readToolkitContext(a, q.port, undefined, new AbortController().signal, engine)).rejects.toThrow('rescue-export-too-large')
    expect(q.dispose).toHaveBeenCalledTimes(1)
    const expected = { sessionId: a.session.id, revision: contextContentRevision(a, engine), idle: true, events: [], surfaceNodes: [0], summaryTarget: resolveToolkitSummaryTarget(a, engine) }
    const signal = new AbortController().signal
    const pending = applyToolkitContext(a, engine, signal, expected)
    expect(engine.calls).toHaveLength(1); await pending
    a.session.surface.contentGeneration++
    expect(() => applyToolkitContext(a, engine, signal, expected)).toThrow('rescue-preview-changed')
    a.status = 'running'
    expect(() => applyToolkitContext(a, engine, signal, expected)).toThrow('rescue-session-busy')
  })

  it('rejects explicit or model-policy summary providers outside the routed WorkBuddy product', () => {
    const a = agent()
    for (const provider of ['third-party', 'workbuddy-ai']) {
      expect(() => resolveToolkitSummaryTarget(a, new BasicCompactionEngine({ summarizationProvider: provider, summarizationModel: 'summary-model' }))).toThrow('rescue-summary-target-unavailable')
      expect(() => resolveToolkitSummaryTarget(a, new BasicCompactionEngine({ modelPolicies: Object.freeze([Object.freeze({ provider: 'workbuddy', model: 'hy4-preview', summarizationProvider: provider, summarizationModel: 'summary-model' })]) }))).toThrow('rescue-summary-target-unavailable')
    }
  })

  it('honors empty exact-policy overrides and exposes the effective same-provider summary model', () => {
    const a = agent()
    const engine = new BasicCompactionEngine({ summarizationProvider: 'third-party', summarizationModel: 'global-summary', modelPolicies: Object.freeze([Object.freeze({ provider: 'workbuddy', model: 'hy4-preview', summarizationProvider: '', summarizationModel: '' })]) })
    expect(resolveToolkitSummaryTarget(a, engine)).toEqual({ provider: 'workbuddy', model: 'hy4-preview' })
    expect(resolveToolkitSummaryTarget(a, new BasicCompactionEngine({ summarizationProvider: 'workbuddy', summarizationModel: 'other-summary-model' }))).toEqual({ provider: 'workbuddy', model: 'other-summary-model' })
  })

  it('fails closed for unknown or overridden engines and binds policy changes into the apply revision', async () => {
    const a = agent(); const engine = new BasicCompactionEngine()
    expect(isKnownToolkitCompaction(engine)).toBe(true)
    expect(isKnownToolkitCompaction({ compactNow() {}, config: engine.config, constructor: { name: 'BasicCompactionEngine' } })).toBe(false)
    class CustomEngine extends BasicCompactionEngine {}
    expect(isKnownToolkitCompaction(new CustomEngine())).toBe(false)
    const q = query(); const signal = new AbortController().signal
    const snapshot = await readToolkitContext(a, q.port, undefined, signal, engine)
    expect(snapshot.summaryTarget).toEqual({ provider: 'workbuddy', model: 'hy4-preview' })
    engine.config = Object.freeze({ ...engine.config, summarizationProvider: 'workbuddy', summarizationModel: 'changed-after-preview' })
    expect(() => applyToolkitContext(a, engine, signal, snapshot)).toThrow('rescue-preview-changed')
    expect(engine.calls).toHaveLength(0)
  })
})
