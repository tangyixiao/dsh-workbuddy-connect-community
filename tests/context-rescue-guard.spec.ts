import { describe, expect, it } from 'vitest'
import { currentToolkitRescueFrame, guardToolkitRescueStream, withToolkitRescueFrame } from '../src/context-rescue-guard.ts'

const account = `cn-${'a'.repeat(32)}`
const plan = () => ({ sessionId: 'session-a', provider: 'workbuddy' as const, model: 'summary-model', servingAccount: account, signal: new AbortController().signal, validate: async () => {} })
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> { const result: T[] = []; for await (const value of stream) result.push(value); return result }
describe('context rescue send boundary', () => {
  it('retains the pinned account through each lazy adapter iteration and cleans the frame afterwards', async () => {
    let iterations = 0
    await withToolkitRescueFrame(plan(), async signal => {
      const results = await collect(guardToolkitRescueStream({ provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction', signal }, async function* () {
        expect(currentToolkitRescueFrame()?.servingAccount).toBe(account)
        await currentToolkitRescueFrame()!.checkScope('workbuddy', account)
        iterations++; yield 'summary'
        await Promise.resolve(); expect(currentToolkitRescueFrame()?.servingAccount).toBe(account)
      }))
      expect(results).toEqual(['summary'])
    })
    expect(iterations).toBe(1); expect(currentToolkitRescueFrame()).toBeUndefined()
  })

  it('aborts foreign targets before adapter dispatch, including a later host recovery attempt', async () => {
    let dispatches = 0
    await withToolkitRescueFrame(plan(), async signal => {
      const next = async function* () { dispatches++; yield 'must not send' }
      await expect(collect(guardToolkitRescueStream({ provider: 'foreign', model: 'other', sessionId: 'session-a', purpose: 'compaction' }, next))).rejects.toThrow('rescue-send-target-changed')
      expect(signal.aborted).toBe(true)
      await expect(collect(guardToolkitRescueStream({ provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction' }, next))).rejects.toThrow('cancelled')
    })
    expect(dispatches).toBe(0)
  })

  it('allows at most one summary send and aborts a recovery loop instead of resubmitting', async () => {
    let dispatches = 0
    await withToolkitRescueFrame(plan(), async signal => {
      const next = async function* () { dispatches++; yield 'summary' }
      const options = { provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction' }
      await collect(guardToolkitRescueStream(options, next))
      await expect(collect(guardToolkitRescueStream(options, next))).rejects.toThrow('rescue-summary-retry-disabled')
      expect(signal.aborted).toBe(true)
    })
    expect(dispatches).toBe(1)
  })

  it('rechecks fresh authorization and refuses a mismatched prepared serving account', async () => {
    await withToolkitRescueFrame(plan(), async signal => {
      await expect(currentToolkitRescueFrame()!.checkScope('workbuddy', `cn-${'b'.repeat(32)}`)).rejects.toThrow('rescue-serving-account-changed')
      expect(signal.aborted).toBe(true)
    })
    let dispatches = 0
    await withToolkitRescueFrame({ ...plan(), validate: async () => { throw new Error('private-scope-diagnostic') } }, async signal => {
      await expect(collect(guardToolkitRescueStream({ provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction' }, async function* () { dispatches++; yield 'no' }))).rejects.toThrow('rescue-authorization-changed')
      expect(signal.aborted).toBe(true)
    })
    expect(dispatches).toBe(0)
  })

  it('does not let a later waterfall listener rewrite the checked auxiliary route', async () => {
    const options = { provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction' }
    await withToolkitRescueFrame(plan(), async () => {
      await collect(guardToolkitRescueStream(options, async function* () {
        expect(() => { options.provider = 'foreign' }).toThrow()
        expect(options.provider).toBe('workbuddy')
        yield 'same target'
      }))
    })
  })

  it('reserves its single send before asynchronous validation so concurrent streams cannot both dispatch', async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    let dispatches = 0
    await withToolkitRescueFrame({ ...plan(), validate: async () => waiting }, async signal => {
      const options = () => ({ provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction' })
      const next = async function* () { dispatches++; yield 'summary' }
      const first = collect(guardToolkitRescueStream(options(), next))
      const second = collect(guardToolkitRescueStream(options(), next))
      const settled = Promise.allSettled([first, second])
      release(); await settled
      expect(dispatches).toBeLessThanOrEqual(1)
      expect(signal.aborted).toBe(true)
    })
  })

  it('locks the validated route before waiting for fresh authorization and links the owned signal', async () => {
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { started = resolve })
    const options = { provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction', signal: new AbortController().signal }
    const routes: string[] = []
    await withToolkitRescueFrame({ ...plan(), validate: async () => { started(); await waiting } }, async signal => {
      const pending = collect(guardToolkitRescueStream(options, async function* () { routes.push(options.provider); expect(options.signal.aborted).toBe(signal.aborted); yield 'summary' }))
      await ready
      try { options.provider = 'foreign' } catch { /* Checked options must already be immutable. */ }
      release(); await pending
      expect(routes).toEqual(['workbuddy'])
      expect(Object.isFrozen(options)).toBe(true)
    })
    expect(options.signal.aborted).toBe(true)
  })

  it('fails closed if a pre-frozen auxiliary request prevents owned cancellation from being bound', async () => {
    let dispatches = 0
    await withToolkitRescueFrame(plan(), async () => {
      const options = Object.freeze({ provider: 'workbuddy', model: 'summary-model', sessionId: 'session-a', purpose: 'compaction', signal: new AbortController().signal })
      await expect(collect(guardToolkitRescueStream(options, async function* () { dispatches++; yield 'no' }))).rejects.toThrow('rescue-send-signal-unavailable')
    })
    expect(dispatches).toBe(0)
  })
})
