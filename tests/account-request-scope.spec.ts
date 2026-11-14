import { afterEach, expect, it } from 'vitest'
import { createWorkBuddyAdapter } from '../src/adapter.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { createWorkBuddyShim, type WorkBuddyShim } from '../src/shim.ts'
import type { WorkBuddyCredential, WorkBuddyCredentialStore } from '../src/auth.ts'
import { workBuddyRequestScope } from '../src/account-scope.ts'

let shim: WorkBuddyShim | undefined
afterEach(async () => { await shim?.close(); shim = undefined })

it('keeps same-region domain aliases in the same billing scope', () => {
  const identity = { uid: 'a', enterpriseId: 'enterprise', domain: 'www.codebuddy.cn' }
  expect(workBuddyRequestScope(identity)).toBe(workBuddyRequestScope({ ...identity, domain: 'copilot.tencent.com' }))
  expect(workBuddyRequestScope(identity)).not.toBe(workBuddyRequestScope({ ...identity, domain: 'www.workbuddy.ai' }))
})

it('reconciles the selected account before preparing defaults and refuses an old call after a switch', async () => {
  const a: WorkBuddyCredential = { uid: 'a', accessToken: 'a-token', refreshToken: '', domain: 'copilot.tencent.com', expiresAtMs: Date.now() + 3600000, source: 'desktop' }
  const b = { ...a, uid: 'b', accessToken: 'b-token' }
  let selected = a; let active = a
  const store = { current: async () => selected, resolve: async () => selected } as WorkBuddyCredentialStore
  const catalog = new WorkBuddyCatalog([{ id: 'model', name: 'Model', contextWindow: 1000, maxTokens: 128, supportsImages: false,
    reasoning: { supports: true, onlyReasoning: true, canDisableThinking: false, supportedEfforts: ['low', 'high'] } }])
  const forwarded: string[] = []
  shim = createWorkBuddyShim({ store, catalog, requireAccountScope: true, client: {
    chatStream: async (credential) => {
      forwarded.push(credential.uid)
      return { ok: true, response: new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) }
    },
  } })
  await shim.ready
  const { adapter } = createWorkBuddyAdapter({ store, shim, catalog,
    prepareAccount: async () => { active = await store.current() ?? a; return workBuddyRequestScope(active) },
    defaultEffort: () => active.uid === 'a' ? 'low' : 'high',
  })
  const old = await adapter.prepareCall('workbuddy', 'model')
  expect(old.model.reasoning?.defaultEffort).toBe('low')
  selected = b
  const fresh = await adapter.prepareCall('workbuddy', 'model')
  expect(fresh.model.reasoning?.defaultEffort).toBe('high')
  expect(old.model.reasoning?.defaultEffort).toBe('low')
  for await (const _ of fresh.stream({ provider: 'workbuddy', model: 'model', messages: [] })) {}
  const chunks = []
  for await (const chunk of old.stream({ provider: 'workbuddy', model: 'model', messages: [] })) chunks.push(chunk)
  expect(JSON.stringify(chunks)).toContain('account changed')
  expect(forwarded).toEqual(['b'])
})
