/**
 * Loopback OpenAI-compatible endpoint. The pi-ai provider points here; the
 * shim applies the WorkBuddy wire quirks (forced streaming, string
 * `tool_choice`, CLI-shaped headers) and forwards to the real upstream.
 * It binds 127.0.0.1 only and never serves another interface.
 *
 * Inbound hardening: the loopback bind alone is not a trust boundary (any
 * local process or a DNS-rebinding page can reach 127.0.0.1), so every
 * request must carry a loopback Host header, browser-sent Origins must be
 * loopback, chat POSTs must be application/json, and the Authorization
 * header must carry the shim's per-process shared secret. The plugin's
 * own client satisfies all four by construction; local attackers cannot
 * read the secret out of the plugin process's memory.
 *
 * @module dsh-workbuddy-connect/shim
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { WorkBuddyCredentialStore } from './auth.ts'
import type { WorkBuddyCatalog } from './catalog.ts'
import { bindToUsablePort, hostIsLoopback, originIsLoopback } from './loopback.ts'
import { extractDisplayErrorMessage, prepareChatBody, upstreamBusinessCode, WorkBuddyUpstreamClient, type UpstreamErrorKind } from './upstream.ts'
import { WorkBuddyCreditSseObserver } from './credit-log.ts'
import { WORKBUDDY_ACCOUNT_SCOPE_HEADER, workBuddyRequestScope } from './account-scope.ts'

/** Minimal logger surface the plugin context already provides. */
export interface ShimLogger {
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** What the plugin needs from a running shim. */
export interface WorkBuddyShim {
  /** Resolves once the listener is up; rejects if listening failed. */
  ready: Promise<void>
  /** The shim origin, e.g. `http://127.0.0.1:39271`; valid after ready. */
  baseUrl(): string
  /**
   * The per-process shared secret the plugin's own client must carry as
   * `Authorization: Bearer <token>`. Lives only in memory; the adapter
   * resolves this instead of the upstream access token, because the shim
   * resolves the real credential itself via the store.
   */
  token(): string
  /** Stop serving and destroy open connections. */
  close(): Promise<void>
}

/** Constructor dependencies. */
export interface WorkBuddyShimOptions {
  store: WorkBuddyCredentialStore
  client: Pick<WorkBuddyUpstreamClient, 'chatStream'>
  catalog: WorkBuddyCatalog
  logger?: ShimLogger
  /** Real host adapters bind prepared settings to the resolved billing account. */
  requireAccountScope?: boolean
  /** Receives only a completed upstream response's observed credit. */
  onCredit?: (responseId: string, credit: number) => void
  /** Captures request account scope and an epoch shared with host reconciliation. */
  onCreditScoped?: (responseId: string, credit: number, account: string, epoch: number) => void
  creditEpoch?: () => number
}

const REQUEST_BODY_LIMIT = 64 * 1024 * 1024

/** Chat-completion POSTs must carry a JSON body type (simple-request CSRF drops here). */
function isJsonContentType(req: IncomingMessage): boolean {
  const type = req.headers['content-type']
  return typeof type === 'string' && type.trim().toLowerCase().startsWith('application/json')
}

/** HTTP status each upstream failure class surfaces as. */
const KIND_STATUS: Readonly<Record<UpstreamErrorKind, number>> = {
  hard_credit: 402,
  model_busy: 429,
  policy_reject: 400,
  channel_reject: 400,
  queue: 400,
  soft_rate: 429,
  session_dead: 401,
  not_found: 502,
  server: 502,
  client: 400,
}

/**
 * The installed host scans text before using the mapped HTTP status: bare
 * 401/403 means AUTH and quota wording wins over rate limits. Fullwidth forms
 * retain readable upstream detail without overriding an explicit business code.
 * NFKC normalization recovers the original text for diagnostic comparison.
 */
function businessDisplayDetail(detail: string, kind: UpstreamErrorKind): string {
  if (kind === 'session_dead') return detail
  const fullwidth = (text: string): string => text.replace(/[!-~]/gu, char => String.fromCharCode(char.charCodeAt(0) + 0xfee0))
  let safe = detail.replace(/\b(?:401|403)\b/gu, fullwidth)
  if (kind === 'model_busy' || kind === 'policy_reject' || kind === 'channel_reject' || kind === 'queue') {
    safe = safe.replace(/\b(?:quota|balance|credits?|budget|usage)\b/giu, fullwidth)
    if (kind !== 'model_busy') safe = safe.replace(/\b429\b|rate.?limit/giu, fullwidth)
  }
  return safe
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function writeOpenAIError(res: ServerResponse, status: number, kind: string, message: string): void {
  writeJson(res, status, { error: { message, type: kind, code: kind } })
}

/** Read a request body with a size cap; over-limit bodies fail the request. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > REQUEST_BODY_LIMIT) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Start the loopback endpoint. Requests carry any bearer; the loopback bind
 * is the boundary, and the upstream credential comes from the store alone.
 */
export function createWorkBuddyShim(options: WorkBuddyShimOptions): WorkBuddyShim {
  const { store, client, catalog } = options
  const logger = options.logger
  let accountIdentity: string | undefined
  let accountGeneration = 0
  const identifyAccount = (credential: { uid: string; enterpriseId?: string }): number => {
    const identity = `${credential.uid}:${credential.enterpriseId ?? ''}`
    if (accountIdentity !== identity) {
      accountIdentity = identity
      accountGeneration++
    }
    return accountGeneration
  }

  // Per-process shared secret. Lives only in memory; the adapter resolves it
  // as the OpenAI apiKey, which pi-ai sends as `Authorization: Bearer ...`.
  // The shim never forwards it upstream — the real credential comes from the
  // store. A local attacker who can hit the port still cannot forge this.
  const SHARED_SECRET = randomBytes(32).toString('base64url')

  /** Constant-time bearer check; absent or mismatched bearers are rejected. */
  function bearerOk(req: IncomingMessage): boolean {
    const header = req.headers.authorization
    if (typeof header !== 'string') return false
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match === null) return false
    const presented = match[1] as string
    const expected = SHARED_SECRET
    const a = Buffer.from(presented)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res)
  })

  // Bind an ephemeral port fetch will actually connect to: the OS can hand out
  // one of the fetch standard's blocked ports, and every pi-ai call would then
  // fail with `TypeError: fetch failed` against a listener that is otherwise up.
  const ready: Promise<void> = bindToUsablePort(server, {
    host: '127.0.0.1',
    onBlockedPort: (port, attempt) => {
      logger?.warn(`dsh-workbuddy-connect: port ${port} is blocked for fetch; rebinding (attempt ${attempt})`)
    },
  }).then(() => undefined)

  const baseUrl = (): string => {
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('workbuddy shim has no listening address')
    }
    return `http://127.0.0.1:${address.port}`
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Inbound hardening: every request must name the loopback host, and
      // browser-sent origins must be loopback too. The plugin's own client
      // always satisfies both; DNS-rebinding pages and cross-origin POSTs
      // do not.
      if (!hostIsLoopback(req.headers.host)) {
        writeOpenAIError(res, 403, 'host_not_allowed', 'Host header must name the loopback interface')
        return
      }
      if (!originIsLoopback(req.headers.origin)) {
        writeOpenAIError(res, 403, 'origin_not_allowed', 'Origin must be a loopback origin')
        return
      }
      if (!bearerOk(req)) {
        writeOpenAIError(res, 401, 'unauthorized', 'missing or invalid Authorization bearer')
        return
      }
      const url = req.url ?? '/'
      if (req.method === 'GET' && (url === '/healthz' || url === '/healthz/')) {
        writeJson(res, 200, { ok: true })
        return
      }
      if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
        writeJson(res, 200, {
          object: 'list',
          data: catalog.current().map(model => ({
            id: model.id,
            object: 'model',
            created: 0,
            owned_by: 'workbuddy',
          })),
        })
        return
      }
      if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
        await chatCompletions(req, res)
        return
      }
      writeOpenAIError(res, 404, 'not_found', `no such route: ${req.method} ${url}`)
    } catch {
      if (!res.headersSent) {
        writeOpenAIError(res, 500, 'internal', 'WorkBuddy request failed internally')
      } else {
        res.end()
      }
    }
  }

  async function chatCompletions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The host advances this shared epoch during account reconciliation. Read
    // it before any asynchronous body or credential work can cross a switch.
    const epochAtRequestStart = options.creditEpoch?.()
    if (!isJsonContentType(req)) {
      writeOpenAIError(res, 415, 'unsupported_media_type', 'Content-Type must be application/json')
      return
    }
    let credential
    try {
      credential = await store.resolve()
    } catch {
      writeOpenAIError(res, 401, 'not_signed_in', 'WorkBuddy credentials are unavailable; sign in again')
      return
    }
    const requestAccount = `${credential.uid}:${credential.enterpriseId ?? ''}`
    if (options.requireAccountScope && req.headers[WORKBUDDY_ACCOUNT_SCOPE_HEADER] !== workBuddyRequestScope(credential)) {
      res.setHeader('x-should-retry', 'false')
      writeOpenAIError(res, 400, 'account_changed', 'WorkBuddy account changed; refresh the model list and send again')
      return
    }
    const requestGeneration = epochAtRequestStart ?? identifyAccount(credential)

    // The client's disconnect must reach the upstream request, or "Stop" only
    // stops the stream being *read* here: the upstream keeps generating and
    // billing for a reply nobody will see.
    //
    // The listener has to go on `res`, not `req`. `req`'s `close` fires when
    // the *request body* is finished, and by this point `readBody` has already
    // consumed it — so attaching to `req` after the await installs a listener
    // on an event that has already fired, and the abort never happens.
    // `res`'s `close` fires when the response can no longer be written. On a
    // normal completion the stream has already ended the response
    // (`writableEnded`), so only a close *before* that means the peer hung up;
    // aborting on the normal path would cancel a request that already
    // succeeded. The `req` listener covers the early window, where a peer
    // disconnects mid-body and `readBody` rejects before any response exists;
    // abort() is idempotent, so both paths may fire.
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    // Two independent guards keep the normal path from aborting itself, and
    // both are kept on purpose: `finish` detaches the listener before the
    // trailing `close`, and `writableEnded` covers the ordering where `close`
    // arrives first. Either alone is sufficient today (removing just the
    // `writableEnded` check leaves the suite green), which is exactly why the
    // pair is documented rather than trimmed — the guarantee must not depend
    // on an event order Node has not promised.
    const abortIfUnfinished = (): void => {
      if (!res.writableEnded) controller.abort()
    }
    req.once('aborted', abort)
    res.on('close', abortIfUnfinished)
    // Drop the response listener once the pipe is done either way, so a
    // long-lived keep-alive socket does not accumulate them.
    res.once('finish', () => res.off('close', abortIfUnfinished))

    const raw = (await readBody(req)).toString('utf8')
    const prepared = prepareChatBody(raw)
    const result = await client.chatStream(credential, prepared, controller.signal)

    if (!result.ok) {
      const detail = businessDisplayDetail(extractDisplayErrorMessage(result.message) ?? result.message.slice(0, 400), result.kind)
      // The localized block message is shared by several failures. Preserve
      // only the numeric business code, not the upstream response or msg.
      let businessCode = ''
      if (detail.includes('请求被拦截')) {
        try {
          const response = JSON.parse(result.message) as { code?: unknown; msg?: unknown }
          const code = upstreamBusinessCode(result.message)
          if (code !== undefined && code >= 10000 && code <= 99999) {
            const knownReasons: Record<string, string> = {
              'illegal api invocation from an unapproved channel': 'unapproved-channel',
              'first message is not system prompt': 'first-system-missing',
              'conversation id missing': 'conversation-id-missing',
            }
            const reason = code === 11128 && typeof response.msg === 'string' ? knownReasons[response.msg.trim().toLowerCase()] : undefined
            let systemPhrase = ''
            if (reason === 'unapproved-channel') {
              const request = JSON.parse(prepared) as { messages?: Array<{ role?: unknown; content?: unknown }> }
              const containsPhrase = (Array.isArray(request.messages) ? request.messages : []).some(message => {
                if (message?.role !== 'system') return false
                const content = message.content
                if (typeof content === 'string') return /DeepSeek Harness/iu.test(content)
                return Array.isArray(content) && content.some(block => typeof block?.text === 'string' && /DeepSeek Harness/iu.test(block.text))
              })
              systemPhrase = `; system-phrase-present ${containsPhrase ? 'yes' : 'no'}`
            }
            businessCode = ` [upstream code ${code}${reason === undefined ? '' : `; reason ${reason}`}${systemPhrase}]`
          }
        } catch { /* non-JSON errors have no safe business code */ }
      }
      const businessFailure = ['model_busy', 'hard_credit', 'policy_reject', 'channel_reject', 'queue'].includes(result.kind)
      // Explicit business classifications use the mapped status; an upstream
      // 429 or 403 must not mask a deterministic policy/channel/queue refusal.
      const status = businessFailure ? KIND_STATUS[result.kind] : result.status
      const statusNote = (status === 401 || status === 403) && result.kind !== 'session_dead'
        ? ''
        : ` (http ${status})`
      // The bundled OpenAI SDK honors this header. Avoid transport-level
      // replays; the user/host recovery flow owns any later retry decision.
      if (businessFailure) res.setHeader('x-should-retry', 'false')
      const quotaHint = result.kind === 'hard_credit' ? ' (insufficient credits)' : ''
      writeOpenAIError(
        res,
        KIND_STATUS[result.kind],
        result.kind,
        `workbuddy upstream ${result.kind}${statusNote}${quotaHint}: ${detail}${businessCode}`,
      )
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const body = Readable.fromWeb(result.response.body as Parameters<typeof Readable.fromWeb>[0])
    const creditObserver = options.onCredit === undefined && options.onCreditScoped === undefined
      ? undefined
      : new WorkBuddyCreditSseObserver()
    if (creditObserver !== undefined) {
      body.on('data', (chunk: Buffer | Uint8Array) => creditObserver.push(chunk))
      body.once('end', () => {
        const currentGeneration = options.creditEpoch?.() ?? accountGeneration
        if (currentGeneration !== requestGeneration) return
        const observed = creditObserver.finish()
        if (observed === undefined) return
        options.onCreditScoped?.(observed.responseId, observed.credit, requestAccount, requestGeneration)
        options.onCredit?.(observed.responseId, observed.credit)
      })
    }
    body.on('error', () => {
      // An interrupted upstream response is not a successful completion. In
      // particular, appending a synthetic sentinel can join a partial SSE
      // event or silently turn a truncated reply into a successful one.
      // Do not include the error object: it may contain response data or URLs.
      if (!controller.signal.aborted) logger?.warn('dsh-workbuddy-connect: upstream stream interrupted')
      if (!res.destroyed && !res.writableEnded) res.destroy()
    })
    body.pipe(res)
  }

  return {
    ready,
    baseUrl,
    token: () => SHARED_SECRET,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(() => resolve())
      server.closeAllConnections()
      server.once('error', reject)
    }),
  }
}
