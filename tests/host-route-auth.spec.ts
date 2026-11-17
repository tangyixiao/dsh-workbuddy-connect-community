import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkBuddyCredentialStore } from '../src/auth.ts'
import { registerWorkBuddyStatusRoute } from '../src/web-status.ts'
import { registerWorkBuddyProbeRoute } from '../src/probe-route.ts'
import { withWorkBuddyHostAuth } from '../src/host-route-auth.ts'
import { WorkBuddyCreditLog } from '../src/credit-log.ts'
import { registerWorkBuddyCreditRoute } from '../src/credit-route.ts'
import { registerWorkBuddyUpdateRoute } from '../src/update-route.ts'
import { registerToolkitRoute } from '../src/toolkit-route.ts'
import { toolkitPath } from '../src/toolkit-types.ts'
import { WORKBUDDY_VARIANTS } from '../src/variants.ts'

let ctx: Context | undefined
let server: Server | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  await new Promise<void>(resolve => server === undefined ? resolve() : server.close(() => resolve()))
  ctx = undefined
  server = undefined
  vi.restoreAllMocks()
})

// Real Connection signs/verifies test cookies; only persistent storage and
// WorkBuddy operations are doubles. No desktop credentials or paid requests.
async function mount(withConnection = true) {
  ctx = new Context()
  const routes = new Map<string, WebRoute>()
  ctx.provide('webServer', {
    register: (route: WebRoute) => { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  } as WebServer)
  let record: CredentialRecord | undefined
  ctx.provide('credentials', {
    modifyRecord: async (_key: unknown, mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      record = await mutate(record) ?? record
      return record
    },
  } as unknown as CredentialProvider)
  if (withConnection) await ctx.plugin(Connection)
  const reads = vi.fn(async () => ({ state: 'signed-in' as const }))
  const probe = vi.fn(async () => ({ state: 'ok' }))
  const clear = vi.fn()
  const refresh = vi.fn(async () => ({ state: 'refreshed' }))
  const contextWindow = vi.fn(async () => ({ state: 'updated' }))
  const visibility = vi.fn(async () => ({ state: 'updated' }))
  const creditLog = new WorkBuddyCreditLog()
  const creditRead = vi.spyOn(creditLog, 'read')
  for (const variant of WORKBUDDY_VARIANTS) {
    registerWorkBuddyStatusRoute(ctx, {
      path: variant.statusPath,
      store: { status: reads, current: async () => undefined } as unknown as WorkBuddyCredentialStore,
      client: { fetchCredits: vi.fn() }, models: () => [], probeKey: 'test-control-key',
      probe: () => ({ consent: true, running: false, candidates: [], results: [] }),
    })
    registerWorkBuddyProbeRoute(ctx, {
      path: variant.probePath, probe, clear, refresh,
      setMaximumContextWindow: contextWindow, setModelContextWindow: contextWindow, setModelVisibility: visibility,
    }, 'test-control-key')
    registerWorkBuddyCreditRoute(ctx, {
      path: variant.id === 'workbuddy' ? '/plugins/dsh-workbuddy-connect/credits' : '/plugins/dsh-workbuddy-connect/ai/credits',
      provider: variant.id,
      log: creditLog,
      account: () => 'uid:tenant',
    })
  }
  const updateFetch = vi.fn(async () => new Response('{}'))
  const toolkitState = vi.fn(async () => ({}))
  const toolkitAction = vi.fn(async () => ({}))
  registerWorkBuddyUpdateRoute(ctx, { currentVersion: '0.1.22', fetchImpl: updateFetch })
  for (const variant of WORKBUDDY_VARIANTS) registerToolkitRoute(ctx, {
    path: toolkitPath(variant.id), key: 'test-control-key', state: toolkitState as never, action: toolkitAction as never,
  })
  server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url ?? '/', 'http://localhost').pathname)?.handler
    if (handler === undefined) { res.writeHead(404).end(); return }
    void handler(req, res)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  const login = async () => {
    const request = { method: 'GET', url: ctx!.connection.authenticatedUrl(origin), headers: { host: `127.0.0.1:${address.port}` } }
    let cookie = ''
    expect(ctx!.connection.authorizeIndex(request, {
      writeHead: (_status, headers) => { cookie = (headers?.['set-cookie'] ?? headers?.['Set-Cookie'])?.split(';')[0] ?? '' }, end: () => {},
    })).toBe(false)
    expect(cookie).not.toBe('')
    return cookie
  }
  return { origin, login, reads, probe, clear, refresh, contextWindow, visibility, creditRead, routes, updateFetch, toolkitState, toolkitAction }
}

describe('host authentication on registered WorkBuddy routes (index #241)', () => {
  it.each(WORKBUDDY_VARIANTS)('rejects anonymous status and leaked-key controls for $id before any work', async variant => {
    const app = await mount()
    const status = await fetch(app.origin + variant.statusPath)
    expect(status.status).toBe(401)
    expect(await status.text()).not.toContain('test-control-key')
    for (const action of [
      { action: 'probe', model: 'test' }, { action: 'clear' }, { action: 'refresh' },
      { action: 'set-maximum-context-window', enabled: true },
      { action: 'set-model-context-window', model: 'test', account: 'test', window: 200000 },
      { action: 'set-model-visibility', model: 'test', account: 'test', visible: false },
    ]) {
      const response = await fetch(app.origin + variant.probePath, {
        method: 'POST', headers: { 'x-workbuddy-probe-key': 'test-control-key' }, body: JSON.stringify(action),
      })
      expect(response.status).toBe(401)
    }
    for (const operation of [app.reads, app.probe, app.clear, app.refresh, app.contextWindow, app.visibility]) expect(operation).not.toHaveBeenCalled()
  })

  it.each(WORKBUDDY_VARIANTS)('accepts a real signed host cookie and still requires the control key for $id', async variant => {
    const app = await mount()
    const cookie = await app.login()
    const status = await fetch(app.origin + variant.statusPath, { headers: { cookie } })
    expect(status.status).toBe(200)
    expect(status.headers.get('cache-control')).toBe('no-store')
    expect(await status.json()).toMatchObject({ probeKey: 'test-control-key' })
    const post = (key?: string) => fetch(app.origin + variant.probePath, {
      method: 'POST', headers: { cookie, ...(key === undefined ? {} : { 'x-workbuddy-probe-key': key }) },
      body: JSON.stringify({ action: 'probe', model: 'test' }),
    })
    expect((await post()).status).toBe(403)
    expect((await post('test-control-key')).status).toBe(200)
    expect(app.probe).toHaveBeenCalledExactlyOnceWith('test')
    const forged = await fetch(app.origin + variant.statusPath, { headers: { cookie: cookie + 'tampered' } })
    expect(forged.status).toBe(401)
    const crossOrigin = await fetch(app.origin + variant.statusPath, { headers: { cookie, origin: 'https://attacker.invalid' } })
    expect(crossOrigin.status).toBe(403)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 24 * 60 * 60 * 1000)
    expect((await fetch(app.origin + variant.statusPath, { headers: { cookie } })).status).toBe(401)
    expect((await post('test-control-key')).status).toBe(401)
    expect(app.reads).toHaveBeenCalledTimes(1)
    expect(app.probe).toHaveBeenCalledTimes(1)
  })

  it('fails closed when Connection is unavailable', async () => {
    const app = await mount(false)
    for (const variant of WORKBUDDY_VARIANTS) {
      expect((await fetch(app.origin + variant.statusPath)).status).toBe(401)
      expect((await fetch(app.origin + variant.probePath, { method: 'POST', headers: { 'x-workbuddy-probe-key': 'test-control-key' }, body: '{"action":"clear"}' })).status).toBe(401)
    }
    expect(app.reads).not.toHaveBeenCalled()
    expect(app.clear).not.toHaveBeenCalled()
  })

  it('rejects anonymous and non-owner credit reads before looking up session data', async () => {
    const app = await mount()
    const path = '/plugins/dsh-workbuddy-connect/credits?sessionId=secret-session'
    expect((await fetch(app.origin + path)).status).toBe(401)
    expect(app.creditRead).not.toHaveBeenCalled()
    const cookie = await app.login()
    const response = await fetch(app.origin + path, { headers: { cookie } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessionId: 'secret-session', credits: {} })
    expect(app.creditRead).toHaveBeenCalledExactlyOnceWith('workbuddy', 'uid:tenant', 'secret-session')
    expect((await fetch(app.origin + path, { method: 'POST', headers: { cookie } })).status).toBe(405)
    expect((await fetch(app.origin + path, { headers: { cookie, origin: 'https://attacker.invalid' } })).status).toBe(403)
    expect(app.creditRead).toHaveBeenCalledOnce()

    vi.spyOn(ctx!.connection, 'admit').mockReturnValue({ rejection: 403 })
    expect((await fetch(app.origin + path, { headers: { cookie } })).status).toBe(403)
    expect(app.creditRead).toHaveBeenCalledOnce()
  })

  it('refuses an authenticated non-owner Peer', async () => {
    const app = await mount()
    const peer = ctx!.connection.createPeer({ principal: { kind: 'owner' } })
    // Admission is authenticated, but represents another principal. Never
    // authorize arbitrary API Peers to use the desktop account or its credit.
    vi.spyOn(ctx!.connection, 'admit').mockReturnValue({ peer: { ...peer, principal: { kind: 'viewer' } } as unknown as typeof peer })
    expect((await fetch(app.origin + WORKBUDDY_VARIANTS[0]!.statusPath)).status).toBe(403)
    expect((await fetch(app.origin + WORKBUDDY_VARIANTS[0]!.probePath, {
      method: 'POST', headers: { 'x-workbuddy-probe-key': 'test-control-key' }, body: '{"action":"clear"}',
    })).status).toBe(403)
    expect(app.reads).not.toHaveBeenCalled()
    expect(app.clear).not.toHaveBeenCalled()
  })
})


describe('Host policy contract on every registered WorkBuddy HTTP route', () => {
  it('rejects malformed, missing, throwing and asynchronous Host policies before owner admission, body access or work', async () => {
    const app = await mount()
    const policy = vi.spyOn(ctx!.connection, 'requestRejection')
    const owner = vi.spyOn(ctx!.connection, 'admit')
    const bodyRead = vi.fn(() => { throw new Error('must not read body') })
    for (const make of [() => null, () => false, () => 0, () => ({}), () => 200, () => Promise.resolve(undefined), () => Promise.reject(new Error('broken async policy')), () => ({ then: (_ok: unknown, reject: (e: Error) => void) => reject(new Error('broken thenable')) })]) {
      policy.mockImplementation(() => make() as never)
      owner.mockClear()
      for (const route of [...app.routes.values()].filter(route => route.path.startsWith('/plugins/dsh-workbuddy-connect'))) {
        let status = 0
        const req = { method: 'POST', url: route.path, headers: { host: '127.0.0.1:1234' }, on: bodyRead, [Symbol.asyncIterator]: bodyRead } as unknown as IncomingMessage
        const res = { setHeader: vi.fn(), writeHead: (code: number) => { status = code }, end: vi.fn() } as unknown as ServerResponse
        await route.handler(req, res)
        expect(status).toBe(403)
      }
      expect(owner).not.toHaveBeenCalled()
    }
    policy.mockImplementation(() => { throw new Error('broken Host policy') })
    const response = await fetch(app.origin + WORKBUDDY_VARIANTS[0]!.statusPath)
    expect(response.status).toBe(403)
    expect(bodyRead).not.toHaveBeenCalled()
    for (const op of [app.reads, app.probe, app.clear, app.refresh, app.contextWindow, app.visibility, app.creditRead, app.updateFetch, app.toolkitState, app.toolkitAction]) expect(op).not.toHaveBeenCalled()
    await new Promise(resolve => setImmediate(resolve))
  })

  it('fails closed for invalid owner admissions after synchronous Host approval', async () => {
    const app = await mount()
    vi.spyOn(ctx!.connection, 'requestRejection').mockReturnValue(undefined)
    const owner = vi.spyOn(ctx!.connection, 'admit')
    for (const make of [() => undefined, () => null, () => ({}), () => ({ rejection: undefined }), () => ({ rejection: 200 }), () => ({ peer: {} }), () => Promise.reject(new Error('broken owner policy'))]) {
      owner.mockImplementation(() => make() as never)
      expect((await fetch(app.origin + WORKBUDDY_VARIANTS[0]!.statusPath)).status).toBe(403)
    }
    expect(app.reads).not.toHaveBeenCalled()
    await new Promise(resolve => setImmediate(resolve))
  })

  it('authenticates the registered update route before any registry fetch', async () => {
    const app = await mount()
    const path = [...app.routes.keys()].find(path => path.endsWith('/update'))!
    expect(path).toBeDefined()
    expect((await fetch(app.origin + path)).status).toBe(401)
    expect(app.updateFetch).not.toHaveBeenCalled()
    const cookie = await app.login()
    expect((await fetch(app.origin + path, { headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403)
    expect(app.updateFetch).not.toHaveBeenCalled()
    expect((await fetch(app.origin + path, { headers: { cookie } })).status).toBe(200)
    expect(app.updateFetch).toHaveBeenCalled()
  })
})


it('refuses a missing Host method even when an owner-only admission double would allow it', async () => {
  const owner = vi.fn(() => ({ peer: { principal: { kind: 'owner' } } }))
  const work = vi.fn(async () => {})
  for (const connection of [{ admit: owner }, { requestRejection: null, admit: owner }, { requestRejection: () => undefined }, { requestRejection: () => undefined, admit: true }]) {
    let status = 0
    const handler = withWorkBuddyHostAuth({ get: () => connection } as unknown as Context, work)
    await handler({ headers: {} } as IncomingMessage, { setHeader: vi.fn(), writeHead: (value: number) => { status = value }, end: vi.fn() } as unknown as ServerResponse)
    expect(status).toBe(401)
  }
  expect(owner).not.toHaveBeenCalled()
  expect(work).not.toHaveBeenCalled()
})
