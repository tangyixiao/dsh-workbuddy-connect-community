import { existsSync, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkBuddyCredential, WorkBuddyCredentialStore } from './auth.ts'
import type { WorkBuddyVariant } from './variants.ts'
import type { WorkBuddyUpstreamClient } from './upstream.ts'
import { workbuddyVisibilityPath } from './visibility-store.ts'
import { WorkBuddyAccountPolicy } from './account-policy.ts'
import { ToolkitSettingsStore, type ToolkitSettings } from './toolkit-settings.ts'
import { CheckinAdmissionStore } from './checkin-admission.ts'
import { WorkBuddyCheckinClient } from './checkin-client.ts'
import { WorkBuddyCheckinService } from './checkin-service.ts'
import { WorkBuddyMediaClient, type MediaAccess, type MediaModel, type MediaRequest, type MediaScope } from './media-client.ts'
import { MediaTaskStore } from './media-task-store.ts'
import { WorkBuddyMediaService, createMediaTools, type MediaToolOptions } from './media-tools.ts'
import { createCodeBuddyTools } from './codebuddy-tools.ts'
import { ToolkitToolError, type ToolkitApproval, type ToolkitToolDefinition } from './host-tools.ts'
import type { ToolkitAction, ToolkitWebState } from './toolkit-types.ts'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'

export interface ToolkitCapabilities { tools: boolean; approval: boolean; context: boolean }
function sameScope(a: MediaScope | undefined, b: MediaScope): boolean { return a?.account === b.account && a.region === b.region && a.revision === b.revision }
function executable(name: string): string | undefined {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const file = join(dir.replace(/^"|"$/gu, ''), `${name}${process.platform === 'win32' ? '.exe' : ''}`)
    try { if (existsSync(file)) return realpathSync(file) } catch { /* next supported local path */ }
  }
  return undefined
}
export function codeBuddyInstallation(): { nodeExecutable: string; cliEntry: string } | undefined {
  const nodeExecutable = executable('node')
  if (nodeExecutable === undefined) return undefined
  const paths = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  const candidates = paths.flatMap(dir => [join(dir, 'node_modules/@tencent-ai/codebuddy-code/bin/codebuddy'), join(dir, '../lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy')])
  for (const file of candidates) { try { if (existsSync(file)) return { nodeExecutable, cliEntry: realpathSync(file) } } catch { /* next */ } }
  return undefined
}

/** One region's owner state and effect services; primary consent and serving identity stay separate. */
export class WorkBuddyToolkitRuntime {
  readonly settings: ToolkitSettingsStore
  readonly policy: WorkBuddyAccountPolicy
  readonly view: WorkBuddyCredentialStore
  readonly media: WorkBuddyMediaService
  readonly checkin: WorkBuddyCheckinService
  cached: ToolkitSettings | undefined
  owner: string | undefined
  onChange: () => void = () => {}
  private key = ''
  private refreshRun: Promise<void> | undefined
  private approval: ToolkitApproval | undefined
  private capabilities: ToolkitCapabilities = { tools: false, approval: false, context: false }
  private stopped = false
  private readonly lifetime = new AbortController()
  private cliLifetime = new AbortController()
  private readonly mediaOptions: MediaToolOptions
  private lastCheckin: { owner: string; value: NonNullable<ToolkitWebState['checkin']> } | undefined
  private models: { account: string; at: number; rows: MediaModel[] } | undefined
  constructor(readonly base: WorkBuddyCredentialStore, readonly variant: WorkBuddyVariant, private readonly client: WorkBuddyUpstreamClient) {
    const statePath = workbuddyVisibilityPath(`${variant.visibilityFilename}.toolkit`)
    this.settings = new ToolkitSettingsStore(statePath, variant.region)
    this.policy = new WorkBuddyAccountPolicy({ base, region: variant.region, settings: primary => this.settings.get(base.accountId(primary)) })
    this.view = this.policy.credentialView()
    const approval: ToolkitApproval = { request: request => this.approval?.request(request) ?? Promise.resolve('unavailable') }
    this.mediaOptions = {
      tasks: new MediaTaskStore(`${statePath}.media`), client: new WorkBuddyMediaClient(),
      scope: () => this.scope(), enabled: async (kind, scope) => sameScope(await this.scope(), scope) && (await this.primary())?.config.features[kind === 'image' ? 'images' : 'videos'] === true,
      resolveAccess: (scope, request, signal) => this.mediaAccess(scope, request, signal), approval,
      prefix: variant.region === 'cn' ? 'workbuddy_cn' : 'workbuddy_ai',
    }
    this.media = new WorkBuddyMediaService(this.mediaOptions)
    this.checkin = new WorkBuddyCheckinService({
      client: new WorkBuddyCheckinClient(), admission: new CheckinAdmissionStore(`${statePath}.checkin`, variant.region),
      settings: async () => { const p = await this.primary(); return { enabled: p?.config.automation.checkin === true, members: p?.config.automation.members ?? [] } },
      scopes: async () => {
        const p = await this.primary(); if (p === undefined) return []
        return p.config.automation.members.map(account => ({ region: variant.region, account, revision: p.revision }))
      },
      current: async scope => {
        const p = await this.primary()
        if (p === undefined || scope.region !== variant.region || p.revision !== scope.revision) return false
        // A direct owner click is separate from automatic participation.
        // The scheduler itself and automatic claim path enforce its allowlist.
        return (await base.listAccounts()).accounts.some(account => account.id === scope.account)
      },
      resolveAccess: async (scope, signal) => {
        if (signal.aborted) throw new ToolkitToolError('cancelled')
        const p = await this.primary(); if (p === undefined || p.revision !== scope.revision) throw new ToolkitToolError('checkin-account-changed')
        const credential = await base.resolveSavedAccount(scope.account, p.snapshot)
        return { credential }
      },
    })
  }
  async primary() {
    const snapshot = await this.base.accountSnapshot()
    const credential = snapshot.credential
    if (credential === undefined || credential.uid.trim() === '') return undefined
    const account = this.base.accountId(credential)
    const config = await this.settings.get(account)
    return { credential, account, config, snapshot, revision: `${account}:${snapshot.revision}:${snapshot.controlRevision}:${config.revision}` }
  }
  async scope(): Promise<MediaScope | undefined> {
    const p = await this.primary(); const credential = await this.policy.current()
    return p === undefined || credential === undefined || credential.uid.trim() === '' ? undefined : { region: this.variant.region, account: this.base.accountId(credential), revision: p.revision }
  }
  async refresh(): Promise<void> {
    if (this.stopped) return
    if (this.refreshRun !== undefined) return this.refreshRun
    const run = async () => {
      const p = await this.primary()
      const key = p?.revision ?? ''
      if (key === this.key) return
      this.cached = p?.config; this.owner = p?.account
      this.cliLifetime.abort()
      this.cliLifetime = new AbortController()
      this.media.cancel()
      this.onChange()
      await this.checkin.configure()
      this.key = key
    }
    this.refreshRun = run().finally(() => { this.refreshRun = undefined })
    return this.refreshRun
  }
  attach(capabilities: ToolkitCapabilities, approval: ToolkitApproval | undefined): void { this.capabilities = capabilities; this.approval = approval }
  definitions(): ToolkitToolDefinition[] {
    if (this.stopped || this.cached === undefined || !this.capabilities.tools) return []
    const definitions = createMediaTools(this.mediaOptions, this.media).filter(tool => tool.name.endsWith('_media_task')
      ? this.cached!.features.images || this.cached!.features.videos
      : tool.name.endsWith('_image') ? this.cached!.features.images : this.cached!.features.videos)
    if (this.cached.features.cli) definitions.push(...createCodeBuddyTools({
      prefix: this.variant.region === 'cn' ? 'workbuddy_cn' : 'workbuddy_ai',
      enabled: async () => (await this.primary())?.config.features.cli === true,
      configuration: async () => {
        const p = await this.primary(); const installation = codeBuddyInstallation()
        if (p === undefined || !p.config.features.cli || installation === undefined) throw new ToolkitToolError('cli-unavailable')
        return { ...installation, ...p.config.cli }
      },
      approval: { request: request => this.approval?.request(request) ?? Promise.resolve('unavailable') }, lifetime: this.cliLifetime.signal,
    }))
    return definitions
  }
  private async mediaAccess(scope: MediaScope, request: MediaRequest | undefined, signal: AbortSignal): Promise<MediaAccess> {
    if (!sameScope(await this.scope(), scope)) throw new ToolkitToolError('media-account-changed')
    const credential = await this.view.resolve()
    if (!sameScope(await this.scope(), scope)) throw new ToolkitToolError('media-account-changed')
    if (request === undefined) return { credential }
    let rows = this.models?.account === scope.account && Date.now() - this.models.at < 300_000 ? this.models.rows : undefined
    if (rows === undefined) { rows = await this.client.fetchMediaModels(credential, signal); this.models = { account: scope.account, at: Date.now(), rows } }
    const tag = request.kind === 'image' ? request.mode === 'edit' ? 'image-to-image' : 'text-to-image' : request.mode === 'frame' ? 'image-to-video' : 'text-to-video'
    const model = rows.find(model => (request.model === undefined || model.id === request.model) && model.tags.includes(tag))
    if (model === undefined) throw new ToolkitToolError('media-model-unavailable')
    return { credential, model }
  }
  async state(controlKey: string): Promise<ToolkitWebState> {
    await this.refresh()
    const decision = await this.policy.current().then(() => this.policy.decision(), () => undefined)
    const accounts = await this.base.listAccounts()
    return { provider: this.variant.id, key: controlKey, accounts, ...(this.owner === undefined ? {} : { account: this.owner }),
      ...(this.cached === undefined ? {} : { settings: structuredClone(this.cached) }), capabilities: { ...this.capabilities, cli: codeBuddyInstallation() !== undefined, media: true, checkin: true },
      ...decision === undefined ? {} : { decision }, ...(this.lastCheckin === undefined || this.lastCheckin.owner !== this.owner ? {} : { checkin: this.lastCheckin.value }),
    }
  }
  async action(action: ToolkitAction): Promise<{ state: string }> {
    if (this.stopped) throw new ToolkitToolError('disposed')
    switch (action.action) {
      case 'save-account': await this.base.saveCurrentAccount(action.revision); break
      case 'select-account': await this.base.selectAccount(action.id, action.revision); break
      case 'follow-desktop': await this.base.followDesktop(action.revision); break
      case 'rename-account': await this.base.renameAccount(action.id, action.label, action.revision); break
      case 'remove-account': await this.base.removeAccount(action.id, action.revision); break
      case 'update-settings': {
        const p = await this.primary()
        if (p === undefined || p.account !== action.account) throw Object.assign(new Error('stale-state'), { code: 'account-selection-changed' })
        if ((action.patch.features?.images || action.patch.features?.videos || action.patch.features?.cli) && (!this.capabilities.tools || !this.capabilities.approval)) throw new ToolkitToolError('toolkit-host-unavailable')
        if (action.patch.features?.contextRescue && !this.capabilities.context) throw new ToolkitToolError('rescue-host-unavailable')
        const saved = await this.base.listAccounts()
        if (action.patch.automation?.members?.some(id => !saved.accounts.some(account => account.id === id))) throw new ToolkitToolError('account-not-found')
        // Serialize cooperating CLI/control account changes with the consent
        // commit; re-read the actual desktop owner at the commit boundary too.
        await withFileLock(`${this.base.ownAuthPath()}.accounts.json`, async () => {
          const latest = await this.primary()
          if (latest === undefined || latest.account !== p.account || latest.revision !== p.revision) throw Object.assign(new Error('stale-state'), { code: 'account-selection-changed' })
          await this.settings.update(p.account, action.patch, action.revision)
        })
        break
      }
      case 'checkin': {
        const accounts = await this.base.listAccounts(); const p = await this.primary()
        if (accounts.revision !== action.revision || p === undefined || p.account !== action.account || p.snapshot.controlRevision !== action.revision || !accounts.accounts.some(account => account.id === action.id)) throw Object.assign(new Error('stale-state'), { code: 'account-selection-changed' })
        const result = await this.checkin.claim({ region: this.variant.region, account: action.id, revision: p.revision }, { automatic: false, nonce: randomUUID() }, this.lifetime.signal)
        this.lastCheckin = { owner: p.account, value: { state: result.outcome, ...('credit' in result && result.credit !== undefined ? { credits: result.credit } : {}) } }
        break
      }
    }
    await this.refresh()
    return { state: 'updated' }
  }
  dispose(): void { this.stopped = true; this.lifetime.abort(); this.cliLifetime.abort(); this.media.dispose(); this.checkin.dispose() }
}
