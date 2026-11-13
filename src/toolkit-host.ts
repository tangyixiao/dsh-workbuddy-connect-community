/** Optional active-host adapters. Losing a service or changing consent aborts the retired generation. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkBuddyToolkitRuntime } from './toolkit-runtime.ts'
import { codeBuddyInstallation } from './toolkit-runtime.ts'
import { ContextRescueService, createContextRescueTools } from './context-rescue.ts'
import { registerContextRescueCommand, type ToolkitCommandInvocation, type ToolkitCommandRegistry } from './context-rescue-command.ts'
import { applyToolkitContext, contextContentRevision, readToolkitContext, toolkitContextProvider, isKnownToolkitCompaction, resolveToolkitSummaryTarget, type ContextQueryPort, type TokenMeterPort } from './context-host.ts'
import { guardToolkitRescueStream, withToolkitRescueFrame } from './context-rescue-guard.ts'
import type {} from '@deepseek-ai/dsh-llm'
import { registerToolkitTools, ToolkitToolError, toolkitThrowIfCancelled, type ToolkitApproval, type ToolkitToolDefinition, type ToolkitToolExecution, type ToolkitToolRegistry } from './host-tools.ts'
import { buildCodeBuddyArguments, runCodeBuddy, type CodeBuddyRunRequest, type CodeBuddyRunResult } from './codebuddy-cli.ts'
import { workbuddyVisibilityPath } from './visibility-store.ts'

type PortName = 'tools' | 'approval' | 'commands' | 'sessionQuery' | 'compaction' | 'tokenMeter' | 'llm'
const PORT_METHOD: Record<PortName, string> = { tools: 'register', approval: 'request', commands: 'register', sessionQuery: 'observeSession', compaction: 'compactNow', tokenMeter: 'measure', llm: 'stream' }
interface HostContextPort { get(name: string): unknown }
interface ManagerOptions {
  /** Deterministic dependencies for isolated host fixtures; production uses the installed official CLI. */
  runCodeBuddy?: (request: CodeBuddyRunRequest) => Promise<CodeBuddyRunResult>
  installation?: () => { nodeExecutable: string; cliEntry: string } | undefined
  exportDirectory?: string
}
function port(value: unknown, method: string): boolean { return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[method] === 'function' }
function authorizationRevision(content: string, owner: string): string { return createHash('sha256').update(JSON.stringify([content, owner])).digest('hex') }

export class ToolkitHostManager {
  private readonly ports = new Map<PortName, unknown>()
  private readonly releases: Array<() => void> = []
  private readonly callbacks = new Map<WorkBuddyToolkitRuntime, { previous: () => void; own: () => void }>()
  private readonly injections: Array<{ dispose(): unknown }> = []
  private generation = new AbortController()
  private rescue: ContextRescueService | undefined
  private stopped = false
  private releaseSendGuard: (() => void) | undefined

  constructor(private readonly ctx: Context, private readonly toolkits: WorkBuddyToolkitRuntime[], private readonly options: ManagerOptions = {}) {
    for (const name of Object.keys(PORT_METHOD) as PortName[]) {
      try { const value = (ctx as unknown as HostContextPort).get(name); if (port(value, PORT_METHOD[name])) this.ports.set(name, value) } catch { /* Missing optional service. */ }
    }
    for (const toolkit of toolkits) {
      const previous = toolkit.onChange
      const own = (): void => { try { previous() } catch { this.warn() } this.refresh() }
      this.callbacks.set(toolkit, { previous, own }); toolkit.onChange = own
    }
    for (const name of Object.keys(PORT_METHOD) as PortName[]) {
      try {
        const injection = ctx.inject([name], scope => {
          let value: unknown
          try { value = (scope as unknown as HostContextPort).get(name) } catch { return }
          if (!port(value, PORT_METHOD[name])) return
          if (this.ports.get(name) !== value) { this.ports.set(name, value); this.refresh() }
          scope.effect(() => () => { if (this.ports.get(name) === value) { this.ports.delete(name); this.refresh() } }, `workbuddy toolkit ${name}`)
        })
        this.injections.push(injection)
      } catch { /* Host without this optional injection surface remains provider-only. */ }
    }
    try { this.releaseSendGuard = ctx.on('llm/stream', (options, next) => guardToolkitRescueStream(options, next)) } catch { /* No verified send hook means no context mutation capability. */ }
    try { ctx.effect(() => () => this.dispose(), 'workbuddy toolkit host lifecycle') } catch { this.dispose(); return }
    this.refresh()
  }

  private warn(): void { try { this.ctx.logger.warn('WorkBuddy optional toolkit integration is unavailable; provider registration remains active.') } catch { /* Optional logging. */ } }
  private retire(): void {
    this.generation.abort(); this.generation = new AbortController()
    this.rescue?.dispose(); this.rescue = undefined
    for (const release of this.releases.splice(0).reverse()) { try { release() } catch { /* Release siblings as well. */ } }
  }

  /** Called after cached owner state changes; no polling, provider calls or automatic request replay. */
  refresh(): void {
    if (this.stopped) return
    this.retire()
    const tools = this.ports.get('tools') as ToolkitToolRegistry | undefined
    const approval = this.ports.get('approval') as ToolkitApproval | undefined
    const commands = this.ports.get('commands') as ToolkitCommandRegistry | undefined
    const query = this.ports.get('sessionQuery') as ContextQueryPort | undefined
    const rawCompaction = this.ports.get('compaction')
    const compaction = isKnownToolkitCompaction(rawCompaction) ? rawCompaction : undefined
    const meter = this.ports.get('tokenMeter') as TokenMeterPort | undefined
    const capabilities = { tools: tools !== undefined, approval: approval !== undefined, context: commands !== undefined && query !== undefined && compaction !== undefined && this.ports.has('llm') && this.releaseSendGuard !== undefined }
    for (const toolkit of this.toolkits) toolkit.attach(capabilities, approval)
    const signal = this.generation.signal
    try {
      const definitions: ToolkitToolDefinition[] = []
      if (tools !== undefined && approval !== undefined) {
        for (const toolkit of this.toolkits) {
          const owner = toolkit.owner; const revision = toolkit.cached?.revision
          for (const definition of toolkit.definitions()) definitions.push({ ...definition, execute: async (args, execution) => {
            const combined = AbortSignal.any([signal, execution.signal]); toolkitThrowIfCancelled(combined)
            await toolkit.refresh(); toolkitThrowIfCancelled(combined)
            const primary = await toolkit.primary(); toolkitThrowIfCancelled(combined)
            if (primary === undefined || primary.account !== owner || primary.config.revision !== revision) throw new ToolkitToolError('toolkit-account-changed')
            return await definition.execute(args, { ...execution, signal: combined })
          } })
        }
      }
      const contextEnabled = capabilities.context && this.toolkits.some(toolkit => toolkit.cached?.features.contextRescue === true)
      if (contextEnabled) {
        const service = new ContextRescueService({
          enabled: () => this.anyContextEnabled(signal),
          exportDirectory: this.options.exportDirectory ?? workbuddyVisibilityPath('.workbuddy-context-rescue'),
          readSnapshot: async (agent, readSignal) => {
            const primary = await this.contextOwner(agent, readSignal)
            const snapshot = await readToolkitContext(agent, query, meter, readSignal, compaction)
            return { ...snapshot, servingAccount: primary.servingAccount, revision: authorizationRevision(snapshot.revision, `${primary.revision}:${primary.servingAccount}`) }
          },
          compact: async (agent, applySignal, expected) => {
            const primary = await this.contextOwner(agent, applySignal)
            const revision = contextContentRevision(agent, compaction)
            if (authorizationRevision(revision, `${primary.revision}:${primary.servingAccount}`) !== expected.revision || expected.servingAccount !== primary.servingAccount) throw new ToolkitToolError('rescue-preview-changed')
            const target = resolveToolkitSummaryTarget(agent, compaction)
            return withToolkitRescueFrame({
              sessionId: expected.sessionId, ...target, servingAccount: primary.servingAccount, signal: applySignal,
              validate: async () => {
                const current = await this.contextOwner(agent, applySignal)
                if (current.revision !== primary.revision || current.servingAccount !== primary.servingAccount || contextContentRevision(agent, compaction) !== revision) throw new ToolkitToolError('rescue-preview-changed')
              },
            }, ownedSignal => applyToolkitContext(agent, compaction, ownedSignal, { ...expected, revision }))
          },
        })
        this.rescue = service
        if (tools !== undefined) definitions.push(...createContextRescueTools({ service }).map((definition): ToolkitToolDefinition => ({ ...definition, execute: (args: unknown, execution: ToolkitToolExecution) => definition.execute(args, { ...execution, signal: AbortSignal.any([signal, execution.signal]) }) })))
        this.releases.push(registerContextRescueCommand(commands!, service))
      }
      if (commands !== undefined && this.toolkits.some(toolkit => toolkit.cached?.features.cli === true)) {
        this.releases.push(commands.register({ name: 'workbuddy-codebuddy', description: 'Run the configured read-only CodeBuddy review: [cn|ai] <prompt>', handler: invocation => this.runHumanCodeBuddy(invocation, signal) }))
      }
      if (tools !== undefined && definitions.length > 0) this.releases.push(registerToolkitTools(tools, definitions))
    } catch {
      this.retire()
      for (const toolkit of this.toolkits) toolkit.attach({ tools: false, approval: false, context: false }, undefined)
      this.warn()
    }
  }

  private async anyContextEnabled(signal: AbortSignal): Promise<boolean> {
    if (this.stopped || signal.aborted) return false
    for (const toolkit of this.toolkits) {
      try { if ((await toolkit.primary())?.config.features.contextRescue) return !this.stopped && !signal.aborted } catch { /* One corrupt region cannot authorize another. */ }
    }
    return false
  }
  private async contextOwner(agent: unknown, signal: AbortSignal) {
    toolkitThrowIfCancelled(signal)
    const provider = toolkitContextProvider(agent)
    const toolkit = this.toolkits.find(item => item.variant.id === provider)
    const primary = await toolkit?.primary()
    toolkitThrowIfCancelled(signal)
    if (primary === undefined || !primary.config.features.contextRescue) throw new ToolkitToolError('feature-disabled')
    const scope = await toolkit!.scope()
    toolkitThrowIfCancelled(signal)
    const decision = toolkit!.policy.decision()
    if (decision.state === 'pending' || decision.state === 'exhausted') throw new ToolkitToolError('rescue-rotation-unsettled')
    const latest = await toolkit!.primary()
    toolkitThrowIfCancelled(signal)
    if (scope === undefined || scope.revision !== primary.revision || latest?.revision !== primary.revision) throw new ToolkitToolError('rescue-preview-changed')
    return { ...primary, servingAccount: scope.account }
  }

  private async runHumanCodeBuddy(invocation: ToolkitCommandInvocation, lifetime: AbortSignal): Promise<{ kind: 'success' | 'error'; text: string }> {
    const signal = AbortSignal.any([lifetime, invocation.signal])
    try {
      toolkitThrowIfCancelled(signal)
      const raw = invocation.rawInput.trim()
      const match = /^(cn|ai)(?:\s+([\s\S]*))?$/u.exec(raw)
      const prompt = match === null ? raw : (match[2] ?? '').trim()
      if (prompt === '' || prompt.length > 32_000) throw new ToolkitToolError('cli-command-usage')
      const candidates = match === null ? this.toolkits : this.toolkits.filter(toolkit => toolkit.variant.id === (match[1] === 'ai' ? 'workbuddy-ai' : 'workbuddy'))
      const choices = await Promise.all(candidates.map(async toolkit => ({ toolkit, primary: await toolkit.primary() })))
      toolkitThrowIfCancelled(signal)
      const enabled = choices.filter(choice => choice.primary?.config.features.cli)
      if (enabled.length !== 1) throw new ToolkitToolError(match === null && enabled.length > 1 ? 'cli-command-region-required' : 'feature-disabled')
      const { toolkit, primary } = enabled[0]!
      if (primary === undefined || !primary.config.features.cli) throw new ToolkitToolError('feature-disabled')
      const installation = (this.options.installation ?? codeBuddyInstallation)()
      if (installation === undefined) throw new ToolkitToolError('cli-unavailable')
      const request = { ...installation, ...primary.config.cli, prompt, signal }
      buildCodeBuddyArguments(request)
      const latest = await toolkit.primary(); toolkitThrowIfCancelled(signal)
      if (latest?.revision !== primary.revision) throw new ToolkitToolError('configuration-changed')
      // This explicit human command is consent; approval.request is invalid between turns.
      const result = await (this.options.runCodeBuddy ?? runCodeBuddy)(request)
      toolkitThrowIfCancelled(signal)
      return { kind: 'success', text: result.text }
    } catch (error) { return { kind: 'error', text: error instanceof ToolkitToolError ? error.message : 'workbuddy: cli-unavailable' } }
  }

  dispose(): void {
    if (this.stopped) return
    this.stopped = true; this.retire(); this.generation.abort()
    for (const toolkit of this.toolkits) {
      const callback = this.callbacks.get(toolkit)
      if (toolkit.onChange === callback?.own) toolkit.onChange = callback.previous
      toolkit.attach({ tools: false, approval: false, context: false }, undefined)
    }
    for (const injection of this.injections.splice(0)) {
      try { const result = injection.dispose(); if (result instanceof Promise) void result.catch(() => {}) } catch { /* Service already gone. */ }
    }
    try { this.releaseSendGuard?.() } catch { /* Host already disposed. */ }
    this.releaseSendGuard = undefined
  }
}
