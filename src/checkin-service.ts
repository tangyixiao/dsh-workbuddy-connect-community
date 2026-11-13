import type { CheckinAdmissionStore } from './checkin-admission.ts'
import { ToolkitToolError, toolkitObject, toolkitThrowIfCancelled } from './host-tools.ts'
import type { CheckinAccess, CheckinClaim, CheckinStatus, WorkBuddyCheckinClient } from './checkin-client.ts'
import type { MediaScope } from './media-client.ts'
import { regionOf } from './upstream.ts'
import { workbuddySavedAccountId } from './account-store.ts'

export interface CheckinServiceOptions {
  client: WorkBuddyCheckinClient
  admission: CheckinAdmissionStore
  settings(): Promise<{ enabled: boolean, members: readonly string[] }>
  scopes(): Promise<readonly MediaScope[]>
  current(scope: MediaScope): Promise<boolean>
  resolveAccess(scope: MediaScope, signal: AbortSignal): Promise<CheckinAccess>
  intervalMs?: number
}
export type CheckinServiceResult = CheckinClaim | { outcome: 'disabled' | 'not-eligible' | 'already-checked-in' | 'day-unavailable' | 'already-admitted' }

/** Bounded opt-in scheduler; manual action uses the same durable unknown-before-write guard. */
export class WorkBuddyCheckinService {
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller = new AbortController()
  private disposed = false
  private configurationRevision = 0
  private running: Promise<void> | undefined
  private readonly claims = new Map<string, Promise<CheckinServiceResult>>()
  constructor(private readonly options: CheckinServiceOptions) {}
  async query(scope: MediaScope, signal: AbortSignal): Promise<CheckinStatus> {
    const active = AbortSignal.any([signal, this.controller.signal])
    const access = await this.access(scope, active)
    return this.options.client.query(access, active)
  }
  /** Owner route must explicitly invoke manual mode with a fresh opaque nonce; no model credentials. */
  async claim(scope: MediaScope, action: { automatic: boolean, nonce?: string }, signal: AbortSignal): Promise<CheckinServiceResult> {
    const input = toolkitObject(action, ['automatic', 'nonce'], ['automatic'])
    if (typeof input['automatic'] !== 'boolean' || (action.automatic && action.nonce !== undefined)
      || (!action.automatic && (typeof action.nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/u.test(action.nonce)))) throw new ToolkitToolError('invalid-checkin-nonce')
    const key = `${scope.region}:${scope.account}`
    if (this.claims.has(key)) return { outcome: 'already-admitted' }
    const operation = this.performClaim(scope, action, signal)
    this.claims.set(key, operation)
    try { return await operation } finally { this.claims.delete(key) }
  }
  private async performClaim(scope: MediaScope, action: { automatic: boolean, nonce?: string }, signal: AbortSignal): Promise<CheckinServiceResult> {
    if (this.disposed) return { outcome: 'disabled' }
    const config = await this.options.settings()
    if (action.automatic && !config.enabled) return { outcome: 'disabled' }
    if (action.automatic && !config.members.includes(scope.account)) return { outcome: 'not-eligible' }
    const active = AbortSignal.any([signal, this.controller.signal])
    const access = await this.access(scope, active)
    if (access.credential.enterpriseId) return { outcome: 'not-eligible' }
    const status = await this.options.client.query(access, active)
    if (!status.active) return { outcome: 'not-eligible' }
    if (status.todayCheckedIn) return { outcome: 'already-checked-in' }
    // Date UTC is explicitly conservative; no local-day or billing-timezone guess enters admission.
    if (action.automatic && status.serverUtcDay === undefined) return { outcome: 'day-unavailable' }
    const day = status.serverUtcDay
    const nonce = action.nonce
    const admitted = action.automatic
      ? await this.options.admission.admit(scope.account, day!)
      : await this.options.admission.admitManual(scope.account, nonce!)
    if (!admitted) return { outcome: 'already-admitted' }
    let result: CheckinClaim = { outcome: 'unknown' }
    try {
      toolkitThrowIfCancelled(active)
      const latest = await this.options.settings()
      if ((action.automatic && (!latest.enabled || !latest.members.includes(scope.account))) || !await this.options.current(scope)) {
        result = { outcome: 'failed' }
      } else result = await this.options.client.claim(access, active)
    } catch (error) {
      result = { outcome: error instanceof ToolkitToolError && error.code === 'checkin-upstream-rejected' ? 'failed' : 'unknown' }
    }
    // Failure of this completion write leaves the preclaim unknown tombstone intact.
    try {
      if (action.automatic) await this.options.admission.complete(scope.account, day!, result.outcome)
      else await this.options.admission.completeManual(scope.account, nonce!, result.outcome)
    } catch { return { outcome: 'unknown' } }
    return result
  }
  /** Reconfiguration cancels old timers/in-flight work; when disabled it creates neither timer nor request. */
  async configure(): Promise<void> {
    const revision = ++this.configurationRevision
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    this.controller.abort()
    this.controller = new AbortController()
    if (this.disposed || !(await this.options.settings()).enabled || revision !== this.configurationRevision) return
    const delay = Math.max(60_000, Math.min(this.options.intervalMs ?? 15 * 60_000, 24 * 60 * 60_000))
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.tick().catch(() => {}).finally(() => { if (!this.disposed) void this.configure().catch(() => {}) })
    }, delay)
    this.timer.unref?.()
  }
  async tick(): Promise<void> {
    if (this.running !== undefined) return this.running
    const run = async (): Promise<void> => {
      const signal = this.controller.signal
      if (this.disposed || !(await this.options.settings()).enabled) return
      const scopes = (await this.options.scopes()).slice(0, 16)
      for (const scope of scopes) {
        if (this.disposed || signal.aborted || !(await this.options.settings()).enabled) break
        try { await this.claim(scope, { automatic: true }, signal) } catch { /* Fixed status remains unavailable; never retry a write here. */ }
      }
    }
    this.running = run()
    try { await this.running } finally { this.running = undefined }
  }
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.controller.abort()
  }
  private async access(scope: MediaScope, signal: AbortSignal): Promise<CheckinAccess> {
    toolkitThrowIfCancelled(signal)
    if (this.disposed || !await this.options.current(scope)) throw new ToolkitToolError('checkin-account-changed')
    const access = await this.options.resolveAccess(scope, signal)
    toolkitThrowIfCancelled(signal)
    if (!await this.options.current(scope)) throw new ToolkitToolError('checkin-account-changed')
    if (regionOf(access.credential.domain) !== scope.region) throw new ToolkitToolError('checkin-region-mismatch')
    if (workbuddySavedAccountId(scope.region, access.credential) !== scope.account) throw new ToolkitToolError('checkin-account-changed')
    return access
  }
}
