import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'

/** Require the Host's authenticated owner before reading account state or controls. */
export function withWorkBuddyHostAuth(
  ctx: Context,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    // Never cache account state or the control key, including authenticated
    // responses. Missing Connection must never become a loopback-only bypass.
    res.setHeader('Cache-Control', 'no-store')
    const rejection = refusalFor(req, ctx)
    if (rejection !== undefined) {
      const payload = JSON.stringify({ error: rejection === 401 ? 'unauthorized' : 'forbidden' })
      res.writeHead(rejection, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
      res.end(payload)
      return
    }
    await handler(req, res)
  }
}

/** Only synchronous Host approval followed by an owner admission may proceed. */
function refusalFor(req: IncomingMessage, ctx: Context): 401 | 403 | undefined {
  try {
    const connection = ctx.get('connection')
    if (connection == null || typeof connection.requestRejection !== 'function' || typeof connection.admit !== 'function') return 401
    const rejection: unknown = connection.requestRejection(req)
    if (rejection !== undefined) {
      // A broken asynchronous implementation must fail closed without leaving
      // a rejected promise unhandled. The Host contract is synchronous.
      void Promise.resolve(rejection).catch(() => {})
      return rejection === 401 ? 401 : 403
    }
    const admission = connection.admit(req)
    void Promise.resolve(admission).catch(() => {})
    if (admission == null || typeof admission !== 'object' || 'then' in admission) return 403
    if ('rejection' in admission) return admission.rejection === 401 ? 401 : 403
    return admission.peer?.principal?.kind === 'owner' ? undefined : 403
  } catch {
    return 403
  }
}
