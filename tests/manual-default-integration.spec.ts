import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as WorkBuddy from '../src/index.ts'
import { ReasoningDefaultStore } from '../src/reasoning-default-store.ts'

let ctx: Context | undefined
let dir: string | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined; vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined })

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
