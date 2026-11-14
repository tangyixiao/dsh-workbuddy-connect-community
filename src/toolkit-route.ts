import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'
import { withWorkBuddyHostAuth } from './host-route-auth.ts'
import type { ToolkitAction, ToolkitWebState } from './toolkit-types.ts'

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' })
  res.end(body)
}
const fields = {
  'save-account': ['action', 'revision'], 'follow-desktop': ['action', 'revision'],
  'select-account': ['action', 'revision', 'id'], 'remove-account': ['action', 'revision', 'id'],
  'rename-account': ['action', 'revision', 'id', 'label'],
  'update-settings': ['action', 'revision', 'account', 'patch'], 'checkin': ['action', 'revision', 'id', 'account'],
} as const
function closedPatch(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const patch = value as Record<string, unknown>
  const groups: Record<string, readonly string[]> = { features: ['images', 'videos', 'cli', 'contextRescue'], automation: ['rotate', 'checkin', 'members', 'maxSwitches'], cli: ['workspace', 'model', 'effort', 'timeoutMs', 'maxTurns'] }
  for (const [group, child] of Object.entries(patch)) {
    if (!Object.hasOwn(groups, group) || typeof child !== 'object' || child === null || Array.isArray(child)) return false
    for (const [key, entry] of Object.entries(child)) {
      if (!groups[group]!.includes(key)) return false
      if (group === 'features' || key === 'rotate' || key === 'checkin') { if (typeof entry !== 'boolean') return false }
      else if (key === 'members') { if (!Array.isArray(entry) || entry.length > 16 || !entry.every(id => typeof id === 'string' && /^(cn|global)-[a-f0-9]{32}$/u.test(id)) || new Set(entry).size !== entry.length) return false }
      else if (['maxSwitches', 'timeoutMs', 'maxTurns'].includes(key)) { if (!Number.isSafeInteger(entry) || (entry as number) < 1) return false }
      else if (typeof entry !== 'string' || entry.length > (key === 'workspace' ? 4096 : 128) || /[\u0000-\u001f\u007f]/u.test(entry)) return false
    }
  }
  return true
}
export function parseToolkitAction(value: unknown): ToolkitAction | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const action = record['action']
  if (typeof action !== 'string' || !Object.hasOwn(fields, action)) return undefined
  const keys = fields[action as keyof typeof fields] as readonly string[]
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) return undefined
  if (typeof record['revision'] !== 'string' || record['revision'].length > 80 || !record['revision']) return undefined
  for (const key of ['id', 'account']) if (keys.includes(key) && (typeof record[key] !== 'string' || !/^(cn|global)-[a-f0-9]{32}$/u.test(record[key]))) return undefined
  if (keys.includes('label') && (typeof record['label'] !== 'string' || !record['label'].trim() || record['label'].length > 80 || /[\u0000-\u001f\u007f]/u.test(record['label']))) return undefined
  if (keys.includes('patch') && !closedPatch(record['patch'])) return undefined
  return record as unknown as ToolkitAction
}
export interface ToolkitRouteOptions {
  path: string
  key: string
  state: () => Promise<ToolkitWebState>
  action: (action: ToolkitAction) => Promise<{ state: string }>
}
export function toolkitHandler(deps: ToolkitRouteOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!hostIsLoopback(req.headers.host) || !originIsLoopback(req.headers.origin)) { json(res, 403, { error: 'request-not-trusted' }); return }
    if (req.method === 'GET') {
      try { json(res, 200, await deps.state()) } catch { json(res, 503, { error: 'toolkit-state-unavailable' }) }
      return
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'method-not-allowed' }); return }
    const header = req.headers['x-workbuddy-toolkit-key']
    if (typeof header !== 'string' || Buffer.byteLength(header) !== Buffer.byteLength(deps.key) || !timingSafeEqual(Buffer.from(header), Buffer.from(deps.key))) { json(res, 403, { error: 'invalid-control-key' }); return }
    if (!/^application\/json(?:;|$)/iu.test(req.headers['content-type'] ?? '')) { json(res, 415, { error: 'json-required' }); return }
    const buffers: Buffer[] = []; let total = 0
    try {
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        total += bytes.length
        if (total > 16_384) { json(res, 413, { error: 'body-too-large' }); return }
        buffers.push(bytes)
      }
    } catch { if (!res.destroyed && !res.headersSent) json(res, 400, { error: 'incomplete-body' }); return }
    let action: ToolkitAction | undefined
    try { action = parseToolkitAction(JSON.parse(Buffer.concat(buffers).toString('utf8'))) } catch { /* fixed validation failure */ }
    if (action === undefined) { json(res, 400, { error: 'invalid-action' }); return }
    try { json(res, 200, await deps.action(action)) }
    catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
      json(res, code.endsWith('changed') ? 409 : 400, { error: code.endsWith('changed') ? 'stale-state' : 'action-failed' })
    }
  }
}
export function registerToolkitRoute(ctx: Context, deps: ToolkitRouteOptions): void {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: deps.path, handler: withWorkBuddyHostAuth(ctx, toolkitHandler(deps)) }), 'workbuddy: account and capability controls')
}
