import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as WorkBuddy from '../src/index.ts'
import { ReasoningDefaultStore } from '../src/reasoning-default-store.ts'
import { WorkBuddyToolkitRuntime } from '../src/toolkit-runtime.ts'
import { withToolkitRescueFrame } from '../src/context-rescue-guard.ts'

let ctx: Context | undefined
let dir: string | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined })

it('uses the newly selected saved account default without waiting for the identity poll', async () => {
  dir = await mkdtemp(join(tmpdir(), 'wb-manual-default-'))
  vi.stubEnv('DSH_HOME', dir)
  const desktop = join(dir, 'cn.info')
  vi.stubEnv('WORKBUDDY_AUTH_FILE', desktop)
  vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', join(dir, 'absent-ai'))
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture') }))
  const document = (uid: string) => JSON.stringify({ auth: { accessToken: `${uid}-token`, refreshToken: '', expiresAt: Date.now() + 3600000, domain: 'copilot.tencent.com' }, account: { uid } })
  await writeFile(desktop, document('a'))
  const store = new WorkBuddy.WorkBuddyCredentialStore({ variant: WorkBuddy.CN_VARIANT, refresh: async () => { throw new Error('no refresh expected') } })
  const a = await store.saveCurrentAccount()
  await writeFile(desktop, document('b'))
  const b = await store.saveCurrentAccount()
  await store.selectAccount(a.id)
  const row = WorkBuddy.FALLBACK_WORKBUDDY_MODELS.find(model => (model.reasoning?.supportedEfforts?.length ?? 0) > 1)!
  const [first, second] = row.reasoning!.supportedEfforts!
  expect(first).toBeDefined(); expect(second).toBeDefined()
  const defaults = new ReasoningDefaultStore(join(dir, `${WorkBuddy.CN_VARIANT.visibilityFilename}.reasoning-defaults`))
  defaults.set('a:', row.id, first!); defaults.set('b:', row.id, second!)
  ctx = new Context(); await ctx.plugin(LlmRuntime); await ctx.plugin(WorkBuddy, {})
  await vi.waitFor(async () => { expect((await ctx!.llm.listModels('workbuddy')).length).toBeGreaterThan(0) })
  // A missing international sign-in remains a normal empty group.
  expect(await ctx.llm.listModels('workbuddy-ai')).toEqual([])
  const older = await ctx.llm.prepareCall({ provider: 'workbuddy', model: row.id })
  expect(older.config.reasoningEffort).toBe(first)
  await store.selectAccount(b.id)
  const newer = await ctx.llm.prepareCall({ provider: 'workbuddy', model: row.id })
  expect(newer.config.reasoningEffort).toBe(second)
  expect(older.config.reasoningEffort).toBe(first)
})

it('keeps a rescue prepared call on the previewed account while a normal next request consumes rotation', async () => {
  dir = await mkdtemp(join(tmpdir(), 'wb-rescue-routing-'))
  vi.stubEnv('DSH_HOME', dir)
  const desktop = join(dir, 'cn.info')
  vi.stubEnv('WORKBUDDY_AUTH_FILE', desktop)
  vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', join(dir, 'absent-ai'))
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture') }))
  const document = (uid: string) => JSON.stringify({ auth: { accessToken: `${uid}-token`, refreshToken: '', expiresAt: Date.now() + 3600000, domain: 'copilot.tencent.com' }, account: { uid } })
  await writeFile(desktop, document('a'))
  const store = new WorkBuddy.WorkBuddyCredentialStore({ variant: WorkBuddy.CN_VARIANT, refresh: async () => { throw new Error('no fixture refresh expected') } })
  const a = await store.saveCurrentAccount()
  await writeFile(desktop, document('b'))
  const b = await store.saveCurrentAccount()
  await store.selectAccount(a.id)
  const original = WorkBuddyToolkitRuntime.prototype.primary
  let toolkit: WorkBuddyToolkitRuntime | undefined
  vi.spyOn(WorkBuddyToolkitRuntime.prototype, 'primary').mockImplementation(async function (this: WorkBuddyToolkitRuntime) {
    if (this.variant.id === 'workbuddy') toolkit = this
    return original.call(this)
  })
  ctx = new Context(); await ctx.plugin(LlmRuntime); await ctx.plugin(WorkBuddy, {})
  await vi.waitFor(async () => { expect((await ctx!.llm.listModels('workbuddy')).length).toBeGreaterThan(0) })
  await toolkit!.settings.update(a.id, { automation: { rotate: true, members: [b.id], maxSwitches: 1 } }, 'initial')
  await toolkit!.refresh()
  toolkit!.policy.observeFailure('hard_credit', await toolkit!.policy.beginRequest())
  const model = WorkBuddy.FALLBACK_WORKBUDDY_MODELS[0]!.id
  const plan = { sessionId: 'synthetic-rescue-session', provider: 'workbuddy' as const, model, servingAccount: a.id, signal: new AbortController().signal, validate: async () => {} }
  await withToolkitRescueFrame(plan, async () => {
    await ctx!.llm.prepareCall({ provider: 'workbuddy', model })
    expect(toolkit!.policy.decision()).toMatchObject({ state: 'pending', switches: 0, servingAccount: a.id })
    expect((await toolkit!.policy.current())?.uid).toBe('a')
  })
  // A mismatched frame must fail before it can turn the armed rotation into a new account.
  await expect(withToolkitRescueFrame({ ...plan, servingAccount: b.id }, async () => {
    await ctx!.llm.prepareCall({ provider: 'workbuddy', model })
  })).rejects.toThrow()
  expect(toolkit!.policy.decision().switches).toBe(0)
  await expect(withToolkitRescueFrame({ ...plan, model: 'different-preview-model' }, async () => {
    await ctx!.llm.prepareCall({ provider: 'workbuddy', model })
  })).rejects.toThrow()
  expect(toolkit!.policy.decision().switches).toBe(0)
  await ctx.llm.prepareCall({ provider: 'workbuddy', model })
  expect(toolkit!.policy.decision()).toMatchObject({ state: 'serving', switches: 1, servingAccount: b.id })
})
