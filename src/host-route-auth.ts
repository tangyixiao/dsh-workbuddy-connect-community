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
    const connection = ctx.get('connection')
    const admission = connection?.admit(req) ?? { rejection: 401 as const }
    const rejection = 'rejection' in admission
      ? admission.rejection
      : admission.peer.principal.kind === 'owner' ? undefined : 403
    if (rejection !== undefined) {
      const payload = JSON.stringify({ error: rejection === 401 ? 'unauthorized' : 'forbidden' })
      res.writeHead(rejection, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
      res.end(payload)
      return
    }
    await handler(req, res)
  }
}
