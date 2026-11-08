import type { Context } from '@deepseek-ai/cordis'
import type { WorkBuddyCreditLog } from './credit-log.ts'
import { withWorkBuddyHostAuth } from './host-route-auth.ts'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'

export interface WorkBuddyCreditRouteOptions {
  path: string
  provider: string
  log: WorkBuddyCreditLog
  account: () => string | undefined
}

/** Register the authenticated read-only route for one provider's observed costs. */
export function registerWorkBuddyCreditRoute(ctx: Context, options: WorkBuddyCreditRouteOptions): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: options.path,
    handler: withWorkBuddyHostAuth(ctx, async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'request-not-trusted' }))
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId')
      const account = options.account()
      if (sessionId === null || sessionId.length === 0 || sessionId.length > 512 || account === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_request' }))
        return
      }
      const body = JSON.stringify(options.log.read(options.provider, account, sessionId))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
    }),
  }))
}
