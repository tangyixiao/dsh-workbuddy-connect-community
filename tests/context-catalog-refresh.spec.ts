import { afterEach, expect, it, vi } from 'vitest'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'

vi.mock('../src/desktop-context.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/desktop-context.ts')>(),
  readDesktopContextSnapshot: () => undefined,
}))

afterEach(() => vi.unstubAllGlobals())

const credential = { uid: 'context-account', domain: 'www.codebuddy.cn', accessToken: 'test', refreshToken: 'test', expiresAtMs: 0, source: 'desktop' as const }
const cli = { models: [{ id: 'flash', maxInputTokens: 1000000, maxOutputTokens: 128000 }], agents: [{ name: 'cli', models: ['flash'] }] }
const row = { id: 'flash', maxInputTokens: 1000000, contextWindow: { defaultLength: 300000, supportedLengths: [300000, 600000, 1000000] } }

function fixture(product: unknown, failure = false, primary: unknown = cli) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>
    if (String(url).includes('/console/')) return new Response(JSON.stringify({ code: 0, data: { models: [] } }))
    if (headers['User-Agent']?.startsWith('CLI/')) return new Response(JSON.stringify({ code: 0, data: primary }))
    if (failure) throw new Error('desktop config unavailable')
    return new Response(JSON.stringify({ code: 0, data: product }))
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new WorkBuddyUpstreamClient({ resolveChatIdentity: async () => ({ clientVersion: '5.5.6' }) })
  return { client, fetchMock }
}

it('refreshes missing CN tiers when no fresh desktop snapshot is available, retaining the CLI roster', async () => {
  const { client, fetchMock } = fixture({ models: [row, { ...row, id: 'app-only' }] })
  const models = await client.fetchModels(credential)
  expect(models).toHaveLength(1)
  expect(models[0]).toMatchObject({ id: 'flash', contextWindow: 1000000, defaultContextWindow: 300000, supportedContextWindows: [300000, 600000, 1000000] })
  expect(fetchMock.mock.calls).toHaveLength(3)
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/chat/completions'))).toBe(true)
})

it('keeps the CLI budget when the supplementary read fails or its input cap does not match', async () => {
  for (const fail of [false, true]) {
    const { client } = fixture({ models: [{ ...row, maxInputTokens: 2000000 }] }, fail)
    const models = await client.fetchModels(credential)
    expect(models[0]?.contextWindow).toBe(1000000)
    expect(models[0]?.supportedContextWindows).toBeUndefined()
  }
})

it('does not apply personal desktop metadata to an enterprise credential', async () => {
  const { client, fetchMock } = fixture({ models: [row] })
  expect((await client.fetchModels({ ...credential, enterpriseId: 'enterprise' }))[0]?.supportedContextWindows).toBeUndefined()
  expect(fetchMock.mock.calls).toHaveLength(2)
})

it.each([{ supportedLengths: [300000, 1000000] }, { supportedLengths: [1000000] }])('preserves explicit CLI tiers (%j) without a supplementary request', async ({ supportedLengths }) => {
  const { client, fetchMock } = fixture({ models: [row] }, false, { ...cli, models: [{ ...cli.models[0], contextWindow: { supportedLengths } }] })
  expect((await client.fetchModels(credential))[0]?.supportedContextWindows).toEqual(supportedLengths)
  expect(fetchMock.mock.calls).toHaveLength(2)
})
