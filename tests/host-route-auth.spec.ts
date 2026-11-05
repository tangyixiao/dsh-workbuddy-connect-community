import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkBuddyCredentialStore } from '../src/auth.ts'
import { registerWorkBuddyStatusRoute } from '../src/web-status.ts'
import { registerWorkBuddyProbeRoute } from '../src/probe-route.ts'
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
  }
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
  return { origin, login, reads, probe, clear, refresh, contextWindow, visibility }
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
