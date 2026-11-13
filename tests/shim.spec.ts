import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { isFetchBlockedPort } from '../src/loopback.ts'
import { createWorkBuddyShim, type ShimLogger, type WorkBuddyShim } from '../src/shim.ts'
import type { WorkBuddyChatResult } from '../src/upstream.ts'

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(CLEANUP.splice(0).map(clean => clean()))
})

interface Harness {
  shim: WorkBuddyShim
  store: WorkBuddyCredentialStore
  upstreamBodies: string[]
  upstreamResponse: () => WorkBuddyChatResult
  /** The signal the shim handed to the upstream call, once it has made one. */
  upstreamSignal: () => AbortSignal | undefined
  /** Every signal handed upstream, in call order. */
  upstreamSignals: AbortSignal[]
}

/**
 * An upstream SSE body that stays open until the test releases it.
 *
 * Cancellation is only observable while the stream is still live: a body that
 * ended immediately would let the response finish for its own reasons, and the
 * assertion could no longer tell "the client hung up" from "the stream was
 * simply over".
 */
function openStream(): { response: Response, release: () => void } {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
  let dead = false
  const encoder = new TextEncoder()
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  return {
    response,
    release: () => {
      if (dead) return
      dead = true
      try {
        controllerRef?.enqueue(encoder.encode('data: [DONE]\n\n'))
        controllerRef?.close()
      } catch { /* already closed or aborted */ }
    },
  }
}

/**
 * Poll until `predicate` holds, or fail after a bounded wait.
 *
 * A disconnect is observed by the HTTP layer asynchronously, so the abort is
 * never synchronously visible to the test that destroyed the socket.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

/** A finite SSE body that completes on its own, for the non-cancel path. */
function finishingStream(): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** Raw HTTP request with full header control (fetch forbids overriding Host). */
function rawRequest(options: {
  port: number
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: options.port,
      method: options.method,
      path: options.path,
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

async function startShim(upstreamResponse: () => WorkBuddyChatResult, logger?: ShimLogger, onCredit?: (responseId: string, credit: number) => void, creditScope?: {
  epoch: () => number
  observe: (responseId: string, credit: number, account: string, epoch: number) => void
}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-shim-'))
  CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
  const desktop = join(dir, 'workbuddy-desktop.info')
  await writeFile(desktop, JSON.stringify({
    auth: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, domain: 'www.codebuddy.cn' },
    account: { uid: 'uid-1' },
  }))
  const store = new WorkBuddyCredentialStore({
    desktopPath: desktop,
    ownPath: join(dir, 'own.json'),
    refresh: async () => ({ accessToken: 'unused' }),
  })
  const harness: Harness = {
    shim: undefined as unknown as WorkBuddyShim,
    store,
    upstreamBodies: [],
    upstreamResponse,
    upstreamSignal: () => signal,
    upstreamSignals: [],
  }
  let signal: AbortSignal | undefined
  harness.shim = createWorkBuddyShim({
    store,
    catalog: new WorkBuddyCatalog(),
    ...(logger === undefined ? {} : { logger }),
    ...(onCredit === undefined ? {} : { onCredit }),
    ...(creditScope === undefined ? {} : {
      creditEpoch: creditScope.epoch,
      onCreditScoped: creditScope.observe,
    }),
    client: {
      async chatStream(_credential, bodyJson, abortSignal): Promise<WorkBuddyChatResult> {
        harness.upstreamBodies.push(bodyJson)
        signal = abortSignal
        if (abortSignal !== undefined) harness.upstreamSignals.push(abortSignal)
        return harness.upstreamResponse()
      },
    },
  })
  await harness.shim.ready
  CLEANUP.push(() => harness.shim.close())
  return harness
}

describe('WorkBuddy shim', () => {
  it('lists the catalog on /v1/models', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/models`, {
      headers: { authorization: `Bearer ${harness.shim.token()}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { id: string }[] }
    const ids = body.data.map(model => model.id)
    expect(ids).toContain('hy3')
    expect(ids).toContain('deepseek-v4-pro')
    // The fallback roster tracks the live `cli` agent's 19 models.
    expect(ids.length).toBe(19)
    expect(ids).toContain('hy4-preview')
    expect(ids).toContain('glm-5.3')
  })

  it('streams a successful chat completion and normalizes the body', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({
        model: 'hy3',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        tool_choice: { type: 'auto' },
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('你好')
    expect(text).toContain('[DONE]')
    expect(harness.upstreamBodies.length).toBe(1)
    const forwarded = JSON.parse(harness.upstreamBodies[0] ?? '') as Record<string, unknown>
    expect(forwarded['stream']).toBe(true)
    expect(forwarded['tool_choice']).toBe('auto')
  })

  it('observes completed SSE credit without changing forwarded bytes', async () => {
    const raw = 'data: {"id":"resp-1","choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"id":"resp-1","usage":{"credit":0}}\n\ndata: [DONE]\n\n'
    const observed: unknown[] = []
    const harness = await startShim(() => ({ ok: true, response: new Response(raw, { headers: { 'Content-Type': 'text/event-stream' } }) }), undefined, (...args) => observed.push(args))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${harness.shim.token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }),
    })
    expect(await response.text()).toBe(raw)
    await waitFor(() => observed.length > 0)
    expect(observed).toEqual([['resp-1', 0]])
  })

  it('discards a completed old-account response after the account changes', async () => {
    let release!: () => void
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"resp-old","usage":{"credit":4}}\n\n'))
        release = () => { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close() }
      },
    })
    const log = new (await import('../src/credit-log.ts')).WorkBuddyCreditLog()
    const scoped = vi.fn((responseId: string, credit: number, account: string, epoch: number) => log.observe(responseId, credit, account, epoch))
    const harness = await startShim(() => ({ ok: true, response: new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }) }), undefined, undefined, {
      epoch: () => log.epoch,
      observe: scoped,
    })
    const pending = fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${harness.shim.token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }),
    })
    await waitFor(() => harness.upstreamSignals.length > 0)
    log.clear() // the account reconciliation epoch advances before completion
    release()
    const response = await pending
    await response.text()
    expect(scoped).not.toHaveBeenCalled()
    expect(log.size).toBe(0)
  })

  it('keeps the request account and epoch when credential resolution finishes after account reconciliation', async () => {
    const raw = 'data: {"id":"response-a","usage":{"credit":9}}\n\ndata: [DONE]\n\n'
    const log = new (await import('../src/credit-log.ts')).WorkBuddyCreditLog()
    const scoped = vi.fn((responseId: string, credit: number, account: string, epoch: number) => {
      log.observe(responseId, credit, account, epoch)
    })
    const harness = await startShim(() => ({ ok: true, response: new Response(raw, { headers: { 'Content-Type': 'text/event-stream' } }) }), undefined, undefined, {
      epoch: () => log.epoch,
      observe: scoped,
    })
    const originalResolve = harness.store.resolve.bind(harness.store)
    let releaseCredential!: (value: Awaited<ReturnType<typeof originalResolve>>) => void
    let enteredResolve!: () => void
    const entered = new Promise<void>(resolve => { enteredResolve = resolve })
    const delayedCredential = new Promise<Awaited<ReturnType<typeof originalResolve>>>(resolve => { releaseCredential = resolve })
    harness.store.resolve = async () => { enteredResolve(); return delayedCredential }

    const request = fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${harness.shim.token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }),
    })
    await entered
    log.clear() // adoptIdentity reconciles account B while A's resolution is pending
    releaseCredential(await originalResolve())
    const response = await request
    await response.text()
    expect(scoped).not.toHaveBeenCalled()
    expect(log.size).toBe(0)
    expect(log.read('workbuddy', 'uid-b:', 'session-b').credits).toEqual({})
  })

  it('passes the credential captured at request start to the scoped credit observer', async () => {
    const raw = 'data: {"id":"response-a","usage":{"credit":9}}\n\ndata: [DONE]\n\n'
    const log = new (await import('../src/credit-log.ts')).WorkBuddyCreditLog()
    const scoped = vi.fn((responseId: string, credit: number, account: string, epoch: number) => log.observe(responseId, credit, account, epoch))
    const harness = await startShim(() => ({ ok: true, response: new Response(raw, { headers: { 'Content-Type': 'text/event-stream' } }) }), undefined, undefined, {
      epoch: () => log.epoch,
      observe: scoped,
    })
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${harness.shim.token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }),
    })
    await response.text()
    expect(scoped).toHaveBeenCalledWith('response-a', 9, 'uid-1:', 0)
    expect(log.observe('response-a', 9, 'uid-b:', 0)).toBe(false)
    expect(log.read('workbuddy', 'uid-b:', 'session-b').credits).toEqual({})
  })

  it.each([
    ['partial event', 'data: {"choices":['],
    ['complete event', 'data: {"choices":[]}\n\n'],
    ['sentinel text in model output', 'data: {"text":"[DONE]"}\n\n'],
  ])('reports an interrupted upstream stream after %s without fabricating completion', async (_label, prefix) => {
    const logs: unknown[][] = []
    const logger: ShimLogger = { warn: (...args) => { logs.push(args) }, error: (...args) => { logs.push(args) } }
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller
        controller.enqueue(new TextEncoder().encode(prefix))
      },
    })
    const harness = await startShim(() => ({
      ok: true,
      response: new Response(responseBody, { headers: { 'Content-Type': 'text/event-stream' } }),
    }), logger)
    const abort = new AbortController()
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
      signal: abort.signal,
    })
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe(prefix)
    upstream!.error(new Error('private-upstream-error-canary'))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const outcome = await Promise.race([
        (async () => {
          try {
            while (!(await reader.read()).done) { /* consume remaining bytes */ }
            return 'completed'
          } catch {
            return 'interrupted'
          }
        })(),
        new Promise<string>(resolve => { timer = setTimeout(() => resolve('hung'), 1200) }),
      ])
      expect(outcome).toBe('interrupted')
      expect(JSON.stringify(logs)).toContain('upstream stream interrupted')
      expect(JSON.stringify(logs)).not.toContain('private-upstream-error-canary')
    } finally {
      clearTimeout(timer)
      abort.abort()
    }
  })

  it('passes a completion sentinel split across chunks without changing the stream', async () => {
    const chunks = ['data: {"choices":[]}\n\n', 'data: [DO', 'NE]\n\n']
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    })
    const harness = await startShim(() => ({ ok: true, response: new Response(responseBody) }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    expect(await response.text()).toBe(chunks.join(''))
  })

  it('does not report a user cancellation as an upstream stream failure', async () => {
    const logs: unknown[][] = []
    const logger: ShimLogger = { warn: (...args) => { logs.push(args) }, error: (...args) => { logs.push(args) } }
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller
        controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
      },
    })
    const harness = await startShim(() => ({ ok: true, response: new Response(responseBody) }), logger)
    const abort = new AbortController()
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
      signal: abort.signal,
    })
    await response.body!.getReader().read()
    abort.abort()
    await waitFor(() => harness.upstreamSignal()?.aborted === true)
    expect(harness.upstreamSignal()?.aborted).toBe(true)
    upstream!.error(new Error('cancelled-by-user'))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(JSON.stringify(logs)).not.toContain('upstream stream interrupted')
    expect(JSON.stringify(logs)).not.toContain('cancelled-by-user')
  })

  it('forwards the reasoning_effort a model picker selection sends', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({
        model: 'glm-5.3',
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'xhigh',
      }),
    })
    expect(response.status).toBe(200)
    const forwarded = JSON.parse(harness.upstreamBodies[0] ?? '') as Record<string, unknown>
    expect(forwarded['reasoning_effort']).toBe('xhigh')
    expect(forwarded['stream']).toBe(true)
  })

  it('maps an upstream credit failure onto HTTP 402', async () => {
    const harness = await startShim(() => ({
      ok: false,
      status: 402,
      kind: 'hard_credit',
      message: '积分不足',
    }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    expect(response.status).toBe(402)
    const body = await response.json() as { error: { type: string, message: string } }
    expect(body.error.type).toBe('hard_credit')
    expect(body.error.message).toContain('积分不足')
  })

  it('aborts the upstream call when the client hangs up mid-stream', async () => {
    // A user pressing Stop must cancel the *upstream* request, not merely stop
    // reading its output: the upstream bills for a generation nobody will see.
    //
    // Regression guard for the listener ordering. `IncomingMessage#close` fires
    // when the *request body* has been consumed, which has already happened by
    // the time the handler awaits the body — so a listener attached to `req`
    // afterwards never fires and the abort never happens. The body here never
    // completes on its own, so the signal can only abort if the disconnect is
    // genuinely observed.
    const stream = openStream()
    const harness = await startShim(() => ({ ok: true, response: stream.response }))
    const port = Number(new URL(harness.shim.baseUrl()).port)

    // Hand-rolled request: the socket must be destroyed mid-stream, which
    // `fetch` does not allow.
    const hungUp = new Promise<void>((resolve) => {
      const req = request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${harness.shim.token()}`,
        },
      }, (res) => {
        res.once('data', () => {
          req.destroy()
          resolve()
        })
      })
      req.on('error', () => {})
      req.end(JSON.stringify({ model: 'hy3', messages: [{ role: 'user', content: 'hi' }] }))
    })
    await hungUp
    await waitFor(() => harness.upstreamSignals.some(signal => signal.aborted))
    stream.release()

    expect(harness.upstreamSignals).toHaveLength(1)
    expect(harness.upstreamSignals[0]?.aborted).toBe(true)
  })

  it('leaves the upstream signal untouched when the stream completes normally', async () => {
    // The mirror image of the test above, and the regression this fix could
    // introduce: `res`'s `close` also fires on ordinary completion. Aborting
    // there would cancel a request that already succeeded — the client would
    // keep its bytes, but any work tied to the signal would be torn down. The
    // guard is `!res.writableEnded`, which this pins.
    const harness = await startShim(() => ({ ok: true, response: finishingStream() }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'hy3', messages: [{ role: 'user', content: 'hi' }] }),
    })
    const text = await response.text()
    // Give the server a turn to run any post-completion `close` handling.
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(response.status).toBe(200)
    expect(text).toContain('[DONE]')
    expect(harness.upstreamSignals).toHaveLength(1)
    expect(harness.upstreamSignals[0]?.aborted).toBe(false)
  })

  it('does not abort an upstream error response that was already written', async () => {
    // The other non-cancel path: an upstream failure is answered in full by
    // `writeOpenAIError`, and its `end()` must not be mistaken for a hang-up.
    const harness = await startShim(() => ({
      ok: false,
      status: 402,
      kind: 'hard_credit',
      message: '积分不足',
    }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    await response.json()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(response.status).toBe(402)
    expect(harness.upstreamSignals[0]?.aborted).toBe(false)
  })

  it('answers unknown routes with 404', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const response = await fetch(`${harness.shim.baseUrl()}/v1/nothing`, {
      headers: { authorization: `Bearer ${harness.shim.token()}` },
    })
    expect(response.status).toBe(404)
  })

  it('binds loopback only', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    expect(harness.shim.baseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('binds a port fetch will connect to', async () => {
    // The OS picks the port, and fetch refuses a handful of the ports it can
    // pick (10080 and friends). Landing on one leaves the shim listening but
    // every pi-ai call failing with `TypeError: fetch failed`.
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    expect(isFetchBlockedPort(port), `shim bound fetch-blocked port ${port}`).toBe(false)
    // And prove it end to end: the same fetch that would have failed connects.
    const response = await fetch(`${harness.shim.baseUrl()}/v1/models`, {
      headers: { authorization: `Bearer ${harness.shim.token()}` },
    })
    expect(response.status).toBe(200)
  })

  it('rejects a non-loopback Host header (DNS rebinding)', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    // A rebinding page resolves evil.com to 127.0.0.1; the browser then sends
    // Host: evil.com:<port>. fetch() forbids overriding Host, so use raw http.
    const res = await rawRequest({
      port,
      method: 'GET',
      path: '/healthz',
      headers: { host: 'evil.com' },
    })
    expect(res.status).toBe(403)
    expect(res.body).toContain('host_not_allowed')
  })

  it('accepts Host with a loopback name plus port', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'GET',
      path: '/healthz',
      headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${harness.shim.token()}` },
    })
    expect(res.status).toBe(200)
  })

  it('rejects a browser Origin from a non-loopback site', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        origin: 'https://evil.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    expect(res.status).toBe(403)
    expect(res.body).toContain('origin_not_allowed')
    // Nothing reached the upstream.
    expect(harness.upstreamBodies).toHaveLength(0)
  })

  it('accepts a loopback browser Origin', async () => {
    const harness = await startShim(() => ({
      ok: true,
      response: new Response('data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        origin: 'http://127.0.0.1:3080',
        'content-type': 'application/json',
        authorization: `Bearer ${harness.shim.token()}`,
      },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    expect(res.status).toBe(200)
  })

  it('rejects a chat POST with a non-JSON Content-Type (simple-request CSRF)', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'text/plain',
        authorization: `Bearer ${harness.shim.token()}`,
      },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    expect(res.status).toBe(415)
    expect(res.body).toContain('unsupported_media_type')
    // Nothing reached the upstream.
    expect(harness.upstreamBodies).toHaveLength(0)
  })

  it('rejects a loopback request without a bearer (local process without the secret)', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    // Everything else about this request is legitimate: loopback Host, no
    // Origin (a local process, not a browser), JSON body. Only the bearer is
    // missing — this is the shape a hostile local process would send.
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    expect(res.status).toBe(401)
    expect(res.body).toContain('unauthorized')
    expect(harness.upstreamBodies).toHaveLength(0)
  })

  it('rejects a loopback request with a wrong bearer', async () => {
    const harness = await startShim(() => ({ ok: false, status: 500, kind: 'server', message: 'unused' }))
    const port = Number(new URL(harness.shim.baseUrl()).port)
    const res = await rawRequest({
      port,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
        authorization: 'Bearer not-the-real-secret',
      },
      body: JSON.stringify({ model: 'hy3', messages: [] }),
    })
    expect(res.status).toBe(401)
    expect(harness.upstreamBodies).toHaveLength(0)
  })
})

describe('error text policy against the host AUTH heuristic (PR #58)', () => {
  /**
   * The host adapter (dsh-llm-pi-ai's classifyPiAiError) treats any error
   * text matching /\b(?:401|403)\b/ as an auth failure and the UI replaces
   * the message with an invalid-API-key banner. This pin mirrors that regex
   * so the texts this shim emits stay compatible with it: business errors
   * must not match, session failures must. If the host ever changes its
   * heuristic, update this mirror with it.
   */
  const HOST_AUTH_HEURISTIC = /\b(?:401|403)\b/u

  async function shimErrorBody(upstream: () => WorkBuddyChatResult, messages: unknown[] = []): Promise<string> {
    const harness = await startShim(upstream)
    const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
      body: JSON.stringify({ model: 'hy3', messages }),
    })
    expect(response.ok).toBe(false)
    return await response.text()
  }

  it('shows a numeric upstream business code without leaking other response fields', async () => {
    const text = await shimErrorBody(() => ({ ok: false, status: 400, kind: 'client', message: JSON.stringify({ code: 11128, msg: 'internal detail', token: 'private-synthetic-token', displayMsg: { zh: '请求被拦截，请重新发送' } }) }))
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toContain('11128')
    expect(body.error.message).toContain('请求被拦截')
    expect(body.error.message).not.toContain('private-synthetic-token')
    expect(body.error.message).not.toContain('internal detail')
  })

  it('distinguishes the known 11128 channel and missing-system categories', async () => {
    for (const [msg, expected] of [
      ['Illegal API invocation from an unapproved channel', 'unapproved-channel'],
      ['first message is not system prompt', 'first-system-missing'],
      ['conversation id missing', 'conversation-id-missing'],
    ]) {
      const text = await shimErrorBody(() => ({ ok: false, status: 400, kind: 'client', message: JSON.stringify({ code: 11128, msg, displayMsg: { zh: '请求被拦截，请重新发送' } }) }))
      const body = JSON.parse(text) as { error: { message: string } }
      expect(body.error.message).toContain(expected)
    }
  })

  it('reports only safe presence of remaining system phrase occurrences for channel blocks', async () => {
    const text = await shimErrorBody(() => ({ ok: false, status: 400, kind: 'client', message: JSON.stringify({ code: 11128, msg: 'Illegal API invocation from an unapproved channel', displayMsg: { zh: '请求被拦截，请重新发送' } }) }), [
      { role: 'system', content: 'Private path C:\\DeepSeek Harness\\folder' },
      { role: 'user', content: 'private user text DeepSeek Harness' },
    ])
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toContain('system-phrase-present yes')
    expect(body.error.message).not.toContain('Private path')
    expect(body.error.message).not.toContain('private user text')
  })

  it('shows the display message of a review rejection without a bare 403', async () => {
    const text = await shimErrorBody(() => ({
      ok: false,
      status: 403,
      kind: 'client',
      message: JSON.stringify({
        code: 11140,
        msg: 'request illegal',
        displayMsg: { zh: '内容未通过安全审核，请调整后重试。', en: 'The content did not pass the safety review.' },
      }),
    }))
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toBe('workbuddy upstream client: 内容未通过安全审核，请调整后重试。')
    expect(HOST_AUTH_HEURISTIC.test(body.error.message)).toBe(false)
  })

  it('falls back to msg and keeps the status note for non-401/403 statuses', async () => {
    const text = await shimErrorBody(() => ({
      ok: false,
      status: 400,
      kind: 'client',
      message: JSON.stringify({ code: 11128, msg: 'Illegal API invocation from an unapproved channel' }),
    }))
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toBe('workbuddy upstream client (http 400): Illegal API invocation from an unapproved channel')
  })

  it('keeps the 401 note for a marked dead session', async () => {
    const text = await shimErrorBody(() => ({
      ok: false,
      status: 401,
      kind: 'session_dead',
      message: 'Offline user session not found',
    }))
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toContain('(http 401)')
    expect(HOST_AUTH_HEURISTIC.test(body.error.message)).toBe(true)
  })

  it('keeps the 401 note for a markerless 401, which classifies as session_dead', async () => {
    const text = await shimErrorBody(() => ({
      ok: false,
      status: 401,
      kind: 'session_dead',
      message: 'unauthorized in some novel wording',
    }))
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toBe('workbuddy upstream session_dead (http 401): unauthorized in some novel wording')
    expect(HOST_AUTH_HEURISTIC.test(body.error.message)).toBe(true)
  })

  it('preserves readable 403 detail without triggering the host AUTH heuristic', async () => {
    const text = await shimErrorBody(() => ({
      ok: false,
      status: 403,
      kind: 'client',
      message: JSON.stringify({ code: 11140, msg: 'request illegal', displayMsg: { zh: 'HTTP 403：访问受限，请稍后重试' } }),
    }))
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toBe('workbuddy upstream client: HTTP ４０３：访问受限，请稍后重试')
    expect(HOST_AUTH_HEURISTIC.test(body.error.message)).toBe(false)
  })

  it('hides the bare 403 from a markerless 403 business error even in raw fallback', async () => {
    const text = await shimErrorBody(() => ({
      ok: false,
      status: 403,
      kind: 'client',
      message: 'plain text refusal without json',
    }))
    const body = JSON.parse(text) as { error: { message: string } }
    expect(body.error.message).toBe('workbuddy upstream client: plain text refusal without json')
    expect(HOST_AUTH_HEURISTIC.test(body.error.message)).toBe(false)
  })
})
