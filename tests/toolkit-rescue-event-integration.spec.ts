import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { ToolkitHostManager } from '../src/toolkit-host.ts'
import { withToolkitRescueFrame } from '../src/context-rescue-guard.ts'

describe('real host LLM waterfall rescue guard', () => {
  it('intercepts a sibling plugin LLM runtime before foreign adapter dispatch and bounds repeated sends', async () => {
    const ctx = new Context()
    let manager: ToolkitHostManager | undefined
    let dispatches = 0
    try {
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['workbuddy', 'foreign'], {
        providerInfo: (provider: string) => ({ id: provider, name: provider }),
        providerRetryPolicy: () => undefined,
        listModels: async () => [],
        resolveModel: async (_provider: string, model: string) => ({ id: model, name: model }),
        prepareCall: async (provider: string, model: string) => ({ model: { provider, id: model, name: model }, stream: async function* () { dispatches++; yield { type: 'finish', reason: { kind: 'stop' } } } }),
        async *stream() { dispatches++ },
      } as never)
      await ctx.plugin((scope: Context) => { manager = new ToolkitHostManager(scope, []) })
      const plan = { sessionId: 'fixture-session', provider: 'workbuddy' as const, model: 'fixture-model', servingAccount: `cn-${'a'.repeat(32)}`, signal: new AbortController().signal, validate: async () => {} }
      const collect = async (provider: string) => {
        for await (const chunk of ctx.llm.stream({ provider, model: 'fixture-model', messages: [], sessionId: plan.sessionId as never, purpose: 'compaction' as never })) {
          if (chunk.type === 'finish') expect(chunk.reason, JSON.stringify(chunk.reason)).toMatchObject({ kind: 'stop' })
        }
      }
      await expect(withToolkitRescueFrame(plan, async () => collect('foreign'))).rejects.toThrow('rescue-send-target-changed')
      expect(dispatches).toBe(0)
      await withToolkitRescueFrame(plan, async signal => {
        await collect('workbuddy')
        expect(dispatches).toBe(1)
        await expect(collect('workbuddy')).rejects.toThrow('rescue-summary-retry-disabled')
        expect(signal.aborted).toBe(true)
      })
      expect(dispatches).toBe(1)
    } finally { manager?.dispose(); await ctx.fiber.dispose() }
  })
})
