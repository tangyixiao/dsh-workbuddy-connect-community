import type { WorkBuddyCredential } from './auth.ts'
import type { WorkBuddyCredits } from './upstream.ts'
import { ToolkitToolError } from './host-tools.ts'

export interface AccountCreditOverview {
  credits?: WorkBuddyCredits
  /** Time of the last successful refresh; failures never move it forward. */
  refreshedAt?: number
  error?: 'credits-unavailable'
}
export interface AccountOverviewCapture { owner: string; revision: string; controlRevision: string; ids: readonly string[] }
export interface AccountOverviewOptions {
  capture(): Promise<AccountOverviewCapture | undefined>
  resolve(id: string, capture: AccountOverviewCapture): Promise<WorkBuddyCredential>
  current(id: string, credential: WorkBuddyCredential, capture: AccountOverviewCapture): Promise<boolean>
  fetchCredits(credential: WorkBuddyCredential): Promise<WorkBuddyCredits>
  now?(): number
}
function same(a: AccountOverviewCapture | undefined, b: AccountOverviewCapture): boolean {
  return a?.owner === b.owner && a.revision === b.revision && a.controlRevision === b.controlRevision
}
/** Whitelist the existing parsed credit answer; never forward transport/private extension fields. */
function publicCredits(value: WorkBuddyCredits): WorkBuddyCredits {
  const number = (n: number) => { if (!Number.isFinite(n) || n < 0) throw new ToolkitToolError('credits-unavailable'); return n }
  const horizon = (row: NonNullable<WorkBuddyCredits['expiry']>['within24h']) => ({ total: number(row.total), packages: number(row.packages), ...(row.earliestEndTimeMs === undefined ? {} : { earliestEndTimeMs: number(row.earliestEndTimeMs) }) })
  return { total: number(value.total), accounts: value.accounts.slice(0, 100).map(row => ({ packageName: row.packageName.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 160), remain: number(row.remain), size: number(row.size), ...(row.unlimited ? { unlimited: true as const } : {}), ...(row.endTimeMs === undefined ? {} : { endTimeMs: number(row.endTimeMs) }) })),
    ...(value.unlimited ? { unlimited: true as const } : {}), ...(value.cycleResetTime === undefined ? {} : { cycleResetTime: value.cycleResetTime.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 80) }),
    ...(value.expiry === undefined ? {} : { expiry: { within24h: horizon(value.expiry.within24h), within3d: horizon(value.expiry.within3d), within7d: horizon(value.expiry.within7d) } }),
  }
}
/** In-memory owner cache. Only an explicit refresh resolves credentials or calls billing. */
export class WorkBuddyAccountOverview {
  private context: AccountOverviewCapture | undefined
  private rows: Record<string, AccountCreditOverview> = {}
  private pending: Promise<void> = Promise.resolve()
  private disposed = false
  constructor(private readonly options: AccountOverviewOptions) {}
  private reconcile(capture: AccountOverviewCapture | undefined): void {
    if (capture === undefined || this.context === undefined || !same(capture, this.context)) this.rows = {}
    this.context = capture
    for (const id of Object.keys(this.rows)) if (!capture?.ids.includes(id)) delete this.rows[id]
  }
  async read(): Promise<Record<string, AccountCreditOverview>> {
    this.reconcile(this.disposed ? undefined : await this.options.capture())
    return structuredClone(this.rows)
  }
  async refresh(owner: string, revision: string, id?: string): Promise<void> {
    const capture = await this.options.capture()
    if (this.disposed || capture === undefined || capture.owner !== owner || capture.controlRevision !== revision || (id !== undefined && !capture.ids.includes(id))) throw new ToolkitToolError('account-selection-changed')
    const run = async () => {
      if (this.disposed || !same(await this.options.capture(), capture)) return
      this.reconcile(capture)
      const ids = (id === undefined ? capture.ids : [id]).slice(0, 100)
      let index = 0
      const worker = async () => {
        while (index < ids.length) {
          const target = ids[index++]!
          if (this.disposed || !same(await this.options.capture(), capture)) return
          let credential: WorkBuddyCredential | undefined
          let value: AccountCreditOverview
          try {
            credential = await this.options.resolve(target, capture)
            const credits = await this.options.fetchCredits(credential)
            value = { credits: publicCredits(credits), refreshedAt: (this.options.now ?? Date.now)() }
          } catch { value = { ...this.rows[target], error: 'credits-unavailable' } }
          try {
            if (this.disposed || !same(await this.options.capture(), capture) || (credential !== undefined && !await this.options.current(target, credential, capture))) continue
            this.rows[target] = value
          } catch { /* Local revalidation failed: no stale private publication. */ }
        }
      }
      await Promise.all([worker(), worker()])
    }
    // Serialize overlapping owner actions as well as bounding each batch to two workers.
    const operation = this.pending.then(run)
    this.pending = operation.catch(() => {})
    await operation
  }
  dispose(): void { this.disposed = true; this.context = undefined; this.rows = {} }
}
