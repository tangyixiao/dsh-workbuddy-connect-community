import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { ReasoningDefaultStore } from '../src/reasoning-default-store.ts'
import { createWorkBuddyAdapter } from '../src/adapter.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import type { WorkBuddyCredentialStore } from '../src/auth.ts'
import type { WorkBuddyShim } from '../src/shim.ts'
import { updateModelDefaultEffort } from '../src/reasoning-control.ts'
import { workBuddyWebStatus } from '../src/web-status.ts'

const dirs: string[] = []
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function temp(): string { const dir = mkdtempSync(join(tmpdir(), 'wb-defaults-')); dirs.push(dir); return dir }

describe('saved reasoning defaults', () => {
  it('persists account/model choices, resets independently and rejects unsupported stored values', () => {
    const file = join(temp(), 'defaults.json')
    const store = new ReasoningDefaultStore(file)
    store.set('a', 'one', 'high'); store.set('b', 'one', 'max'); store.set('a', 'two', 'low')
    expect(new ReasoningDefaultStore(file).get('a', 'one')).toBe('high')
    store.set('a', 'one', undefined)
    expect(store.get('a', 'one')).toBeUndefined()
    expect(store.get('b', 'one')).toBe('max')
    expect(store.get('a', 'two')).toBe('low')
    writeFileSync(file, JSON.stringify({ a: { one: 'bogus', two: 'off', three: 'low' }, bad: [] }))
    const reopened = new ReasoningDefaultStore(file)
    expect(reopened.get('a', 'one')).toBeUndefined()
    expect(reopened.get('a', 'two')).toBeUndefined()
    expect(reopened.get('a', 'three')).toBe('low')
    expect(readFileSync(file, 'utf8')).not.toContain('accessToken')
  })
  it('does not apply a choice when its durable write fails', () => {
    const store = new ReasoningDefaultStore(temp())
    expect(() => store.set('a', 'one', 'high')).toThrow()
    expect(store.get('a', 'one')).toBeUndefined()
  })
  it('rejects invalid runtime inputs and isolates region files', () => {
    const dir = temp()
    const cn = new ReasoningDefaultStore(join(dir, 'cn.json'))
    const ai = new ReasoningDefaultStore(join(dir, 'ai.json'))
    expect(() => cn.set('a', 'one', 'bogus' as never)).toThrow()
    expect(() => cn.set('', 'one', 'high')).toThrow()
    cn.set('a', 'one', 'max')
    expect(ai.get('a', 'one')).toBeUndefined()
  })
})

describe('reasoning default dispatch', () => {
  it('captures saved defaults, honors explicit requests and falls back after capabilities change', async () => {
    let selected: 'low' | 'high' | 'max' | undefined = 'high'
    const row = { id: 'model', name: 'Model', contextWindow: 1000, maxTokens: 128, supportsImages: false,
      reasoning: { supports: true, onlyReasoning: true, canDisableThinking: false, supportedEfforts: ['low', 'high', 'max'] as const, defaultEffort: 'low' as const } }
    const catalog = new WorkBuddyCatalog([row])
    const { adapter, invalidate } = createWorkBuddyAdapter({
      catalog, store: {} as WorkBuddyCredentialStore,
      shim: { baseUrl: () => 'http://127.0.0.1:1', token: () => 'test' } as WorkBuddyShim,
      defaultEffort: () => selected,
    })
    const ctx = new Context(); await ctx.plugin(LlmRuntime); ctx.llm.registerAdapter(['workbuddy'], adapter)
    try {
      const older = await ctx.llm.prepareCall({ provider: 'workbuddy', model: 'model' })
      selected = 'max'; invalidate()
      const newer = await ctx.llm.prepareCall({ provider: 'workbuddy', model: 'model' })
      const explicit = await ctx.llm.prepareCall({ provider: 'workbuddy', model: 'model', reasoningEffort: 'low' as never })
      expect(older.config.reasoningEffort).toBe('high')
      expect(newer.config.reasoningEffort).toBe('max')
      expect(explicit.config.reasoningEffort).toBe('low')
      const bodies: Record<string, unknown>[] = []
      vi.stubGlobal('fetch', vi.fn(async (_: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      }))
      for (const call of [older, newer, explicit]) for await (const _ of call.stream({ ...call.config, messages: [] })) {}
      expect(bodies.map(body => body['reasoning_effort'])).toEqual(['high', 'max', 'low'])
      catalog.set([{ ...row, reasoning: { ...row.reasoning, supportedEfforts: ['low'] } }]); invalidate()
      expect((await adapter.resolveModel('workbuddy', 'model')).reasoning?.defaultEffort).toBe('low')
      selected = undefined; invalidate()
      expect((await adapter.resolveModel('workbuddy', 'model')).reasoning?.defaultEffort).toBe('low')
    } finally { await ctx.fiber.dispose() }
  })
})

describe('reasoning control and status use the same capabilities', () => {
  function setup() {
    const model = { id: 'model', name: 'Model', contextWindow: 1000, maxTokens: 128, supportsImages: false,
      reasoning: { supports: true, onlyReasoning: true, canDisableThinking: false, supportedEfforts: ['low', 'high'] as const, defaultEffort: 'low' as const } }
    const store = new ReasoningDefaultStore(join(temp(), 'defaults.json'))
    const invalidate = vi.fn()
    const deps = { currentAccount: async () => 'a', activeAccount: () => 'a', models: () => [model], observe: () => undefined, region: 'cn' as const, store, invalidate }
    return { store, model, deps, invalidate }
  }
  it('refuses stale accounts, unsupported values and missing models without persisting', async () => {
    const { store, deps, invalidate } = setup()
    expect((await updateModelDefaultEffort(deps, 'model', 'high', 'b')).state).toBe('stale-account')
    expect((await updateModelDefaultEffort({ ...deps, currentAccount: async () => 'b' }, 'model', 'high', 'a')).state).toBe('stale-account')
    expect((await updateModelDefaultEffort(deps, 'model', 'max', 'a')).state).toBe('failed')
    expect((await updateModelDefaultEffort(deps, 'gone', 'high', 'a')).state).toBe('failed')
    expect(store.get('a', 'model')).toBeUndefined()
    expect(invalidate).not.toHaveBeenCalled()
  })
  it('exposes the effective choice, retains upstream reset choice and saves/reset without probing', async () => {
    const { store, model, deps } = setup()
    expect((await updateModelDefaultEffort(deps, 'model', 'high', 'a')).state).toBe('updated')
    const statusDeps = { models: () => [model], defaultEffort: (id: string) => store.get('a', id),
      store: { status: async () => ({ state: 'signed-in' }), current: async () => undefined } as unknown as WorkBuddyCredentialStore,
      client: { fetchCredits: vi.fn() } }
    const status = await workBuddyWebStatus(statusDeps)
    expect(status.status).toBe('signed-in')
    if (status.status !== 'signed-in') throw new Error('unexpected status')
    expect(status.models?.[0]).toMatchObject({ availableEfforts: ['low', 'high'], savedDefaultEffort: 'high', upstreamDefaultEffort: 'low', defaultEffort: 'high' })
    expect(statusDeps.client.fetchCredits).not.toHaveBeenCalled()
    expect((await updateModelDefaultEffort(deps, 'model', undefined, 'a')).state).toBe('updated')
    const reset = await workBuddyWebStatus(statusDeps)
    expect(reset.status === 'signed-in' && reset.models?.[0]?.defaultEffort).toBe('low')
  })
})
