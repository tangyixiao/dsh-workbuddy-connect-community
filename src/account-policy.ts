/** Consent-bound next-request account selection. Never retries or replays a request. */
import { createHash } from 'node:crypto'
import { WorkBuddyCredentialStore, type WorkBuddyAuthStatus, type WorkBuddyCredential } from './auth.ts'
import { WorkBuddyAccountError, type AccountSnapshot } from './account-store.ts'
import { regionOf, type WorkBuddyRegion } from './upstream.ts'
import { defaultToolkitSettings, type ToolkitSettings } from './toolkit-settings.ts'
import { reasonCodeOf } from './desktop-credential-protection.ts'
import { isWorkBuddySignedOutReasonCode } from './status-paths.ts'

export interface WorkBuddyAccountPolicyOptions {
  base: WorkBuddyCredentialStore
  settings: (primary: WorkBuddyCredential) => ToolkitSettings | Promise<ToolkitSettings>
  region: WorkBuddyRegion
}
export interface AccountPolicyDecision { state: 'disabled' | 'primary' | 'pending' | 'serving' | 'exhausted'; switches: number; servingAccount?: string }
interface Context { snapshot: AccountSnapshot; primary: WorkBuddyCredential; primaryId: string; settings: ToolkitSettings }
function tokenScope(credential: WorkBuddyCredential): string {
  return createHash('sha256').update(JSON.stringify([credential.uid, credential.enterpriseId, credential.domain, credential.accessToken, credential.refreshToken])).digest('hex')
}
export class WorkBuddyAccountPolicy {
  private contextKey = ''
  private enabled = false
  private effectiveId: string | undefined
  private primaryAccountId = ''
  private effectiveTokenScope = ''
  private tried = new Set<string>()
  private switches = 0
  private pending = false
  private exhausted = false
  private serial: Promise<unknown> = Promise.resolve()
  private view: WorkBuddyCredentialStore | undefined
  constructor(private readonly options: WorkBuddyAccountPolicyOptions) {}

  private locked<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation)
    this.serial = result.then(() => undefined, () => undefined)
    return result
  }
  private reset(): void {
    this.enabled = false; this.effectiveId = undefined; this.primaryAccountId = ''; this.effectiveTokenScope = ''
    this.tried.clear(); this.switches = 0; this.pending = false; this.exhausted = false
  }
  private primaryId(credential: WorkBuddyCredential): string { return credential.uid.trim() === '' ? '' : this.options.base.accountId(credential) }
  private async context(): Promise<Context | undefined> {
    const snapshot = await this.options.base.accountSnapshot()
    const primary = snapshot.credential
    if (primary === undefined) { this.contextKey = ''; this.reset(); return undefined }
    if (regionOf(primary.domain) !== this.options.region) throw new WorkBuddyAccountError('account-region-mismatch')
    const primaryId = this.primaryId(primary)
    const settings = primaryId === '' ? defaultToolkitSettings() : await this.options.settings(primary)
    const key = JSON.stringify([primaryId, snapshot.revision, snapshot.selectedId, snapshot.controlRevision, settings.revision])
    if (key !== this.contextKey) {
      this.reset()
      this.contextKey = key
      this.enabled = primaryId !== '' && settings.automation.rotate
      this.tried.add(primaryId)
    }
    this.primaryAccountId = primaryId
    return { snapshot, primary, primaryId, settings }
  }
  private async assertContext(context: Context): Promise<void> {
    const after = await this.options.base.accountSnapshot()
    if (after.revision !== context.snapshot.revision || after.selectedId !== context.snapshot.selectedId
      || after.controlRevision !== context.snapshot.controlRevision || after.credential === undefined
      || this.primaryId(after.credential) !== context.primaryId
      || (context.primaryId !== '' && (await this.options.settings(after.credential)).revision !== context.settings.revision)) {
      this.contextKey = ''; this.reset()
      throw new WorkBuddyAccountError('account-selection-changed')
    }
  }
  private async readEffective(context: Context): Promise<WorkBuddyCredential> {
    return this.enabled && this.effectiveId !== undefined
      ? await this.options.base.currentSavedAccount(this.effectiveId, context.snapshot)
      : context.primary
  }
  /** A status/catalog read does not consume an armed rotation. */
  async current(): Promise<WorkBuddyCredential | undefined> {
    return await this.locked(async () => {
      const context = await this.context()
      if (context === undefined) return undefined
      const credential = await this.readEffective(context)
      await this.assertContext(context)
      return credential
    })
  }
  /** Called before freezing a new independent request's account scope. */
  async beginRequest(): Promise<WorkBuddyCredential> { return await this.resolve() }
  /** Refresh the already chosen account; a prepared in-flight request cannot consume another rotation. */
  async resolveCurrent(): Promise<WorkBuddyCredential> {
    return await this.locked(async () => {
      const context = await this.context()
      if (context === undefined) return await this.options.base.resolve()
      const credential = this.enabled && this.effectiveId !== undefined
        ? await this.options.base.resolveSavedAccount(this.effectiveId, context.snapshot)
        : await this.options.base.resolve()
      await this.assertContext(context)
      this.effectiveTokenScope = tokenScope(credential)
      return credential
    })
  }
  async resolve(): Promise<WorkBuddyCredential> {
    return await this.locked(async () => {
      const context = await this.context()
      if (context === undefined) return await this.options.base.resolve()
      if (this.exhausted) throw new Error('account-rotation-exhausted')
      let credential: WorkBuddyCredential
      if (this.enabled && this.pending) {
        if (this.switches >= context.settings.automation.maxSwitches) { this.exhausted = true; throw new Error('account-rotation-exhausted') }
        let next: string | undefined
        for (const id of context.settings.automation.members) {
          if (this.tried.has(id) || id === context.primaryId) continue
          try {
            const candidate = await this.options.base.currentSavedAccount(id, context.snapshot)
            if (regionOf(candidate.domain) !== this.options.region) continue
            if (candidate.expiresAtMs <= Date.now() + 30_000 && (candidate.refreshToken === '' || (candidate.refreshExpiresAtMs !== undefined && candidate.refreshExpiresAtMs <= Date.now()))) continue
            next = id
            break
          } catch (error) {
            if (error instanceof WorkBuddyAccountError && error.code === 'account-not-found') continue
            throw error
          }
        }
        if (next === undefined) { this.exhausted = true; throw new Error('account-rotation-exhausted') }
        credential = await this.options.base.resolveSavedAccount(next, context.snapshot)
        await this.assertContext(context)
        this.effectiveId = next
        this.tried.add(next)
        this.switches += 1
        this.pending = false
      } else {
        credential = this.enabled && this.effectiveId !== undefined
          ? await this.options.base.resolveSavedAccount(this.effectiveId, context.snapshot)
          : await this.options.base.resolve()
        await this.assertContext(context)
      }
      this.effectiveTokenScope = tokenScope(credential)
      return credential
    })
  }
  /** Observations do no I/O and cannot send another request. Old in-flight failures are ignored. */
  observeFailure(kind: string, credential: WorkBuddyCredential): void {
    if (kind !== 'hard_credit' || !this.enabled || this.exhausted || this.effectiveTokenScope === '' || tokenScope(credential) !== this.effectiveTokenScope) return
    this.pending = true
  }
  decision(): AccountPolicyDecision {
    const serving = this.effectiveId ?? this.primaryAccountId
    return { state: !this.enabled ? 'disabled' : this.exhausted ? 'exhausted' : this.pending ? 'pending' : this.effectiveId === undefined ? 'primary' : 'serving', switches: this.switches,
      ...this.enabled && serving !== '' ? { servingAccount: serving } : {},
    }
  }
  async status(): Promise<WorkBuddyAuthStatus> {
    try {
      const credential = await this.current()
      if (credential === undefined) return { state: 'signed-out', reasonCode: 'no-credential' }
      return {
        state: 'signed-in', expiresAtMs: credential.expiresAtMs, source: credential.source,
        ...credential.nickname === undefined ? {} : { nickname: credential.nickname },
        ...credential.domain === '' ? {} : { domain: credential.domain },
        ...credential.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs: credential.refreshExpiresAtMs },
      }
    } catch (error: unknown) {
      const reasonCode = reasonCodeOf(error)
      return { state: 'signed-out', ...isWorkBuddySignedOutReasonCode(reasonCode) ? { reasonCode } : {} }
    }
  }
  /** Retains base controls/diagnostics; only the effective credential view is overridden. */
  credentialView(): WorkBuddyCredentialStore {
    if (this.view !== undefined) return this.view
    const methods = { current: this.current.bind(this), resolve: this.resolveCurrent.bind(this), status: this.status.bind(this) }
    this.view = new Proxy(this.options.base, {
      get(target, property) {
        if (property === 'current' || property === 'resolve' || property === 'status') return methods[property]
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return this.view
  }
}
