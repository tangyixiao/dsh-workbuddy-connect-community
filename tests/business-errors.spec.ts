import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkBuddyAdapter, WORKBUDDY_PROVIDER } from '../src/adapter.ts'
import type { WorkBuddyCredential, WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { createWorkBuddyShim, type WorkBuddyShim } from '../src/shim.ts'
import { classifyUpstreamError, WorkBuddyUpstreamClient } from '../src/upstream.ts'

const credential: WorkBuddyCredential = { accessToken: 'fixture', refreshToken: 'fixture', expiresAtMs: 0, domain: 'www.codebuddy.cn', uid: 'fixture', source: 'desktop' }
const shims: WorkBuddyShim[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(shims.splice(0).map(shim => shim.close()))
})

describe('structured business error contract', () => {
  it.each([
    [14003, 'model_busy'], [14018, 'hard_credit'], [11140, 'policy_reject'],
    [6020, 'queue'], [6021, 'queue'], [6022, 'queue'],
  ])('classifies top-level numeric and string code %s before wording/status', (code, kind) => {
    for (const wireCode of [code, String(code)]) {
      expect(classifyUpstreamError(429, JSON.stringify({ code: wireCode, msg: 'quota exceeded; Offline user session not found' }))).toBe(kind)
      expect(classifyUpstreamError(402, JSON.stringify({ code: wireCode }))).toBe(kind)
      expect(classifyUpstreamError(401, JSON.stringify({ code: wireCode }))).toBe('session_dead')
    }
  })

  it('recognises only the channel meaning of 11128', () => {
    expect(classifyUpstreamError(400, JSON.stringify({ code: '11128', msg: 'Illegal API invocation from an unapproved channel' }))).toBe('channel_reject')
    for (const msg of ['conversation id missing', 'first message is not system prompt', 'unknown reason']) {
      expect(classifyUpstreamError(400, JSON.stringify({ code: 11128, msg }))).toBe('client')
    }
  })

  it('ignores nested codes, request ids, malformed code values and bare code text', () => {
    for (const body of [
      { error: { code: 14003 } }, { requestId: '14003-12153-14018' },
      { code: '14003junk' }, { code: 14003.5 }, { code: [14003] }, { code: '1.4003e4' },
      { code: '014003' }, { code: null },
    ]) expect(classifyUpstreamError(400, JSON.stringify(body))).toBe('client')
    expect(classifyUpstreamError(400, 'code=14003')).toBe('client')
    expect(classifyUpstreamError(400, JSON.stringify({ requestId: '12153' }))).toBe('client')
  })

  it('reads business rejection from JSON HTTP 200 without consuming SSE success', async () => {
    const client = new WorkBuddyUpstreamClient()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: '14003', msg: 'busy' }), { headers: { 'Content-Type': 'application/json' } })))
    expect(await client.chatStream(credential, '{}')).toMatchObject({ ok: false, status: 200, kind: 'model_busy' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"code":14003}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })))
    const result = await client.chatStream(credential, '{}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(await result.response.text()).toContain('14003')
  })
})

async function harness(code: number, msg: string, localized: string, status = 403) {
  const catalog = new WorkBuddyCatalog([{ id: 'fixture-model', name: 'Fixture', contextWindow: 8192, maxTokens: 1024, supportsImages: false }])
  let calls = 0
  const shim = createWorkBuddyShim({
    store: { resolve: async () => credential } as WorkBuddyCredentialStore,
    catalog,
    client: { chatStream: async () => {
      calls++
      const message = JSON.stringify({ code, msg, displayMsg: { zh: localized }, token: 'do-not-expose' })
      return { ok: false, status, kind: classifyUpstreamError(status, message), message }
    } },
  })
  shims.push(shim)
  await shim.ready
  return { shim, catalog, calls: () => calls }
}

describe('real shim and installed host error classification', () => {
  it.each([
    [14003, 'busy', 'HTTP 403：模型繁忙，quota exceeded，请稍后重试', 'model_busy', 429, 'RATE_LIMIT'],
    [14018, 'credits exhausted', '积分不足，请充值', 'hard_credit', 402, 'QUOTA'],
    [11140, 'request illegal', 'HTTP 403：内容未通过安全审核', 'policy_reject', 400, 'INVALID_REQUEST'],
    [11128, 'Illegal API invocation from an unapproved channel', 'HTTP 401：请求被拦截', 'channel_reject', 400, 'INVALID_REQUEST'],
    [6020, 'queue rejected', '排队失败，请稍后重试', 'queue', 400, 'INVALID_REQUEST'],
    [6021, 'queue rejected', 'HTTP 429：quota exceeded，队列已满', 'queue', 400, 'INVALID_REQUEST', 429],
    [6022, 'queue rejected', '排队超时', 'queue', 400, 'INVALID_REQUEST'],
    [14003, 'busy', 'HTTP 401：请重新登录', 'session_dead', 401, 'AUTH', 401],
  ])('maps business code %s through real loopback and host', async (code, msg, localized, kind, status, hostCode, upstreamStatus?: number) => {
    const h = await harness(code, msg, localized, upstreamStatus ?? 403)
    const response = await fetch(`${h.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${h.shim.token()}` }, body: '{"model":"fixture-model","messages":[]}',
    })
    expect(response.status).toBe(status)
    expect(response.headers.get('x-should-retry')).toBe(kind === 'session_dead' ? null : 'false')
    const text = await response.text()
    expect(JSON.parse(text).error.type).toBe(kind)
    expect(text.normalize('NFKC')).toContain(localized.normalize('NFKC'))
    expect(text).not.toContain('do-not-expose')
    const { adapter } = createWorkBuddyAdapter({ catalog: h.catalog, store: {} as WorkBuddyCredentialStore, shim: h.shim })
    const call = await adapter.prepareCall(WORKBUDDY_PROVIDER, 'fixture-model')
    const chunks: unknown[] = []
    try {
      for await (const chunk of call.stream({ provider: WORKBUDDY_PROVIDER, model: 'fixture-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }], source: { kind: 'user' } }] } as never)) chunks.push(chunk)
    } catch (error) { throw new Error('Expected an in-band host failure', { cause: error }) }
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', reason: expect.objectContaining({ kind: 'error', failure: expect.objectContaining({ code: hostCode }) }) }))
    expect(h.calls()).toBe(2)
  })
})
