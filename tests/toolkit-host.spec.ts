import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ToolkitHostManager } from '../src/toolkit-host.ts'
import type { WorkBuddyToolkitRuntime } from '../src/toolkit-runtime.ts'
import { defaultToolkitSettings } from '../src/toolkit-settings.ts'
import { toolkitJsonOutput, type ToolkitToolDefinition } from '../src/host-tools.ts'

class BasicCompactionEngine {
  readonly config = Object.freeze({ thresholdRatio: 0.8, headroomTokens: 65536, retainRatio: 0.16, summarizationProvider: '', summarizationModel: '', maxTokens: 65536, compactionRetries: 1, maxOverflowRetries: 1, auto: true, modelPolicies: Object.freeze([]) })
  summarize() {} compactRegion() {} compactIfNeeded() {} compactPressure() {} regionDependencies() {}
  async compactNow(): Promise<null> { return null }
}

function runtime(id = 'workbuddy') {
  const config = defaultToolkitSettings(); config.features.cli = true; config.cli = { workspace: process.cwd(), model: 'hy4-preview', effort: 'high', timeoutMs: 1000, maxTurns: 1 }
  const execute = vi.fn(async (_args: unknown, exec: { signal: AbortSignal }) => ({ cancelled: exec.signal.aborted }))
  const r = { variant: { id }, cached: config, owner: `${id}-owner`, onChange() {}, attach: vi.fn(), refresh: vi.fn(async () => {}), primary: vi.fn(async () => ({ account: `${id}-owner`, revision: 'authorization-a', config })),
    definitions: () => config.features.cli ? [{ name: `${id}_review`, description: 'review', parameters: { type: 'object' }, output: toolkitJsonOutput(), execute }] : [], dispose: vi.fn(),
  }
  return { r, execute, config, port: r as unknown as WorkBuddyToolkitRuntime }
}
function host(extra: Record<string, unknown> = {}) {
  const tools = new Map<string, ToolkitToolDefinition>(); const commands = new Map<string, { handler: (invocation: { agent: unknown; rawInput: string; signal: AbortSignal }) => Promise<{ kind: string; text: string }> }>()
  const services: Record<string, unknown> = {
    tools: { register: (definition: ToolkitToolDefinition) => { if (tools.has(definition.name)) throw new Error('duplicate'); tools.set(definition.name, definition); return () => { tools.delete(definition.name) } } },
    approval: { request: async () => 'allowed-once' },
    commands: { register: (definition: { name: string; handler: (invocation: { agent: unknown; rawInput: string; signal: AbortSignal }) => Promise<{ kind: string; text: string }> }) => { if (commands.has(definition.name)) throw new Error('duplicate'); commands.set(definition.name, definition); return () => { commands.delete(definition.name) } } }, llm: { stream() {} }, ...extra,
  }
  const cleanups: Array<() => void> = []
  const ctx = { get: (name: string) => services[name], inject: () => ({ dispose() {} }), on: () => () => {}, effect: (factory: () => () => void) => { cleanups.push(factory()) }, logger: { warn: vi.fn() } } as unknown as Context
  return { ctx, tools, commands, services, cleanup: () => { cleanups.reverse().forEach(release => { release() }) } }
}
describe('optional toolkit host integration', () => {
  it('registers enabled/capable tools, aborts old handles on state changes and tears down idempotently', async () => {
    const h = host(); const r = runtime(); const manager = new ToolkitHostManager(h.ctx, [r.port])
    const old = h.tools.get('workbuddy_review')!
    expect(old).toBeDefined()
    r.config.features.cli = false; r.r.onChange()
    expect(h.tools.size).toBe(0)
    await expect(old.execute({}, { agent: {}, signal: new AbortController().signal })).rejects.toThrow('cancelled')
    manager.dispose(); manager.dispose(); expect(h.tools.size).toBe(0); expect(h.commands.size).toBe(0)
  })

  it('fails closed for missing approval or malformed services without breaking the provider runtime', () => {
    const h = host({ approval: undefined }); const r = runtime()
    const manager = new ToolkitHostManager(h.ctx, [r.port])
    expect(h.tools.size).toBe(0)
    expect(r.r.attach).toHaveBeenCalledWith({ tools: true, approval: false, context: false }, undefined)
    expect(r.r.dispose).not.toHaveBeenCalled(); manager.dispose()
  })

  it('rolls back an entire registration generation after a conflict', () => {
    let registrations = 0; const release = vi.fn(); const h = host({ tools: { register: () => { if (++registrations === 2) throw new Error('private-registry-diagnostic'); return release } } })
    const manager = new ToolkitHostManager(h.ctx, [runtime('workbuddy').port, runtime('workbuddy-ai').port])
    expect(release).toHaveBeenCalledTimes(1)
    expect(h.ctx.logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('private-registry-diagnostic'))
    manager.dispose()
  })

  it('registers one global context command for both enabled regions', () => {
    const h = host({ sessionQuery: { observeSession() {} }, compaction: new BasicCompactionEngine() })
    const cn = runtime(); const ai = runtime('workbuddy-ai'); cn.config.features.cli = false; ai.config.features.cli = false; cn.config.features.contextRescue = true; ai.config.features.contextRescue = true
    const manager = new ToolkitHostManager(h.ctx, [cn.port, ai.port])
    expect([...h.commands.keys()]).toEqual(['workbuddy-rescue'])
    expect([...h.tools.keys()]).toEqual(['workbuddy_context_preview'])
    manager.refresh(); expect([...h.commands.keys()]).toEqual(['workbuddy-rescue'])
    manager.dispose()
  })

  it('runs an explicit human CLI command using fresh scoped config without asking approval between turns', async () => {
    const h = host(); const r = runtime(); const run = vi.fn(async (_request: unknown) => ({ status: 'completed' as const, text: 'reviewed', turns: 1 }))
    const manager = new ToolkitHostManager(h.ctx, [r.port], { runCodeBuddy: run, installation: () => ({ nodeExecutable: process.execPath, cliEntry: `${process.cwd()}/fake-cli.cjs` }) })
    const command = h.commands.get('workbuddy-codebuddy')!
    expect(command).toBeDefined()
    expect((await command.handler({ agent: {}, rawInput: 'cn review code', signal: new AbortController().signal })).kind).toBe('success')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]![0]).toMatchObject({ prompt: 'review code', model: 'hy4-preview' })
    manager.dispose()
  })
})
