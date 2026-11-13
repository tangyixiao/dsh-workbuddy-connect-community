import { createServer, request, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseToolkitAction, registerToolkitRoute } from '../src/toolkit-route.ts'
import { defaultToolkitSettings } from '../src/toolkit-settings.ts'
import { toolkitPath } from '../src/toolkit-types.ts'
import { WORKBUDDY_VARIANTS } from '../src/variants.ts'

const resources: Array<{ ctx: Context; server: Server }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const { ctx, server } of resources.splice(0)) {
    await ctx.fiber.dispose()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
const id = 'cn-' + 'a'.repeat(32)
async function mount(withConnection = true) {
  const ctx = new Context()
  const routes = new Map<string, WebRoute>()
  ctx.provide('webServer', { register: (route: WebRoute) => { routes.set(route.path, route); return () => routes.delete(route.path) } } as unknown as WebServer)
  let stored: CredentialRecord | undefined
  ctx.provide('credentials', { modifyRecord: async (_key: unknown, mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => { stored = await mutate(stored) ?? stored; return stored } } as unknown as CredentialProvider)
  if (withConnection) await ctx.plugin(Connection)
  let reads = 0; let writes = 0; let failAction = false; let failState = false
  const key = 'fixture-owner-toolkit-key'
  for (const variant of WORKBUDDY_VARIANTS) registerToolkitRoute(ctx, {
    path: toolkitPath(variant.id), key,
    state: async () => { reads += 1; if (failState) throw new Error('private-path-and-token'); return { provider: variant.id, key, account: id, settings: defaultToolkitSettings(), accounts: { revision: 'fixture-revision', mode: 'follow-desktop', accounts: [] }, capabilities: { tools: false, approval: false, context: false, cli: false, media: true, checkin: true } } },
    action: async () => { writes += 1; if (failAction) throw Object.assign(new Error('private-path-and-token'), { code: 'account-selection-changed' }); return { state: 'updated' } },
  })
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url ?? '/', 'http://localhost').pathname)?.handler
    if (handler === undefined) { res.writeHead(404).end(); return }
    void handler(req, res)
  })
  resources.push({ ctx, server })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const origin = `http://127.0.0.1:${port}`
  const login = () => {
    let cookie = ''
    ctx.connection.authorizeIndex({ method: 'GET', url: ctx.connection.authenticatedUrl(origin), headers: { host: `127.0.0.1:${port}` } }, { writeHead: (_status, headers) => { cookie = (headers?.['set-cookie'] ?? headers?.['Set-Cookie'])?.split(';')[0] ?? '' }, end: () => {} })
    return cookie
  }
  const send = (path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; body: string; cache: string | string[] | undefined }>((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host: `127.0.0.1:${port}`, ...(options.method === 'POST' ? { 'content-type': 'application/json' } : {}), ...options.headers } }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), cache: res.headers['cache-control'] }))
    })
    outgoing.on('error', reject); outgoing.end(options.body)
  })
  return { ctx, key, origin, login, send, counts: () => ({ reads, writes }), failAction: () => { failAction = true }, failState: () => { failState = true } }
}

describe('registered owner toolkit route', () => {
  it.each(WORKBUDDY_VARIANTS)('requires a real owner session before exposing state or accepting a leaked key for $id', async variant => {
    const app = await mount()
    const path = toolkitPath(variant.id)
    expect((await app.send(path)).status).toBe(401)
    const anonymousWrite = await app.send(path, { method: 'POST', headers: { 'x-workbuddy-toolkit-key': app.key }, body: JSON.stringify({ action: 'save-account', revision: 'fixture-revision' }) })
    expect(anonymousWrite.status).toBe(401)
    expect(anonymousWrite.body).not.toContain(app.key)
    expect(app.counts()).toEqual({ reads: 0, writes: 0 })
    const owner = await app.send(path, { headers: { cookie: app.login() } })
    expect(owner.status).toBe(200)
    expect(owner.cache).toBe('no-store')
    expect(JSON.parse(owner.body).key).toBe(app.key)
  })
  it('rejects missing Connection and authenticated non-owner principals', async () => {
    const missing = await mount(false)
    expect((await missing.send(toolkitPath('workbuddy'))).status).toBe(401)
    const app = await mount()
    const peer = app.ctx.connection.createPeer({ principal: { kind: 'owner' } })
    vi.spyOn(app.ctx.connection, 'admit').mockReturnValue({ peer: { ...peer, principal: { kind: 'viewer' } } as unknown as typeof peer })
    expect((await app.send(toolkitPath('workbuddy'), { headers: { cookie: app.login() } })).status).toBe(403)
    expect(app.counts()).toEqual({ reads: 0, writes: 0 })
  })
  it('enforces Host, Origin, method and per-action control key before reading any body', async () => {
    const app = await mount(); const path = toolkitPath('workbuddy'); const cookie = app.login()
    for (const headers of [{ host: 'attacker.invalid', cookie }, { origin: 'https://attacker.invalid', cookie }, { origin: 'null', cookie }]) expect((await app.send(path, { headers })).status).toBe(403)
    expect((await app.send(path, { method: 'PUT', headers: { cookie } })).status).toBe(405)
    for (const key of ['', 'wrong-key', app.key + 'x']) {
      expect((await app.send(path, { method: 'POST', headers: { cookie, 'x-workbuddy-toolkit-key': key }, body: '{bad-private-token' })).status).toBe(403)
    }
    expect((await app.send(path, { method: 'POST', headers: { cookie, 'x-workbuddy-toolkit-key': app.key, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect(app.counts()).toEqual({ reads: 0, writes: 0 })
  })
  it('rejects malformed, oversized and open-shaped action bodies without invoking controls', async () => {
    const app = await mount(); const path = toolkitPath('workbuddy'); const headers = { cookie: app.login(), 'x-workbuddy-toolkit-key': app.key }
    for (const body of ['{invalid-private-marker', '[]', JSON.stringify({ action: 'save-account', revision: 'fixture-revision', secret: 'private-marker' }), JSON.stringify({ action: 'select-account', revision: 'fixture-revision', id: 'private-token' })]) {
      const response = await app.send(path, { method: 'POST', headers, body })
      expect(response.status).toBe(400)
      expect(response.body).not.toContain('private')
    }
    const tooLarge = await app.send(path, { method: 'POST', headers, body: 'x'.repeat(16_385) })
    expect(tooLarge.status).toBe(413)
    expect(app.counts()).toEqual({ reads: 0, writes: 0 })
  })
  it('maps stale action and unavailable state to fixed responses without error text', async () => {
    const app = await mount(); const path = toolkitPath('workbuddy'); const cookie = app.login()
    app.failAction()
    const stale = await app.send(path, { method: 'POST', headers: { cookie, 'x-workbuddy-toolkit-key': app.key }, body: JSON.stringify({ action: 'save-account', revision: 'fixture-revision' }) })
    expect(stale).toMatchObject({ status: 409, body: '{"error":"stale-state"}', cache: 'no-store' })
    app.failState()
    const failed = await app.send(path, { headers: { cookie } })
    expect(failed.status).toBe(503)
    expect(failed.body).toBe('{"error":"toolkit-state-unavailable"}')
  })
  it('rejects unknown nested settings and blank labels in the action parser', () => {
    expect(parseToolkitAction({ action: 'update-settings', revision: 'initial', account: id, patch: { features: { surprisePaidFeature: true } } })).toBeUndefined()
    expect(parseToolkitAction({ action: 'update-settings', revision: 'initial', account: id, patch: { secret: 'private-input' } })).toBeUndefined()
    expect(parseToolkitAction({ action: 'rename-account', revision: 'revision', id, label: '   ' })).toBeUndefined()
    expect(parseToolkitAction({ action: 'checkin', revision: 'revision', id })).toBeUndefined()
    expect(parseToolkitAction({ action: 'checkin', revision: 'revision', id, account: id })).toMatchObject({ action: 'checkin', account: id })
  })
})
